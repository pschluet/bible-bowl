import { NextResponse } from 'next/server';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import { cookies } from 'next/headers';
import outputs from '@/amplify_outputs.json';
import type { Schema } from '@/amplify/data/resource';
import { getServerSession } from '@/app/lib/auth';

type Role = 'Admins' | 'Scorekeepers';

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

  const cognitoClient = new CognitoIdentityProviderClient({
    region: outputs.auth.aws_region,
    credentials: {
      accessKeyId: process.env.COGNITO_ADMIN_ACCESS_KEY_ID!,
      secretAccessKey: process.env.COGNITO_ADMIN_SECRET_ACCESS_KEY!,
    },
  });

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
