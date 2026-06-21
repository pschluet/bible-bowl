import { NextResponse } from 'next/server';
import {
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  AdminUserGlobalSignOutCommand,
  AdminListGroupsForUserCommand,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import { cookies } from 'next/headers';
import outputs from '@/amplify_outputs.json';
import type { Schema } from '@/amplify/data/resource';
import { getServerSession } from '@/app/lib/auth';
import { makeCognitoClient, USER_POOL_ID } from '@/app/lib/cognito';

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

  let cognitoClient: ReturnType<typeof makeCognitoClient>;
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
        UserPoolId: USER_POOL_ID,
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
            UserPoolId: USER_POOL_ID,
            Username: username,
          })
        );
        groups = (groupsRes.Groups ?? []).map((g: { GroupName?: string }) => g.GroupName ?? '').filter(Boolean);
      } catch (err) {
        console.error(`Failed to fetch groups for user ${username}:`, err);
      }

      return { username, email, sub, status, groups };
    })
  );

  return NextResponse.json({ users });
}

// ---------------------------------------------------------------------------
// POST /api/admin/users — create a new Admin user
// Scorekeepers are onboarded via QR scan (/api/scorekeeper/exchange).
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email } = body;

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }

  let cognitoClient: ReturnType<typeof makeCognitoClient>;
  try {
    cognitoClient = makeCognitoClient();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  try {
    await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
      })
    );

    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        GroupName: 'Admins',
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

  return NextResponse.json({ success: true });
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/users — delete a single user (admin or scorekeeper)
//
// Body: { username: string; sub?: string }
// - Self-deletion is blocked server-side by comparing sub against session.sub.
// - If sub is provided and matches a Team binding, the binding is cleared
//   (best-effort, non-fatal).
// ---------------------------------------------------------------------------
export async function DELETE(request: Request) {
  const session = await getServerSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { username?: string; sub?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { username, sub } = body;

  if (!username || typeof username !== 'string') {
    return NextResponse.json({ error: 'username is required' }, { status: 400 });
  }

  // Prevent an admin from deleting their own account
  if (sub && sub === session.sub) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
  }

  let cognitoClient: ReturnType<typeof makeCognitoClient>;
  try {
    cognitoClient = makeCognitoClient();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  // Best-effort: clear any team binding associated with this user
  if (sub) {
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
      // Non-fatal: proceed with deletion even if team cleanup fails
      console.error('Failed to clear team binding (non-fatal):', err);
    }
  }

  // Best-effort: revoke active sessions before deletion so existing JWTs stop
  // working. Must run before delete (user must still exist to be signed out).
  try {
    await cognitoClient.send(
      new AdminUserGlobalSignOutCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
      })
    );
  } catch (err) {
    // Non-fatal: proceed with deletion even if sign-out fails
    console.error('AdminUserGlobalSignOut failed (non-fatal):', err);
  }

  try {
    await cognitoClient.send(
      new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
      })
    );
  } catch (err) {
    console.error('AdminDeleteUser failed:', err);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
