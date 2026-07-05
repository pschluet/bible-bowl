/**
 * POST /api/scorekeeper/end-game — admin only (owner or super admin)
 *
 * Scoped to a single game (gameId in request body).
 *
 * Closes scoring on the Game FIRST (cheap, single write), then signs out and
 * deletes all scorekeeper Cognito users bound to THIS game's teams, clears
 * team bindings, and marks remaining UNUSED tokens for this game CONSUMED.
 *
 * Effect on scorekeepers: their next background token refresh fails; the app
 * detects the lost session and shows the "game has ended" view. Scorekeepers
 * who still hold a valid access token within its TTL (~60 min) are blocked by
 * scoringOpen before any score write reaches AppSync.
 *
 * At full scale (~150 scorekeepers) this fans out hundreds of Cognito admin
 * calls and AppSync mutations — see app/api/admin/games/route.ts (DELETE) for
 * the identical bounded-concurrency + shared-credentials pattern this mirrors.
 * Without it, unbounded Promise.all fan-outs trip Cognito/Identity-Pool
 * throttling, and the adaptive retrying serializes into a long enough tail to
 * exceed the serverless function timeout (seen in prod as a 504).
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  AdminUserGlobalSignOutCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { createServerRunner } from '@aws-amplify/adapter-nextjs';
import {
  generateServerClientUsingCookies,
  generateServerClientUsingReqRes,
} from '@aws-amplify/adapter-nextjs/data';
import { fetchAuthSession } from 'aws-amplify/auth/server';
import outputs from '@/amplify_outputs.json';
import type { Schema } from '@/amplify/data/resource';
import { getServerSession } from '@/app/lib/auth';
import { makeCognitoClient, USER_POOL_ID } from '@/app/lib/cognito';
import { listAll } from '@/app/lib/constants';
import { mapWithConcurrency, withRetry } from '@/app/lib/concurrency';

// Allow up to 60 s on serverless hosts for large games (mirrors the DELETE
// route in app/api/admin/games/route.ts, which hits the same scale).
export const maxDuration = 60;

/** Maximum simultaneous in-flight Cognito/AppSync mutations. */
const END_GAME_CONCURRENCY = 20;

// `createServerRunner` must be called once and its runner reused — each call
// builds a fresh Amplify singleton. Reused across requests at module scope.
const { runWithAmplifyServerContext } = createServerRunner({ config: outputs });

// The request/response ("ReqRes") server client's model methods take a
// `contextSpec` as their first argument, which lets many operations share
// ONE Amplify server context — and therefore one credentials-provider
// instance/cache — instead of each call building (and cold-starting) its own.
const reqResClient = generateServerClientUsingReqRes<Schema>({
  config: outputs,
  authMode: 'userPool',
});

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

  // Verify the game exists and the caller is the owner (or super admin)
  const { data: game } = await dataClient.models.Game.get({ slug: gameId });
  if (!game) {
    return NextResponse.json({ error: 'Game not found.' }, { status: 404 });
  }
  if (!session.isSuperAdmin && game.ownerId !== session.sub) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 1. Close scoring FIRST. This is the one action that actually "ends" the
  //    game for scorekeepers — do it before the (potentially slow) teardown
  //    below so a timeout or partial failure downstream doesn't leave the
  //    game silently still open.
  try {
    await dataClient.models.Game.update({
      slug: gameId,
      scoringOpen: false,
    });
  } catch (err) {
    console.error('Game.scoringOpen=false update failed:', err);
    return NextResponse.json({ error: 'Failed to close scoring.' }, { status: 500 });
  }

  let cognitoClient: ReturnType<typeof makeCognitoClient>;
  try {
    cognitoClient = makeCognitoClient();
  } catch (err) {
    console.error('Cognito client config error:', err);
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  // 2. Get this game's teams. scorekeeperEmail is the exact Cognito username set
  //    during QR exchange — use it directly instead of listing the whole group.
  const gameTeams = await listAll((opts) =>
    dataClient.models.Team.list({ ...opts, filter: { gameId: { eq: gameId } } })
  );

  const gameScorekeeper = gameTeams
    .filter((t) => t.scorekeeperEmail)
    .map((t) => t.scorekeeperEmail as string);

  // 3. Sign out then delete each game scorekeeper, bounded concurrency to
  //    stay under Cognito's admin-API throttle.
  //    UserNotFoundException means the user is already gone — treat as success.
  let deleteFailures = 0;
  await mapWithConcurrency(gameScorekeeper, END_GAME_CONCURRENCY, async (username) => {
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
      await withRetry(() =>
        cognitoClient.send(
          new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
        )
      );
    } catch (err) {
      if ((err as { name?: string }).name !== 'UserNotFoundException') {
        console.error(`AdminDeleteUser failed for ${username}:`, err);
        deleteFailures++;
      }
    }
  });

  // 4. Clear team bindings — use userPool auth so null values are accepted by
  //    AppSync. Runs inside ONE Amplify server context so all updates share a
  //    single credentials-provider instance/cache instead of each `.update()`
  //    call building (and cold-starting) its own — without this, concurrent
  //    updates each independently resolve Cognito Identity Pool credentials
  //    and trip its rate limit (surfaces as "NoSignedUser: No current user"
  //    wrapping a TooManyRequestsException on GetCredentialsForIdentity).
  try {
    const boundTeams = gameTeams.filter((t) => t.scorekeeperUserId || t.scorekeeperEmail);
    if (boundTeams.length > 0) {
      await runWithAmplifyServerContext({
        nextServerContext: { cookies },
        operation: async (contextSpec) => {
          // Prime the shared credentials cache once (good for ~50 min) before
          // fanning out concurrent updates below, so none of them have to
          // resolve credentials cold.
          await withRetry(() => fetchAuthSession(contextSpec));

          await mapWithConcurrency(boundTeams, END_GAME_CONCURRENCY, async (t) => {
            await withRetry(async () => {
              const { errors } = await reqResClient.models.Team.update(contextSpec, {
                id: t.id,
                scorekeeperUserId: null,
                scorekeeperEmail: null,
              });
              if (errors && errors.length > 0) {
                throw new Error(errors[0].message);
              }
            });
          });
        },
      });
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
      await mapWithConcurrency(unusedTokens, END_GAME_CONCURRENCY, async (t) => {
        await withRetry(() =>
          dataClient.models.OnboardingToken.update({
            tokenId: t.tokenId,
            status: 'CONSUMED',
            consumedAt,
          })
        );
      });
    }
  } catch (err) {
    console.error('Token cleanup failed (non-fatal):', err);
  }

  return NextResponse.json({
    success: true,
    deleted: gameScorekeeper.length,
    failures: deleteFailures,
  });
}
