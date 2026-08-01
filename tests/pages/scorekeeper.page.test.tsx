import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { makeGame, makeTeam } from '../support/factories';

vi.mock('aws-amplify/data', async () => {
  const { createFakeDataClient } = await import('../support/amplify-mock');
  return { generateClient: () => createFakeDataClient() };
});
vi.mock('aws-amplify/auth', () => ({ fetchAuthSession: vi.fn() }));
vi.mock('@/app/lib/liveQuery', async () => {
  const { createLiveRegistry } = await import('../support/live-mock');
  const registry = createLiveRegistry();
  return { subscribeLive: registry.subscribeLive, __registry: registry };
});

const { __registry: live } = (await import('@/app/lib/liveQuery')) as unknown as {
  __registry: import('../support/live-mock').LiveRegistry;
};
const ScorekeeperPage = (await import('@/app/scorekeeper/page')).default;

async function renderPage() {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<ScorekeeperPage />);
  });
  return result;
}

describe('ScorekeeperPage', () => {
  beforeEach(() => {
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: { accessToken: { payload: { sub: 'sk-sub-1' } } },
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows a loading spinner until the team stream syncs', async () => {
    const { container } = await renderPage();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows GameEndedView when the game has scoringOpen: false', async () => {
    const { container } = await renderPage();
    await act(async () => {
      live.emit('team:byScorekeeper:sk-sub-1', {
        items: [makeTeam({ id: 't1', gameId: 'g1', scorekeeperUserId: 'sk-sub-1' })],
        isSynced: true,
      });
    });
    await act(async () => {
      live.emit('game:bySlug:g1', {
        items: [makeGame({ slug: 'g1', scoringOpen: false })],
        isSynced: true,
      });
    });
    await act(async () => {
      live.emit('score:byTeam:t1', { items: [], isSynced: true });
    });

    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
    expect(await screen.findByText('Scoring is closed')).toBeInTheDocument();
  });

  it('shows "No team assigned" when the scorekeeper has no bound team', async () => {
    await renderPage();
    await act(async () => {
      live.emit('team:byScorekeeper:sk-sub-1', { items: [], isSynced: true });
    });

    expect(await screen.findByText('No team assigned')).toBeInTheDocument();
  });

  it('shows the ScoreEntry form once the team and game are both synced and scoring is open', async () => {
    await renderPage();
    await act(async () => {
      live.emit('team:byScorekeeper:sk-sub-1', {
        items: [
          makeTeam({ id: 't1', gameId: 'g1', name: 'Grace Chapel', scorekeeperUserId: 'sk-sub-1' }),
        ],
        isSynced: true,
      });
    });
    await act(async () => {
      live.emit('game:bySlug:g1', {
        items: [makeGame({ slug: 'g1', currentQuestion: 3, scoringOpen: true })],
        isSynced: true,
      });
    });
    await act(async () => {
      live.emit('score:byTeam:t1', { items: [], isSynced: true });
    });

    expect(await screen.findByText('Grace Chapel')).toBeInTheDocument();
    expect(screen.getByText('Question 3')).toBeInTheDocument();
  });

  it('remounts ScoreEntry (resetting its submitted state) when the question advances', async () => {
    await renderPage();
    await act(async () => {
      live.emit('team:byScorekeeper:sk-sub-1', {
        items: [
          makeTeam({ id: 't1', gameId: 'g1', name: 'Grace Chapel', scorekeeperUserId: 'sk-sub-1' }),
        ],
        isSynced: true,
      });
    });
    await act(async () => {
      live.emit('game:bySlug:g1', {
        items: [makeGame({ slug: 'g1', currentQuestion: 1, scoringOpen: true })],
        isSynced: true,
      });
    });
    await act(async () => {
      live.emit('score:byTeam:t1', {
        items: [{ id: 't1#1', teamId: 't1', questionNumber: 1, points: 2 }],
        isSynced: true,
      });
    });

    // Already scored Q1 -> confirmation card shown.
    expect(await screen.findByText('Score submitted ✓')).toBeInTheDocument();

    // Admin advances to Q2 — ScoreEntry remounts via key={currentQuestion},
    // discarding its old (now-stale) submitted state.
    await act(async () => {
      live.emit('game:bySlug:g1', {
        items: [makeGame({ slug: 'g1', currentQuestion: 2, scoringOpen: true })],
        isSynced: true,
      });
    });

    expect(screen.getByText('Question 2')).toBeInTheDocument();
    expect(screen.queryByText('Score submitted ✓')).not.toBeInTheDocument();
  });
});
