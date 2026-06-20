/**
 * POST /api/scorekeeper/end-game — admin only
 *
 * Immediately revokes all scorekeeper Cognito sessions by calling
 * AdminUserGlobalSignOut on every user in the Scorekeepers group.
 * Also marks all remaining UNUSED tokens as consumed so stale QR codes
 * cannot be used to re-onboard after the event.
 *
 * Effect on scorekeepers: their next API call (or background token refresh)
 * fails auth; the app detects the lost session and shows the "game has ended"
 * view via the scorekeeper layout.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  ListUsersInGroupCommand,
  AdminUserGlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import outputs from '@/amplify_outputs.json';
import type { Schema } from '@/amplify/data/resource';
import { getServerSession } from '@/app/lib/auth';
import { makeCognitoClient, USER_POOL_ID } from '@/app/lib/cognito';
import { listAll } from '@/app/lib/constants';

export async function POST() {
  const session = await getServerSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let cognitoClient: ReturnType<typeof makeCognitoClient>;
  try {
    cognitoClient = makeCognitoClient();
  } catch (err) {
    console.error('Cognito client config error:', err);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  // 1. Enumerate all users in the Scorekeepers group
  const scorekeepers: string[] = [];
  let nextToken: string | undefined;
  do {
    const res = await cognitoClient.send(
      new ListUsersInGroupCommand({
        UserPoolId: USER_POOL_ID,
        GroupName: 'Scorekeepers',
        NextToken: nextToken,
        Limit: 60,
      })
    );
    for (const u of res.Users ?? []) {
      if (u.Username) scorekeepers.push(u.Username);
    }
    nextToken = res.NextToken;
  } while (nextToken);

  // 2. Global sign-out each scorekeeper (revokes all active sessions)
  const signOutResults = await Promise.allSettled(
    scorekeepers.map((username) =>
      cognitoClient.send(
        new AdminUserGlobalSignOutCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
        })
      )
    )
  );

  const signOutFailures = signOutResults.filter((r) => r.status === 'rejected').length;
  if (signOutFailures > 0) {
    console.error(`AdminUserGlobalSignOut failed for ${signOutFailures} user(s)`);
  }

  // 3. Mark all remaining UNUSED tokens consumed
  try {
    const dataClient = generateServerClientUsingCookies<Schema>({
      config: outputs,
      cookies,
      authMode: 'apiKey',
    });

    const unusedTokens = await listAll((opts) =>
      dataClient.models.OnboardingToken.list({
        ...opts,
        filter: { status: { eq: 'UNUSED' } },
      })
    );

    if (unusedTokens.length > 0) {
      const consumedAt = new Date().toISOString();
      await Promise.all(
        unusedTokens.map((t) =>
          dataClient.models.OnboardingToken.update({
            tokenId: t.tokenId,
            status: 'CONSUMED',
            consumedAt,
          })
        )
      );
    }
  } catch (err) {
    // Non-fatal: sign-outs already happened; token cleanup is best-effort
    console.error('Token cleanup failed (non-fatal):', err);
  }

  return NextResponse.json({
    success: true,
    signedOut: scorekeepers.length,
    failures: signOutFailures,
  });
}
