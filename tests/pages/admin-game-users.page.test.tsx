import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { generateClient } from 'aws-amplify/data';
import { makeGame, makeTeam } from '../support/factories';
import type { FakeDataClient } from '../support/amplify-mock';

vi.mock('aws-amplify/data', async () => {
  const { createFakeDataClient } = await import('../support/amplify-mock');
  const client = createFakeDataClient();
  return { generateClient: () => client };
});
vi.mock('@/app/lib/liveQuery', async () => {
  const { createLiveRegistry } = await import('../support/live-mock');
  const registry = createLiveRegistry();
  return { subscribeLive: registry.subscribeLive, __registry: registry };
});

const { __registry: live } = (await import('@/app/lib/liveQuery')) as unknown as {
  __registry: import('../support/live-mock').LiveRegistry;
};
const client = generateClient() as unknown as FakeDataClient;
const AdminGameUsersPage = (await import('@/app/admin/games/[slug]/users/page')).default;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

async function renderPage(slug = 'g1') {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <Suspense fallback={<div>loading params</div>}>
        <AdminGameUsersPage params={Promise.resolve({ slug })} />
      </Suspense>
    );
  });
  return result;
}

async function syncGame(slug: string, overrides: Parameters<typeof makeGame>[0] = {}) {
  const existing = client.models.Game._store.get(slug);
  const game = existing ? { ...existing, ...overrides } : makeGame({ slug, ...overrides });
  client.models.Game._store.set(slug, game);
  await act(async () => {
    live.emit(`game:bySlug:${slug}`, { items: [game], isSynced: true });
    live.emit(`team:byGame:${slug}`, {
      items: [...client.models.Team._store.values()],
      isSynced: true,
    });
  });
}

describe('AdminGameUsersPage', () => {
  beforeEach(() => {
    client._resetAll();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {})));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the toggle as enabled when scoringOpen is true', async () => {
    await renderPage();
    await syncGame('g1', { scoringOpen: true });
    expect(await screen.findByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it.each([null, undefined])(
    'treats scoringOpen: %p as enabled (defaults to open)',
    async (scoringOpen) => {
      await renderPage();
      await syncGame('g1', { scoringOpen });
      expect(await screen.findByRole('switch')).toHaveAttribute('aria-checked', 'true');
    }
  );

  it('shows the toggle as disabled when scoringOpen is false', async () => {
    await renderPage();
    await syncGame('g1', { scoringOpen: false });
    expect(await screen.findByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('toggling from enabled sets scoringOpen to false', async () => {
    await renderPage();
    await syncGame('g1', { scoringOpen: true });
    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    await vi.waitFor(() => {
      expect(client.models.Game._store.get('g1')?.scoringOpen).toBe(false);
    });
  });

  it('toggling from a null/undefined (default-open) state sets scoringOpen to false, not true', async () => {
    // Bug #4 regression: the old `entryDisabled` naming inverted this in a
    // way that was only correct by coincidence — pin the exact transition.
    await renderPage();
    await syncGame('g1', { scoringOpen: undefined });
    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    await vi.waitFor(() => {
      expect(client.models.Game._store.get('g1')?.scoringOpen).toBe(false);
    });
  });

  it('toggling from disabled sets scoringOpen back to true', async () => {
    await renderPage();
    await syncGame('g1', { scoringOpen: false });
    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    await vi.waitFor(() => {
      expect(client.models.Game._store.get('g1')?.scoringOpen).toBe(true);
    });
  });

  it('bug #4 regression: surfaces an error when the toggle write throws, instead of failing silently', async () => {
    await renderPage();
    await syncGame('g1', { scoringOpen: true });
    vi.mocked(client.models.Game.update).mockRejectedValueOnce(new Error('boom'));

    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    expect(await screen.findByText('Failed to update scorekeeper entry.')).toBeInTheDocument();
  });

  it('generates QR codes for all teams via POST /api/scorekeeper/generate', async () => {
    await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1', name: 'Team One' }));
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { tokens: [] }));
    await renderPage();
    await syncGame('g1');
    await screen.findByRole('button', { name: 'Generate QR Codes' });

    fireEvent.click(screen.getByRole('button', { name: 'Generate QR Codes' }));

    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/scorekeeper/generate',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ gameId: 'g1' }) })
      )
    );
  });

  it('retries End Game up to 3 times on failure, then shows the last error', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (url === '/api/scorekeeper/end-game') {
        return jsonResponse(500, { error: 'Server busy' });
      }
      return jsonResponse(200, {});
    });
    await renderPage();
    await syncGame('g1');

    fireEvent.click(await screen.findByRole('button', { name: 'End Game' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Server busy', {}, { timeout: 4000 })).toBeInTheDocument();
    const endGameCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => url === '/api/scorekeeper/end-game');
    expect(endGameCalls).toHaveLength(3);
  }, 8000);

  it('reports the deleted count on a successful End Game', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (url === '/api/scorekeeper/end-game') {
        return jsonResponse(200, { success: true, deleted: 2, failures: 0 });
      }
      return jsonResponse(200, {});
    });
    await renderPage();
    await syncGame('g1');

    fireEvent.click(await screen.findByRole('button', { name: 'End Game' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/Deleted 2 scorekeeper/)).toBeInTheDocument();
  });

  it('shows active scorekeepers bound to teams', async () => {
    await client.models.Team.create(
      makeTeam({
        id: 't1',
        gameId: 'g1',
        name: 'Team One',
        scorekeeperUserId: 'sk-1',
        scorekeeperEmail: 'team-t1@bible-bowl.internal',
      })
    );
    await renderPage();
    await syncGame('g1');

    expect(await screen.findByText('Active Scorekeepers')).toBeInTheDocument();
    expect(screen.getByText('team-t1@bible-bowl.internal')).toBeInTheDocument();
  });
});
