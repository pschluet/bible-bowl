/**
 * POST /api/admin/games — create a new game
 *
 * Body: { slug: string; title: string }
 * Creates a Game record owned by the current admin.
 * Returns 409 if the slug is already taken (PK collision).
 *
 * DELETE /api/admin/games — delete a game and cascade-remove all its data
 *
 * Body: { gameId: string }
 * Deletes all teams, scores, and tokens for the game, then the game itself.
 * Runs end-game teardown (signs out scorekeepers, closes scoring) first.
 * Only the game owner or super admins may delete a game.
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
import { listAll, normalizeSlug, validateSlug } from '@/app/lib/constants';

// ---------------------------------------------------------------------------
// POST /api/admin/games — create a game
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { slug?: string; title?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const rawSlug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const slug = normalizeSlug(rawSlug);

  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const slugError = validateSlug(slug);
  if (slugError) {
    return NextResponse.json({ error: slugError }, { status: 400 });
  }

  const dataClient = generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: 'apiKey',
  });

  const { errors } = await dataClient.models.Game.create({
    slug,
    title,
    ownerId: session.sub,
    currentQuestion: 1,
    scoringOpen: true,
  });

  if (errors && errors.length > 0) {
    // PK collision — slug already taken
    return NextResponse.json(
      { error: `Game code "${slug}" is already taken. Choose a different code.` },
      { status: 409 }
    );
  }

  return NextResponse.json({ slug });
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/games — cascade-delete a game
// ---------------------------------------------------------------------------
export async function DELETE(request: Request) {
  const session = await getServerSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { gameId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const gameId = typeof body.gameId === 'string' ? body.gameId.trim() : null;
  if (!gameId) {
    return NextResponse.json({ error: 'gameId is required' }, { status: 400 });
  }

  // apiKey for reads (broad guest-visible data); userPool for deletes so AppSync
  // enforces the SuperAdmins group rule / owner rule (publicApiKey lacks delete).
  const apiKeyClient = generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: 'apiKey',
  });
  const userPoolClient = generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: 'userPool',
  });

  // Verify the game exists and the caller has permission
  const { data: game } = await apiKeyClient.models.Game.get({ slug: gameId });
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

  // 1. Find and delete this game's scorekeepers.
  //    scorekeeperEmail is the exact Cognito username set during QR exchange.
  const gameTeams = await listAll((opts) =>
    apiKeyClient.models.Team.list({ ...opts, filter: { gameId: { eq: gameId } } })
  );

  const gameScorekeeperUsernames = gameTeams
    .filter((t) => t.scorekeeperEmail)
    .map((t) => t.scorekeeperEmail as string);

  await Promise.allSettled(
    gameScorekeeperUsernames.map(async (username) => {
      try {
        await cognitoClient.send(
          new AdminUserGlobalSignOutCommand({ UserPoolId: USER_POOL_ID, Username: username })
        );
      } catch {
        // Non-fatal
      }
      return cognitoClient.send(
        new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
      );
    })
  );

  // 2. Delete all scores for this game (paginated)
  try {
    const scores = await listAll((opts) =>
      apiKeyClient.models.Score.list({ ...opts, filter: { gameId: { eq: gameId } } })
    );
    await Promise.all(scores.map((s) => userPoolClient.models.Score.delete({ id: s.id })));
  } catch (err) {
    console.error('Score deletion failed (non-fatal):', err);
  }

  // 3. Delete all tokens for this game
  try {
    const tokens = await listAll((opts) =>
      apiKeyClient.models.OnboardingToken.list({ ...opts, filter: { gameId: { eq: gameId } } })
    );
    await Promise.all(
      tokens.map((t) => apiKeyClient.models.OnboardingToken.delete({ tokenId: t.tokenId }))
    );
  } catch (err) {
    console.error('Token deletion failed (non-fatal):', err);
  }

  // 4. Delete all teams for this game
  try {
    await Promise.all(gameTeams.map((t) => userPoolClient.models.Team.delete({ id: t.id })));
  } catch (err) {
    console.error('Team deletion failed (non-fatal):', err);
  }

  // 5. Delete the game itself
  const { errors } = await userPoolClient.models.Game.delete({ slug: gameId });
  if (errors && errors.length > 0) {
    console.error('Game deletion errors:', errors);
    return NextResponse.json({ error: 'Failed to delete game.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
