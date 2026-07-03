/**
 * POST /api/scorekeeper/score — authenticated scorekeepers only
 *
 * Server-enforced score submission. Direct client writes to AppSync are not
 * permitted for scorekeeper-created scores, so all scorekeeper score creates
 * flow through here.
 *
 * Checks before writing:
 *  1. Caller must be authenticated as a scorekeeper (valid Cognito session).
 *  2. The requested teamId must be bound to this scorekeeper's Cognito sub.
 *  3. Game.scoringOpen must be true (admin hasn't pressed End Game).
 *  4. questionNumber must match the current active question (prevents stale writes).
 *
 * Uses a deterministic Score id so concurrent/duplicate POSTs are idempotent —
 * the second one returns 409 (already scored) rather than creating a duplicate.
 *
 * Stamps ownerId = game.ownerId on the created Score so the game owner (admin)
 * can later edit/delete it via owner-based auth without a server round-trip.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import outputs from '@/amplify_outputs.json';
import type { Schema } from '@/amplify/data/resource';
import { getServerSession } from '@/app/lib/auth';
import { scoreId as makeScoreId } from '@/app/lib/constants';

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.isScorekeeper) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { teamId?: unknown; questionNumber?: unknown; points?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { teamId, questionNumber, points } = body;

  if (!teamId || typeof teamId !== 'string') {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
  }
  if (
    typeof questionNumber !== 'number' ||
    !Number.isInteger(questionNumber) ||
    questionNumber < 1
  ) {
    return NextResponse.json(
      { error: 'questionNumber must be a positive integer' },
      { status: 400 }
    );
  }
  if (typeof points !== 'number' || ![0, 1, 2, 3].includes(points)) {
    return NextResponse.json({ error: 'points must be 0, 1, 2, or 3' }, { status: 400 });
  }

  const apiKeyClient = generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: 'apiKey',
  });

  // 1. Verify the scorekeeper is bound to this team (prevents cross-team writes)
  const { data: team } = await apiKeyClient.models.Team.get({ id: teamId });
  if (!team || team.scorekeeperUserId !== session.sub) {
    return NextResponse.json(
      { error: 'TEAM_MISMATCH', message: 'You are not the scorekeeper for this team.' },
      { status: 403 }
    );
  }

  // 2. Look up the game via the team's gameId and verify scoring is open
  const { data: game } = await apiKeyClient.models.Game.get({ slug: team.gameId });
  if (!game || game.scoringOpen === false) {
    return NextResponse.json(
      { error: 'SCORING_CLOSED', message: 'Scoring is now closed.' },
      { status: 403 }
    );
  }

  // 3. Verify questionNumber matches the active question (prevents stale-tab writes)
  if (game.currentQuestion !== questionNumber) {
    return NextResponse.json(
      { error: 'WRONG_QUESTION', message: 'This question is no longer active.' },
      { status: 409 }
    );
  }

  // 4. Create the score with a deterministic id — duplicate POSTs return 409.
  //    Stamp ownerId = game.ownerId so the game owner can edit this score via
  //    owner-based auth (apiKey creates do not auto-populate ownerDefinedIn fields).
  const id = makeScoreId(teamId, questionNumber);
  const { errors } = await apiKeyClient.models.Score.create({
    id,
    gameId: team.gameId,
    ownerId: game.ownerId,
    teamId,
    questionNumber,
    points,
  });

  if (errors && errors.length > 0) {
    // Deterministic id already exists — question already scored
    return NextResponse.json(
      { error: 'ALREADY_SCORED', message: 'This question has already been scored.' },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true });
}
