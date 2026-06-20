/**
 * POST /api/scorekeeper/exchange — unauthenticated entry point
 *
 * Exchanges a single-use QR token for a one-time Cognito credential pair that
 * the /scan page uses to call Amplify signIn(USER_PASSWORD_AUTH).
 *
 * Flow:
 *   1. Validate token (exists, UNUSED, not expired).
 *   2. Resolve teamId → teamName.
 *   3. Ensure a Cognito user exists for the team (creates on first exchange).
 *   4. Add the user to the Scorekeepers group (idempotent).
 *   5. Set a random permanent password (confirms the account immediately).
 *   6. Mark the token CONSUMED.
 *   7. Return { username, password, teamId, teamName } to the client.
 *
 * The client immediately calls signIn({ username, password,
 * options: { authFlowType: 'USER_PASSWORD_AUTH' } }) to obtain a real Cognito
 * session that Amplify persists in cookies for SSR access.
 *
 * Security note: this route is unauthenticated, but UUID v4 tokens (128 bits
 * of entropy) make guessing impractical. Add WAF rate-limiting in production.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminAddUserToGroupCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import outputs from '@/amplify_outputs.json';
import type { Schema } from '@/amplify/data/resource';
import { makeCognitoClient, scorekeeperUsername, USER_POOL_ID } from '@/app/lib/cognito';

function attr(
  attrs: Array<{ Name?: string; Value?: string }> | undefined,
  name: string
): string {
  return attrs?.find((a) => a.Name === name)?.Value ?? '';
}

export async function POST(request: Request) {
  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { token } = body;
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  const dataClient = generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: 'apiKey',
  });

  // 1. Validate the token
  const { data: tokenRow } = await dataClient.models.OnboardingToken.get({ tokenId: token });

  if (!tokenRow) {
    return NextResponse.json({ error: 'INVALID_TOKEN', message: 'QR code not found.' }, { status: 404 });
  }
  if (tokenRow.status === 'CONSUMED') {
    return NextResponse.json(
      { error: 'TOKEN_ALREADY_USED', message: 'This QR code has already been used.' },
      { status: 409 }
    );
  }
  if (tokenRow.expiresAt && new Date(tokenRow.expiresAt) < new Date()) {
    return NextResponse.json(
      { error: 'TOKEN_EXPIRED', message: 'This QR code has expired.' },
      { status: 410 }
    );
  }

  // 2. Resolve the team
  const { data: team } = await dataClient.models.Team.get({ id: tokenRow.teamId });
  if (!team) {
    return NextResponse.json({ error: 'TEAM_NOT_FOUND', message: 'Team not found.' }, { status: 404 });
  }

  const username = scorekeeperUsername(team.id);

  let cognitoClient: ReturnType<typeof makeCognitoClient>;
  try {
    cognitoClient = makeCognitoClient();
  } catch (err) {
    console.error('Cognito client config error:', err);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  // 3. Ensure the Cognito user exists
  let userSub: string;
  try {
    // Try to fetch the existing user
    const existing = await cognitoClient.send(
      new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
    );
    userSub = attr(existing.UserAttributes, 'sub');
  } catch (err: unknown) {
    const errName = (err as { name?: string }).name;
    if (errName !== 'UserNotFoundException') {
      console.error('AdminGetUser failed:', err);
      return NextResponse.json({ error: 'Failed to look up user' }, { status: 500 });
    }

    // User doesn't exist yet — create it
    try {
      const created = await cognitoClient.send(
        new AdminCreateUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
          // Suppress the invitation email — scorekeepers authenticate via QR only
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: username },
            { Name: 'email_verified', Value: 'true' },
          ],
        })
      );
      userSub = attr(created.User?.Attributes, 'sub');
    } catch (createErr) {
      console.error('AdminCreateUser failed:', createErr);
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
    }
  }

  // 4. Ensure the user is in the Scorekeepers group (idempotent)
  try {
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: 'Scorekeepers',
      })
    );
  } catch (err) {
    console.error('AdminAddUserToGroup failed:', err);
    return NextResponse.json({ error: 'Failed to assign group' }, { status: 500 });
  }

  // 5. Set a random permanent password (immediately confirms the account)
  // The password is returned once to the client for use with USER_PASSWORD_AUTH
  // and rotated on every exchange — scorekeepers never know it.
  //
  // base64url uses only A-Za-z0-9-_ as symbols; ~35% of outputs contain
  // neither '-' nor '_', which fails Cognito's "must have symbol characters"
  // policy. Appending '!' guarantees the requirement is always satisfied.
  const password = randomBytes(24).toString('base64url') + '!';
  try {
    await cognitoClient.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        Password: password,
        Permanent: true,
      })
    );
  } catch (err) {
    console.error('AdminSetUserPassword failed:', err);
    return NextResponse.json({ error: 'Failed to set credentials' }, { status: 500 });
  }

  // 6. Bind the team to this scorekeeper's sub
  try {
    await dataClient.models.Team.update({
      id: team.id,
      scorekeeperUserId: userSub,
      scorekeeperEmail: username,
    });
  } catch (err) {
    // Non-fatal: the scorekeeper is signed in; the admin can reassign from the UI
    console.error('Team binding failed (non-fatal):', err);
  }

  // 7. Mark token consumed
  await dataClient.models.OnboardingToken.update({
    tokenId: token,
    status: 'CONSUMED',
    consumedAt: new Date().toISOString(),
  });

  return NextResponse.json({
    username,
    password,
    teamId: team.id,
    teamName: team.name,
  });
}
