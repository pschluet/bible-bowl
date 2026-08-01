/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import { getServerSession } from '@/app/lib/auth';
import { makeCognitoClient } from '@/app/lib/cognito';
import { makeGame, makeTeam, makeToken } from '../support/factories';
import { asAdmin, asAnon, asSuperAdmin } from '../support/session';
import { createFakeCognitoClient } from '../support/cognito-mock';
import type { FakeDataClient } from '../support/amplify-mock';

vi.mock('@/app/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/app/lib/cognito', () => ({
  makeCognitoClient: vi.fn(),
  USER_POOL_ID: 'test-user-pool',
}));
vi.mock('@aws-amplify/adapter-nextjs', async () => {
  const { CONTEXT_SPEC_MARKER } = await import('../support/amplify-mock');
  return {
    createServerRunner: () => ({
      runWithAmplifyServerContext: async ({
        operation,
      }: {
        operation: (ctx: Record<string, unknown>) => Promise<unknown>;
      }) => operation({ [CONTEXT_SPEC_MARKER]: true }),
    }),
  };
});
vi.mock('aws-amplify/auth/server', () => ({ fetchAuthSession: vi.fn().mockResolvedValue({}) }));
vi.mock('@aws-amplify/adapter-nextjs/data', async () => {
  const { createFakeDataClient } = await import('../support/amplify-mock');
  const client = createFakeDataClient();
  return {
    generateServerClientUsingCookies: () => client,
    generateServerClientUsingReqRes: () => client,
  };
});

const { POST, DELETE } = await import('@/app/api/admin/games/route');

const client = generateServerClientUsingCookies({} as never) as unknown as FakeDataClient;

