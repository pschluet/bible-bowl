/**
 * POST /api/scorekeeper/generate — admin only
 *
 * Generates one fresh QR-onboarding token per team, or for a single team when
 * `{ teamId }` is supplied in the request body.
 *
 * Any existing UNUSED tokens for the affected team(s) are marked CONSUMED so
 * old QR codes can't be scanned after a regeneration (security: prevents a
 * stale code from being used by an unauthorised person who saw the earlier
 * printout).
 *
 * Body (optional): { teamId?: string }
 *   - omitted / no body → bulk: regenerate for ALL teams
 *   - teamId present    → single-team: regenerate only that team's token
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

  // Parse optional body — tolerate an empty body or missing Content-Type
  const body = (await request.json().catch(() => ({}))) as { teamId?: string };
  const singleTeamId = typeof body.teamId === 'string' ? body.teamId.trim() : null;

  const dataClient = generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: 'apiKey',
  });

  // Tokens expire 8 hours from now — comfortably covers a ~3-hour event
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

  if (singleTeamId) {
    // ── Single-team regeneration ────────────────────────────────────────────
    const teamRes = await dataClient.models.Team.get({ id: singleTeamId });
    if (!teamRes.data) {
      return NextResponse.json({ error: 'Team not found.' }, { status: 404 });
    }
    const team = teamRes.data;

    // Expire only that team's outstanding UNUSED tokens
    const oldTokens = await listAll((opts) =>
      dataClient.models.OnboardingToken.list({
        ...opts,
        filter: { and: [{ teamId: { eq: singleTeamId } }, { status: { eq: 'UNUSED' } }] },
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
      teamId: team.id,
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

  // ── Bulk regeneration (all teams) ────────────────────────────────────────
  const teams = await listAll((opts) => dataClient.models.Team.list(opts));
  teams.sort(compareTeamOrder);

  // Expire any outstanding UNUSED tokens (so old QR codes can't be reused)
  const oldTokens = await listAll((opts) =>
    dataClient.models.OnboardingToken.list({
      ...opts,
      filter: { status: { eq: 'UNUSED' } },
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
        teamId: team.id,
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
