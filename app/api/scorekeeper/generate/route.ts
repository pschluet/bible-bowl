/**
 * POST /api/scorekeeper/generate — admin only (owner or super admin)
 *
 * Generates one fresh QR-onboarding token per team for a given game, or for a
 * single team when `{ teamId }` is supplied in the request body.
 *
 * Any existing UNUSED tokens for the affected team(s) are marked CONSUMED so
 * old QR codes can't be scanned after a regeneration (security: prevents a
 * stale code from being used by an unauthorised person who saw the earlier
 * printout).
 *
 * Body (required): { gameId: string; teamId?: string }
 *   - gameId only → bulk: regenerate for ALL teams in that game
 *   - gameId + teamId → single-team regenerate
 *
 * Returns: { tokens: [{ teamId, teamName, groupType, tokenId, status }] }
 * The client constructs the deep link: /scan?token=<tokenId>
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import outputs from '@/amplify_outputs.json';
import type { Schema } from '@/amplify/data/resource';
import { getServerSession } from '@/app/lib/auth';
import { listAll, compareTeamOrder } from '@/app/lib/constants';

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    gameId?: string;
    teamId?: string;
  };
  const gameId = typeof body.gameId === 'string' ? body.gameId.trim() : null;
  const singleTeamId = typeof body.teamId === 'string' ? body.teamId.trim() : null;

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

  // Tokens expire 8 hours from now — comfortably covers a ~3-hour event
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

  if (singleTeamId) {
    // ── Single-team regeneration ────────────────────────────────────────────
    const teamRes = await dataClient.models.Team.get({ id: singleTeamId });
    if (!teamRes.data) {
      return NextResponse.json({ error: 'Team not found.' }, { status: 404 });
    }
    const team = teamRes.data;

    // Verify the team belongs to this game
    if (team.gameId !== gameId) {
      return NextResponse.json({ error: 'Team does not belong to this game.' }, { status: 400 });
    }

    // Expire only that team's outstanding UNUSED tokens (within this game)
    const oldTokens = await listAll((opts) =>
      dataClient.models.OnboardingToken.list({
        ...opts,
        filter: {
          and: [
            { teamId: { eq: singleTeamId } },
            { gameId: { eq: gameId } },
            { status: { eq: 'UNUSED' } },
          ],
        },
      })
    );

    if (oldTokens.length > 0) {
      const consumedAt = new Date().toISOString();
      await Promise.all(
        oldTokens.map((t) =>
          dataClient.models.OnboardingToken.update({
            tokenId: t.tokenId,
            status: 'CONSUMED',
            consumedAt,
          })
        )
      );
    }

    // Create a fresh token for this team
    const tokenId = randomUUID();
    const batchId = randomUUID();
    await dataClient.models.OnboardingToken.create({
      tokenId,
      gameId,
      teamId: team.id,
      ownerId: game.ownerId,
      status: 'UNUSED',
      expiresAt,
      batchId,
    });

    return NextResponse.json({
      tokens: [
        {
          tokenId,
          teamId: team.id,
          teamName: team.name,
          groupType: team.groupType ?? null,
          status: 'UNUSED' as const,
        },
      ],
    });
  }

  // ── Bulk regeneration (all teams in this game) ────────────────────────────
  const teams = await listAll((opts) =>
    dataClient.models.Team.list({ ...opts, filter: { gameId: { eq: gameId } } })
  );
  teams.sort(compareTeamOrder);

  // Expire any outstanding UNUSED tokens for this game (so old QR codes can't be reused)
  const oldTokens = await listAll((opts) =>
    dataClient.models.OnboardingToken.list({
      ...opts,
      filter: { and: [{ gameId: { eq: gameId } }, { status: { eq: 'UNUSED' } }] },
    })
  );

  if (oldTokens.length > 0) {
    const consumedAt = new Date().toISOString();
    await Promise.all(
      oldTokens.map((t) =>
        dataClient.models.OnboardingToken.update({
          tokenId: t.tokenId,
          status: 'CONSUMED',
          consumedAt,
        })
      )
    );
  }

  // Create a fresh token for each team
  const batchId = randomUUID();

  const results = await Promise.all(
    teams.map(async (team) => {
      const tokenId = randomUUID();
      await dataClient.models.OnboardingToken.create({
        tokenId,
        gameId,
        teamId: team.id,
        ownerId: game.ownerId,
        status: 'UNUSED',
        expiresAt,
        batchId,
      });
      return {
        tokenId,
        teamId: team.id,
        teamName: team.name,
        groupType: team.groupType ?? null,
        status: 'UNUSED' as const,
      };
    })
  );

  return NextResponse.json({ tokens: results });
}
