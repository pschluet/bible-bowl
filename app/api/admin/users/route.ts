import { NextResponse } from 'next/server';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import { cookies } from 'next/headers';
import outputs from '@/amplify_outputs.json';
import type { Schema } from '@/amplify/data/resource';
import { getServerSession } from '@/app/lib/auth';

type Role = 'Admins' | 'Scorekeepers';

function makeCognitoClient() {
  const serverOnly = (outputs as { custom?: { serverOnly?: Record<string, string> } }).custom
    ?.serverOnly;
  const accessKeyId = serverOnly?.cognitoAdminAccessKeyId;
  const secretAccessKey = serverOnly?.cognitoAdminSecretAccessKey;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing serverOnly.cognitoAdminAccessKeyId or cognitoAdminSecretAccessKey in amplify_outputs.json');
  }
  return new CognitoIdentityProviderClient({
    region: outputs.auth.aws_region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function attr(user: UserType, name: string): string {
  return user.Attributes?.find((a) => a.Name === name)?.Value ?? '';
}

// ---------------------------------------------------------------------------
// GET /api/admin/users — list all Cognito users with their groups
// ---------------------------------------------------------------------------
export async function GET() {
  const session = await getServerSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let cognitoClient: CognitoIdentityProviderClient;
  try {
    cognitoClient = makeCognitoClient();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  // Collect all users (paginate)
  const allUsers: UserType[] = [];
  let paginationToken: string | undefined;
  do {
    const res = await cognitoClient.send(
      new ListUsersCommand({
        UserPoolId: outputs.auth.user_pool_id,
        PaginationToken: paginationToken,
      })
    );
    allUsers.push(...(res.Users ?? []));
    paginationToken = res.PaginationToken;
  } while (paginationToken);

  // Fetch groups for each user in parallel
  const users = await Promise.all(
    allUsers.map(async (u) => {
      const username = u.Username ?? '';
      const email = attr(u, 'email');
      const sub = attr(u, 'sub');
      const status = u.UserStatus ?? '';

      let groups: string[] = [];
      try {
        const groupsRes = await cognitoClient.send(
          new AdminListGroupsForUserCommand({
            UserPoolId: outputs.auth.user_pool_id,
            Username: username,
          })
        );
        groups = (groupsRes.Groups ?? []).map((g) => g.GroupName ?? '').filter(Boolean);
      } catch (err) {
        console.error(`Failed to fetch groups for user ${username}:`, err);
      }

      return { username, email, sub, status, groups };
    })
  );

  return NextResponse.json({ users });
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/users — change a user's role
// ---------------------------------------------------------------------------
export async function PATCH(request: Request) {
  const session = await getServerSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { username?: string; role?: string; sub?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { username, role, sub } = body;

  if (!username || typeof username !== 'string') {
    return NextResponse.json({ error: 'username is required' }, { status: 400 });
  }
  if (role !== 'Admins' && role !== 'Scorekeepers') {
    return NextResponse.json({ error: "role must be 'Admins' or 'Scorekeepers'" }, { status: 400 });
  }

  let cognitoClient: CognitoIdentityProviderClient;
  try {
    cognitoClient = makeCognitoClient();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const otherRole: Role = role === 'Admins' ? 'Scorekeepers' : 'Admins';

  try {
    // Remove from the other group (ignore error if not in that group)
    await cognitoClient
      .send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: outputs.auth.user_pool_id,
          Username: username,
          GroupName: otherRole,
        })
      )
      .catch(() => {
        // Not in that group — safe to ignore
      });

    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: outputs.auth.user_pool_id,
        Username: username,
        GroupName: role as Role,
      })
    );
  } catch (err) {
    console.error('Failed to update Cognito group:', err);
    return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
  }

  // When demoting from Scorekeepers → Admins, clear any team assignment
  if (role === 'Admins' && sub) {
    try {
      const dataClient = generateServerClientUsingCookies<Schema>({
        config: outputs,
        cookies,
        authMode: 'apiKey',
      });
      const teamsRes = await dataClient.models.Team.list();
      const assignedTeam = teamsRes.data.find((t) => t.scorekeeperUserId === sub);
      if (assignedTeam) {
        await dataClient.models.Team.update({
          id: assignedTeam.id,
          scorekeeperUserId: null,
          scorekeeperEmail: null,
        });
      }
    } catch (err) {
      console.error('Role updated but failed to clear team assignment:', err);
      // Non-fatal: role change succeeded; return a partial-success note
      return NextResponse.json({ success: true, warning: 'Role updated but failed to clear team assignment' });
    }
  }

  return NextResponse.json({ success: true });
}

// ---------------------------------------------------------------------------
// POST /api/admin/users — create a new user (unchanged)
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { email?: string; role?: string; teamId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email, role, teamId } = body;

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }
  if (role !== 'Admins' && role !== 'Scorekeepers') {
    return NextResponse.json({ error: "role must be 'Admins' or 'Scorekeepers'" }, { status: 400 });
  }

  let cognitoClient: CognitoIdentityProviderClient;
  try {
    cognitoClient = makeCognitoClient();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  try {
    await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: outputs.auth.user_pool_id,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
      })
    );

    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: outputs.auth.user_pool_id,
        Username: email,
        GroupName: role as Role,
      })
    );
  } catch (err: unknown) {
    const errName = (err as { name?: string }).name;
    if (errName === 'UsernameExistsException') {
      return NextResponse.json({ error: 'A user with that email already exists' }, { status: 409 });
    }
    console.error('Failed to create Cognito user:', err);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }

  if (role === 'Scorekeepers' && teamId) {
    try {
      const dataClient = generateServerClientUsingCookies<Schema>({
        config: outputs,
        cookies,
        authMode: 'apiKey',
      });
      await dataClient.models.Team.update({ id: teamId, scorekeeperEmail: email });
    } catch (err: unknown) {
      console.error('User created but failed to assign team:', err);
      return NextResponse.json(
        { error: 'User created, but failed to assign team' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true });
}