function req(method: string, body: unknown): Request {
  return new Request('http://localhost/api/admin/games', {
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/admin/games', () => {
  beforeEach(() => {
    client._resetAll();
    vi.mocked(getServerSession).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns 401 for a non-admin caller', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAnon());
    const res = await POST(req('POST', { title: 'My Game', slug: 'my-game' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 on malformed JSON', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin());
    const res = await POST(req('POST', '{not json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('checks title before slug — a blank title fails even with a valid slug', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin());
    const res = await POST(req('POST', { title: '   ', slug: 'valid-slug' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'title is required' });
  });

  it("returns 400 with validateSlug's message for an invalid/reserved slug", async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin());
    const res = await POST(req('POST', { title: 'My Game', slug: 'admin' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reserved word/);
  });

  it('returns 409 when the slug is already taken', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
    await client.models.Game.create(makeGame({ slug: 'taken-slug' }));
    const res = await POST(req('POST', { title: 'My Game', slug: 'taken-slug' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already taken/);
  });

  it('creates the game with currentQuestion: 1, scoringOpen: true, and ownerId from the session', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
    const res = await POST(req('POST', { title: 'My Game', slug: 'My Game!' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: 'my-game' });

    const stored = client.models.Game._store.get('my-game');
    expect(stored).toMatchObject({
      slug: 'my-game',
      title: 'My Game',
      ownerId: 'owner-1',
      currentQuestion: 1,
      scoringOpen: true,
    });
  });
});

describe('DELETE /api/admin/games', () => {
  let cognito: ReturnType<typeof createFakeCognitoClient>;

  beforeEach(() => {
    client._resetAll();
    vi.mocked(getServerSession).mockReset();
    cognito = createFakeCognitoClient();
    cognito.on('AdminUserGlobalSignOutCommand', () => ({}));
    cognito.on('AdminDeleteUserCommand', () => ({}));
    vi.mocked(makeCognitoClient)
      .mockReset()
      .mockReturnValue(cognito as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns 401 for a non-admin caller', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAnon());
    const res = await DELETE(req('DELETE', { gameId: 'g1' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 on malformed JSON', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin());
    const res = await DELETE(req('DELETE', '{not json'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when gameId is missing', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin());
    const res = await DELETE(req('DELETE', {}));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the game does not exist', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin());
    const res = await DELETE(req('DELETE', { gameId: 'no-such-game' }));
    expect(res.status).toBe(404);
  });

  it('returns 403 for a non-owner, non-super-admin', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'not-the-owner' }));
    await client.models.Game.create(makeGame({ slug: 'g1', ownerId: 'owner-1' }));
    const res = await DELETE(req('DELETE', { gameId: 'g1' }));
    expect(res.status).toBe(403);
  });

  it('allows a SuperAdmin to delete a game they do not own', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin({ sub: 'not-the-owner' }));
    await client.models.Game.create(makeGame({ slug: 'g1', ownerId: 'owner-1' }));
    const res = await DELETE(req('DELETE', { gameId: 'g1' }));
    expect(res.status).toBe(200);
  });

  it('returns 500 when the Cognito client cannot be constructed', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
    await client.models.Game.create(makeGame({ slug: 'g1', ownerId: 'owner-1' }));
    vi.mocked(makeCognitoClient).mockImplementation(() => {
      throw new Error('no creds');
    });
    const res = await DELETE(req('DELETE', { gameId: 'g1' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Server configuration error');
  });

  async function seedFullGame() {
    await client.models.Game.create(makeGame({ slug: 'g1', ownerId: 'owner-1' }));
    await client.models.Team.create(
      makeTeam({ id: 't1', gameId: 'g1', scorekeeperEmail: 'team-t1@bible-bowl.internal' })
    );
    await client.models.Score.create({
      id: 't1#1',
      gameId: 'g1',
      ownerId: 'owner-1',
      teamId: 't1',
      questionNumber: 1,
      points: 2,
    });
    await client.models.OnboardingToken.create(makeToken({ tokenId: 'tok-1', gameId: 'g1' }));
  }

  it('on full success, cascades: scorekeepers signed out+deleted, scores/tokens/teams/game all removed', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
    await seedFullGame();

    const res = await DELETE(req('DELETE', { gameId: 'g1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    expect(client.models.Score._store.size).toBe(0);
    expect(client.models.OnboardingToken._store.size).toBe(0);
    expect(client.models.Team._store.size).toBe(0);
    expect(client.models.Game._store.has('g1')).toBe(false);
    expect(cognito.calls.some((c) => c.command === 'AdminDeleteUserCommand')).toBe(true);
  });

  it('returns 500 and does NOT delete the game when score deletion fails', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
    await seedFullGame();
    client.models.Score._failNext('delete', { message: 'boom' });

    const res = await DELETE(req('DELETE', { gameId: 'g1' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Failed to delete 1 score/);
    // The whole cascade halts: game and team are left in place.
    expect(client.models.Game._store.has('g1')).toBe(true);
    expect(client.models.Team._store.has('t1')).toBe(true);
  });

  it('returns 500 and does NOT delete the game when team deletion fails (scores are still deleted first)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
    await seedFullGame();
    client.models.Team._failNext('delete', { message: 'boom' });

    const res = await DELETE(req('DELETE', { gameId: 'g1' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Failed to delete 1 team/);
    expect(client.models.Score._store.size).toBe(0); // scores already gone
    expect(client.models.Game._store.has('g1')).toBe(true); // game preserved
  });

  it('does not let a token-deletion failure block the rest of the cascade (non-fatal)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
    await seedFullGame();
    client.models.OnboardingToken._failNext('delete', { message: 'boom' });

    const res = await DELETE(req('DELETE', { gameId: 'g1' }));
    expect(res.status).toBe(200);
    expect(client.models.Game._store.has('g1')).toBe(false);
  });

  it("does not touch a different game's data", async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin({ sub: 'owner-1' }));
    await seedFullGame();
    await client.models.Game.create(makeGame({ slug: 'g2', ownerId: 'owner-1' }));
    await client.models.Team.create(makeTeam({ id: 't2', gameId: 'g2' }));

    await DELETE(req('DELETE', { gameId: 'g1' }));
    expect(client.models.Game._store.has('g2')).toBe(true);
    expect(client.models.Team._store.has('t2')).toBe(true);
  });
});
