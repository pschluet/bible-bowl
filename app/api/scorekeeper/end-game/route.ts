/**
 * POST /api/scorekeeper/end-game — admin only (owner or super admin)
 *
 * Scoped to a single game (gameId in request body).
 *
 * Signs out all scorekeeper Cognito users bound to THIS game's teams (immediately
 * revokes their refresh tokens), then deletes the users, clears team bindings,
 * marks remaining UNUSED tokens for this game CONSUMED, and sets
 * Game.scoringOpen = false.
 *
 * Effect on scorekeepers: their next background token refresh fails; the app
 * detects the lost session and shows the "game has ended" view. Scorekeepers
 * who still hold a valid access token within its TTL (~60 min) are blocked by
 * scoringOpen before any score write reaches AppSync.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  AdminUserGlobalSignOutCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import outputs from '@/amplify_outputs.json';
import type { Schema } from '@/amplify/data/resource';
import { getServerSession } from '@/app/lib/auth';
import { makeCognitoClient, USER_POOL_ID } from '@/app/lib/cognito';
import { listAll } from '@/app/lib/constants';

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { gameId?: string };
  const gameId = typeof body.gameId === 'string' ? body.gameId.trim() : null;

  if (!gameId) {
    return NextResponse.json({ error: 'gameId is required' }, { status: 400 });
  }

  const dataClient = generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: 'apiKey',
  });
  // userPool client for writes that need the admin's identity (null-clearing team bindings).
  const userPoolClient = generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: 'userPool',
  });

  // Verify the game exists and the caller is the owner (or super admin)
  const { data: game } = await dataClient.models.Game.get({ slug: gameId });
  if (!game) {
    return NextResponse.json({ error: 'Game not found.' }, { status: 404 });
  }
  if (!session.isSuperAdmin && game.ownerId !== session.sub) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let cognitoClient: ReturnType<typeof makeCognitoClient>;
  try {
    cognitoClient = makeCognitoClient();
  } catch (err) {
    console.error('Cognito client config error:', err);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  // 1. Get this game's teams. scorekeeperEmail is the exact Cognito username set
  //    during QR exchange — use it directly instead of listing the whole group.
  const gameTeams = await listAll((opts) =>
    dataClient.models.Team.list({ ...opts, filter: { gameId: { eq: gameId } } })
  );

  const gameScorekeeper = gameTeams
    .filter((t) => t.scorekeeperEmail)
    .map((t) => t.scorekeeperEmail as string);

  // 3. Sign out then delete each game scorekeeper.
  //    UserNotFoundException means the user is already gone — treat as success.
  let deleteFailures = 0;
  await Promise.all(
    gameScorekeeper.map(async (username) => {
      try {
        await cognitoClient.send(
          new AdminUserGlobalSignOutCommand({ UserPoolId: USER_POOL_ID, Username: username })
        );
      } catch (err) {
        if ((err as { name?: string }).name !== 'UserNotFoundException') {
          console.error(`AdminUserGlobalSignOut failed for ${username}:`, err);
        }
      }
      try {
        await cognitoClient.send(
          new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
        );
      } catch (err) {
        if ((err as { name?: string }).name !== 'UserNotFoundException') {
          console.error(`AdminDeleteUser failed for ${username}:`, err);
          deleteFailures++;
        }
      }
    })
  );

  // 4. Clear team bindings — use userPool auth so null values are accepted by AppSync.
  try {
    const boundTeams = gameTeams.filter((t) => t.scorekeeperUserId || t.scorekeeperEmail);
    if (boundTeams.length > 0) {
      await Promise.all(
        boundTeams.map((t) =>
          userPoolClient.models.Team.update(
            { id: t.id, scorekeeperUserId: null, scorekeeperEmail: null },
            { authMode: 'userPool' }
          )
        )
      );
    }
  } catch (err) {
    console.error('Team binding cleanup failed:', err);
  }

  // 5. Mark all remaining UNUSED tokens for this game consumed (best-effort)
  try {
    const unusedTokens = await listAll((opts) =>
      dataClient.models.OnboardingToken.list({
        ...opts,
        filter: { and: [{ gameId: { eq: gameId } }, { status: { eq: 'UNUSED' } }] },
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
    console.error('Token cleanup failed (non-fatal):', err);
  }

  // 6. Close scoring on the Game (best-effort).
  //    Scorekeepers whose access token hasn't expired yet will be blocked here
  //    before any score write reaches AppSync.
  try {
    // Use apiKey since the owner rule is satisfied by having the game's ownerId
    // match — but apiKey is simpler and already validated above.
    await dataClient.models.Game.update({
      slug: gameId,
      scoringOpen: false,
    });
  } catch (err) {
    console.error('Game.scoringOpen=false update failed (non-fatal):', err);
  }

  return NextResponse.json({
    success: true,
    deleted: gameScorekeeper.length,
    failures: deleteFailures,
  });
}
