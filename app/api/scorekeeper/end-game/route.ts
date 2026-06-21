/**
 * POST /api/scorekeeper/end-game — admin only
 *
 * Signs out all scorekeeper Cognito users (immediately revokes their refresh
 * tokens), then deletes the users, clears team bindings, marks remaining UNUSED
 * tokens CONSUMED, and sets GameState.scoringOpen = false.
 *
 * Effect on scorekeepers: their next background token refresh fails; the app
 * detects the lost session and shows the "game has ended" view. Scorekeepers
 * who still hold a valid access token within its TTL (~60 min) are blocked by
 * the scoringOpen flag before any score write reaches AppSync.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  ListUsersInGroupCommand,
  AdminUserGlobalSignOutCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import outputs from '@/amplify_outputs.json';
import type { Schema } from '@/amplify/data/resource';
import { getServerSession } from '@/app/lib/auth';
import { makeCognitoClient, USER_POOL_ID } from '@/app/lib/cognito';
import { GAME_STATE_ID, listAll } from '@/app/lib/constants';

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

  // 2. Sign out then delete each scorekeeper.
  //    Sign-out revokes refresh tokens immediately; delete cleans up the user record.
  //    Both run per-user so one failure doesn't abort the rest.
  const deleteResults = await Promise.allSettled(
    scorekeepers.map(async (username) => {
      // Revoke active sessions before deletion (user must still exist to be signed out)
      try {
        await cognitoClient.send(
          new AdminUserGlobalSignOutCommand({
            UserPoolId: USER_POOL_ID,
            Username: username,
          })
        );
      } catch (err) {
        console.error(`AdminUserGlobalSignOut failed for ${username} (non-fatal):`, err);
      }
      return cognitoClient.send(
        new AdminDeleteUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
        })
      );
    })
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

  // 5. Close scoring on the GameState singleton (best-effort).
  //    Scorekeepers whose access token hasn't expired yet will be blocked here
  //    before any score write reaches AppSync.
  try {
    const gameStateClient = generateServerClientUsingCookies<Schema>({
      config: outputs,
      cookies,
      authMode: 'userPool',
    });
    await gameStateClient.models.GameState.update({
      id: GAME_STATE_ID,
      scoringOpen: false,
    });
  } catch (err) {
    // Non-fatal: scorekeepers are already signed out; the scoring gate is best-effort
    console.error('GameState scoringOpen=false update failed (non-fatal):', err);
  }

  return NextResponse.json({
    success: true,
    deleted: scorekeepers.length,
    failures: deleteFailures,
  });
}
