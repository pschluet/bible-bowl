/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import { getServerSession } from '@/app/lib/auth';
import { makeGame, makeTeam } from '../support/factories';
import { asAdmin, asAnon, asScorekeeper } from '../support/session';
import type { FakeDataClient } from '../support/amplify-mock';

vi.mock('@/app/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@aws-amplify/adapter-nextjs/data', async () => {
  const { createFakeDataClient } = await import('../support/amplify-mock');
  const client = createFakeDataClient();
  return {
    generateServerClientUsingCookies: () => client,
    generateServerClientUsingReqRes: () => client,
  };
});

// Imported after the mocks above so the route picks up the mocked modules.
const { POST } = await import('@/app/api/scorekeeper/score/route');

const client = generateServerClientUsingCookies({} as never) as unknown as FakeDataClient;

function req(body: unknown): Request {
  return new Request('http://localhost/api/scorekeeper/score', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/scorekeeper/score', () => {
  beforeEach(() => {
    client._resetAll();
    vi.mocked(getServerSession).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns 401 when the caller has no scorekeeper session', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAnon());
    const res = await POST(req({ teamId: 't1', questionNumber: 1, points: 2 }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 for an authenticated non-scorekeeper (e.g. an admin)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin());
    const res = await POST(req({ teamId: 't1', questionNumber: 1, points: 2 }));
    expect(res.status).toBe(401);
  });

  it('returns 400 on malformed JSON', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asScorekeeper());
    const res = await POST(req('{not json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when teamId is missing', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asScorekeeper());
    const res = await POST(req({ questionNumber: 1, points: 2 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'teamId is required' });
  });

  it.each([0, -1, 1.5, NaN, '1', null])(
    'returns 400 when questionNumber is invalid (%p)',
    async (questionNumber) => {
      vi.mocked(getServerSession).mockResolvedValue(asScorekeeper());
      const res = await POST(req({ teamId: 't1', questionNumber, points: 2 }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'questionNumber must be a positive integer',
      });
    }
  );

  it.each([-1, 4, 1.5, '2', null, undefined])(
    'returns 400 when points is invalid (%p)',
    async (points) => {
      vi.mocked(getServerSession).mockResolvedValue(asScorekeeper());
      const res = await POST(req({ teamId: 't1', questionNumber: 1, points }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'points must be 0, 1, 2, or 3' });
    }
  );

  it('returns 403 TEAM_MISMATCH when the team does not exist', async () => {
    const session = asScorekeeper();
    vi.mocked(getServerSession).mockResolvedValue(session);
    const res = await POST(req({ teamId: 'no-such-team', questionNumber: 1, points: 2 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'TEAM_MISMATCH',
      message: 'You are not the scorekeeper for this team.',
    });
  });

  it('returns 403 TEAM_MISMATCH when the team is bound to a different scorekeeper', async () => {
    const session = asScorekeeper({ sub: 'sk-A' });
    vi.mocked(getServerSession).mockResolvedValue(session);
    const team = makeTeam({ id: 't1', scorekeeperUserId: 'sk-B' });
    await client.models.Team.create(team);
    const res = await POST(req({ teamId: 't1', questionNumber: 1, points: 2 }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('TEAM_MISMATCH');
  });

  it('returns 403 SCORING_CLOSED when the game has scoringOpen: false', async () => {
    const session = asScorekeeper({ sub: 'sk-A' });
    vi.mocked(getServerSession).mockResolvedValue(session);
    const team = makeTeam({ id: 't1', gameId: 'g1', scorekeeperUserId: 'sk-A' });
    await client.models.Team.create(team);
    await client.models.Game.create(
      makeGame({ slug: 'g1', currentQuestion: 1, scoringOpen: false })
    );
    const res = await POST(req({ teamId: 't1', questionNumber: 1, points: 2 }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('SCORING_CLOSED');
  });

  it.each([null, undefined])('treats scoringOpen: %p as OPEN, not closed', async (scoringOpen) => {
    const session = asScorekeeper({ sub: 'sk-A' });
    vi.mocked(getServerSession).mockResolvedValue(session);
    const team = makeTeam({ id: 't1', gameId: 'g1', scorekeeperUserId: 'sk-A' });
    await client.models.Team.create(team);
    await client.models.Game.create(makeGame({ slug: 'g1', currentQuestion: 1, scoringOpen }));
    const res = await POST(req({ teamId: 't1', questionNumber: 1, points: 2 }));
    expect(res.status).toBe(200);
  });

  it('returns 409 WRONG_QUESTION when questionNumber does not match Game.currentQuestion', async () => {
    const session = asScorekeeper({ sub: 'sk-A' });
    vi.mocked(getServerSession).mockResolvedValue(session);
    const team = makeTeam({ id: 't1', gameId: 'g1', scorekeeperUserId: 'sk-A' });
    await client.models.Team.create(team);
    await client.models.Game.create(makeGame({ slug: 'g1', currentQuestion: 3 }));
    const res = await POST(req({ teamId: 't1', questionNumber: 2, points: 2 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('WRONG_QUESTION');
  });

  it('checks TEAM_MISMATCH before SCORING_CLOSED/WRONG_QUESTION (validation order)', async () => {
    // Team doesn't exist at all AND the body's questionNumber would also be
    // wrong if a game existed — TEAM_MISMATCH must win since it's checked first.
    const session = asScorekeeper({ sub: 'sk-A' });
    vi.mocked(getServerSession).mockResolvedValue(session);
    const res = await POST(req({ teamId: 'ghost-team', questionNumber: 999, points: 2 }));
    expect((await res.json()).error).toBe('TEAM_MISMATCH');
  });

  it('creates the score on a valid first submission, stamping ownerId from the game', async () => {
    const session = asScorekeeper({ sub: 'sk-A' });
    vi.mocked(getServerSession).mockResolvedValue(session);
    const team = makeTeam({ id: 't1', gameId: 'g1', scorekeeperUserId: 'sk-A' });
    await client.models.Team.create(team);
    await client.models.Game.create(
      makeGame({ slug: 'g1', ownerId: 'owner-1', currentQuestion: 1 })
    );

    const res = await POST(req({ teamId: 't1', questionNumber: 1, points: 3 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const stored = client.models.Score._store.get('t1#1');
    expect(stored).toMatchObject({
      id: 't1#1',
      teamId: 't1',
      gameId: 'g1',
      ownerId: 'owner-1',
      questionNumber: 1,
      points: 3,
    });
  });

  it('returns 409 ALREADY_SCORED on a duplicate submission for the same team+question', async () => {
    const session = asScorekeeper({ sub: 'sk-A' });
    vi.mocked(getServerSession).mockResolvedValue(session);
    const team = makeTeam({ id: 't1', gameId: 'g1', scorekeeperUserId: 'sk-A' });
    await client.models.Team.create(team);
    await client.models.Game.create(makeGame({ slug: 'g1', currentQuestion: 1 }));

    const first = await POST(req({ teamId: 't1', questionNumber: 1, points: 1 }));
    expect(first.status).toBe(200);

    const second = await POST(req({ teamId: 't1', questionNumber: 1, points: 2 }));
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe('ALREADY_SCORED');

    // The duplicate write must not have overwritten the original value.
    expect(client.models.Score._store.get('t1#1')?.points).toBe(1);
  });
});
