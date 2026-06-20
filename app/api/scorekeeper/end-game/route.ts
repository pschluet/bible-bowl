/**
 * POST /api/scorekeeper/end-game — admin only
 *
 * Deletes all synthetic scorekeeper Cognito users (deletion revokes all active
 * sessions), clears their team bindings, and marks any remaining UNUSED tokens
 * as CONSUMED so stale QR codes cannot be re-used after the event.
 *
 * Effect on scorekeepers: their next API call (or background token refresh)
 * fails auth; the app detects the lost session and shows the "game has ended"
 * view via the scorekeeper layout.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  ListUsersInGroupCommand,
  AdminDeleteUserCommand,
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

  // 2. Delete each scorekeeper (deletion revokes all active sessions)
  const deleteResults = await Promise.allSettled(
    scorekeepers.map((username) =>
      cognitoClient.send(
        new AdminDeleteUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
        })
      )
    )
  );

  const deleteFailures = deleteResults.filter((r) => r.status === 'rejected').length;
  if (deleteFailures > 0) {
    console.error(`AdminDeleteUser failed for ${deleteFailures} user(s)`);
  }

  const dataClient = generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: 'apiKey',
  });

  // 3. Clear team bindings for deleted scorekeepers (best-effort)
  try {
    const allTeams = await listAll((opts) => dataClient.models.Team.list(opts));
    const boundTeams = allTeams.filter((t) => t.scorekeeperUserId || t.scorekeeperEmail);
    if (boundTeams.length > 0) {
      await Promise.all(
        boundTeams.map((t) =>
          dataClient.models.Team.update({
            id: t.id,
            scorekeeperUserId: null,
            scorekeeperEmail: null,
          })
        )
      );
    }
  } catch (err) {
    // Non-fatal: sign-outs already happened; binding cleanup is best-effort
    console.error('Team binding cleanup failed (non-fatal):', err);
  }

  // 4. Mark all remaining UNUSED tokens consumed (best-effort)
  try {
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
    // Non-fatal: deletions already happened; token cleanup is best-effort
    console.error('Token cleanup failed (non-fatal):', err);
  }

  return NextResponse.json({
    success: true,
    deleted: scorekeepers.length,
    failures: deleteFailures,
  });
}
