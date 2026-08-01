/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import { getServerSession } from '@/app/lib/auth';
import { makeGame, makeTeam, makeToken } from '../support/factories';
import { asAdmin, asAnon, asSuperAdmin } from '../support/session';
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

const { POST } = await import('@/app/api/scorekeeper/generate/route');

const client = generateServerClientUsingCookies({} as never) as unknown as FakeDataClient;

function req(body: unknown): Request {
  return new Request('http://localhost/api/scorekeeper/generate', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/scorekeeper/generate', () => {
  beforeEach(() => {
    client._resetAll();
    vi.mocked(getServerSession).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns 401 for a non-admin caller', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAnon());
    const res = await POST(req({ gameId: 'g1' }));
    expect(res.status).toBe(401);
  });

  it('treats malformed JSON as an empty body (400 "gameId is required", not "Invalid JSON body")', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin());
    const res = await POST(req('{not json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'gameId is required' });
  });

  it('returns 400 when gameId is missing', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin());
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'gameId is required' });
  });

  it('returns 404 when the game does not exist', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin());
    const res = await POST(req({ gameId: 'no-such-game' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Game not found.');
  });

  it('returns 403 when a non-owner, non-super-admin requests generation', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'not-the-owner' }));
    await client.models.Game.create(makeGame({ slug: 'g1', ownerId: 'owner-1' }));
    const res = await POST(req({ gameId: 'g1' }));
    expect(res.status).toBe(403);
  });

  it('allows a SuperAdmin to generate for a game they do not own', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin({ sub: 'not-the-owner' }));
    await client.models.Game.create(makeGame({ slug: 'g1', ownerId: 'owner-1' }));
    const res = await POST(req({ gameId: 'g1' }));
    expect(res.status).toBe(200);
  });

  describe('single-team regeneration', () => {
    it('returns 404 when the team does not exist', async () => {
      vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
      await client.models.Game.create(makeGame({ slug: 'g1', ownerId: 'owner-1' }));
      const res = await POST(req({ gameId: 'g1', teamId: 'ghost-team' }));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Team not found.');
    });

    it('returns 400 when the team belongs to a different game', async () => {
      vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
      await client.models.Game.create(makeGame({ slug: 'g1', ownerId: 'owner-1' }));
      await client.models.Team.create(makeTeam({ id: 't1', gameId: 'other-game' }));
      const res = await POST(req({ gameId: 'g1', teamId: 't1' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Team does not belong to this game.');
    });

    it("consumes only that team's outstanding UNUSED tokens in this game before issuing a new one", async () => {
      vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
      await client.models.Game.create(makeGame({ slug: 'g1', ownerId: 'owner-1' }));
      await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1', name: 'Team One' }));
      await client.models.Team.create(makeTeam({ id: 't2', gameId: 'g1', name: 'Team Two' }));
      await client.models.OnboardingToken.create(
        makeToken({ tokenId: 'old-t1', gameId: 'g1', teamId: 't1', status: 'UNUSED' })
      );
      await client.models.OnboardingToken.create(
        makeToken({ tokenId: 'old-t2', gameId: 'g1', teamId: 't2', status: 'UNUSED' })
      );
      await client.models.OnboardingToken.create(
        makeToken({
          tokenId: 'already-consumed-t1',
          gameId: 'g1',
          teamId: 't1',
          status: 'CONSUMED',
        })
      );

      const res = await POST(req({ gameId: 'g1', teamId: 't1' }));
      expect(res.status).toBe(200);

      expect(client.models.OnboardingToken._store.get('old-t1')?.status).toBe('CONSUMED');
      // Team 2's outstanding token is untouched by a single-team regeneration.
      expect(client.models.OnboardingToken._store.get('old-t2')?.status).toBe('UNUSED');

      const body = await res.json();
      expect(body.tokens).toHaveLength(1);
      expect(body.tokens[0]).toMatchObject({
        teamId: 't1',
        teamName: 'Team One',
        status: 'UNUSED',
      });
    });

    it('sets the new token to expire 8 hours from now', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
      vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
      await client.models.Game.create(makeGame({ slug: 'g1', ownerId: 'owner-1' }));
      await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1' }));

      const res = await POST(req({ gameId: 'g1', teamId: 't1' }));
      const body = await res.json();
      expect(body.tokens[0].tokenId).toBeDefined();
      const stored = client.models.OnboardingToken._store.get(body.tokens[0].tokenId);
      expect(stored?.expiresAt).toBe('2026-03-01T08:00:00.000Z');
      vi.useRealTimers();
    });
  });

  describe('bulk regeneration (no teamId)', () => {
    it('creates one token per team and consumes all outstanding UNUSED tokens for the game', async () => {
      vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
      await client.models.Game.create(makeGame({ slug: 'g1', ownerId: 'owner-1' }));
      await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1', name: 'Team One' }));
      await client.models.Team.create(makeTeam({ id: 't2', gameId: 'g1', name: 'Team Two' }));
      await client.models.OnboardingToken.create(
        makeToken({ tokenId: 'old-t1', gameId: 'g1', teamId: 't1', status: 'UNUSED' })
      );
      await client.models.OnboardingToken.create(
        makeToken({ tokenId: 'old-t2', gameId: 'g1', teamId: 't2', status: 'UNUSED' })
      );

      const res = await POST(req({ gameId: 'g1' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tokens).toHaveLength(2);
      expect(client.models.OnboardingToken._store.get('old-t1')?.status).toBe('CONSUMED');
      expect(client.models.OnboardingToken._store.get('old-t2')?.status).toBe('CONSUMED');
    });

    it('orders the bulk response by compareTeamOrder (displayOrder, then name)', async () => {
      vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
      await client.models.Game.create(makeGame({ slug: 'g1', ownerId: 'owner-1' }));
      await client.models.Team.create(
        makeTeam({ id: 't-b', gameId: 'g1', name: 'B Team', displayOrder: 1 })
      );
      await client.models.Team.create(
        makeTeam({ id: 't-a', gameId: 'g1', name: 'A Team', displayOrder: 0 })
      );

      const res = await POST(req({ gameId: 'g1' }));
      const body = await res.json();
      expect(body.tokens.map((t: { teamId: string }) => t.teamId)).toEqual(['t-a', 't-b']);
    });

    it("does not touch a different game's outstanding tokens", async () => {
      vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
      await client.models.Game.create(makeGame({ slug: 'g1', ownerId: 'owner-1' }));
      await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1' }));
      await client.models.OnboardingToken.create(
        makeToken({ tokenId: 'other-game-token', gameId: 'g2', teamId: 'x', status: 'UNUSED' })
      );

      await POST(req({ gameId: 'g1' }));
      expect(client.models.OnboardingToken._store.get('other-game-token')?.status).toBe('UNUSED');
    });
  });
});
