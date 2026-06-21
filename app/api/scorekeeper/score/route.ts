/**
 * POST /api/scorekeeper/score — authenticated scorekeepers only
 *
 * Server-enforced score submission. Direct client writes to AppSync are no
 * longer permitted (Score uses publicApiKey auth, not allow.owner()), so all
 * scorekeeper score creates flow through here.
 *
 * Checks before writing:
 *  1. Caller must be authenticated as a scorekeeper (valid Cognito session).
 *  2. GameState.scoringOpen must be true (admin hasn't pressed End Game).
 *  3. The requested teamId must be bound to this scorekeeper's Cognito sub.
 *  4. questionNumber must match the current active question (prevents stale writes).
 *
 * Uses a deterministic Score id so concurrent/duplicate POSTs are idempotent —
 * the second one returns 409 (already scored) rather than creating a duplicate.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import outputs from '@/amplify_outputs.json';
import type { Schema } from '@/amplify/data/resource';
import { getServerSession } from '@/app/lib/auth';
import { GAME_STATE_ID, scoreId as makeScoreId } from '@/app/lib/constants';

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

  // userPool client: reads authorized by allow.authenticated() on GameState and Team
  const userPoolClient = generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: 'userPool',
  });
  // apiKey client: writes authorized by allow.publicApiKey() on Score
  const apiKeyClient = generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: 'apiKey',
  });

  // 1. Verify scoring is open
  const { data: gameState } = await userPoolClient.models.GameState.get({ id: GAME_STATE_ID });
  if (!gameState || gameState.scoringOpen === false) {
    return NextResponse.json(
      { error: 'SCORING_CLOSED', message: 'Scoring is now closed.' },
      { status: 403 }
    );
  }

  // 2. Verify questionNumber matches the active question (prevents stale-tab writes)
  if (gameState.currentQuestion !== questionNumber) {
    return NextResponse.json(
      { error: 'WRONG_QUESTION', message: 'This question is no longer active.' },
      { status: 409 }
    );
  }

  // 3. Verify the scorekeeper is bound to this team (prevents cross-team writes)
  const { data: team } = await userPoolClient.models.Team.get({ id: teamId });
  if (!team || team.scorekeeperUserId !== session.sub) {
    return NextResponse.json(
      { error: 'TEAM_MISMATCH', message: 'You are not the scorekeeper for this team.' },
      { status: 403 }
    );
  }

  // 4. Create the score with a deterministic id — duplicate POSTs return 409
  const id = makeScoreId(teamId, questionNumber);
  const { errors } = await apiKeyClient.models.Score.create({
    id,
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
