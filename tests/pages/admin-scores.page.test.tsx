import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { Suspense } from 'react';
import userEvent from '@testing-library/user-event';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import { makeGame, makeTeam } from '../support/factories';
import type { FakeDataClient } from '../support/amplify-mock';

vi.mock('aws-amplify/data', async () => {
  const { createFakeDataClient } = await import('../support/amplify-mock');
  const client = createFakeDataClient();
  return { generateClient: () => client };
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
const client = generateClient() as unknown as FakeDataClient;
const AdminScoresPage = (await import('@/app/admin/games/[slug]/scores/page')).default;

async function renderPage(slug = 'g1') {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <Suspense fallback={<div>loading params</div>}>
        <AdminScoresPage params={Promise.resolve({ slug })} />
      </Suspense>
    );
  });
  return result;
}

/**
 * Seeds (or updates) the Game row directly in the fake data client's store,
 * then emits the empty team/score streams and that SAME stored object as the
 * game snapshot — so the rendered state and the store are never allowed to
 * drift apart the way two independently-constructed `makeGame()` fixtures
 * could.
 */
async function seedAndSync(slug: string, overrides: Parameters<typeof makeGame>[0] = {}) {
  const existing = client.models.Game._store.get(slug);
  const game = existing ? { ...existing, ...overrides } : makeGame({ slug, ...overrides });
  client.models.Game._store.set(slug, game);
  await act(async () => {
    live.emit(`team:byGame:${slug}`, { items: [], isSynced: true });
    live.emit(`score:byGame:${slug}`, { items: [], isSynced: true });
    live.emit(`game:bySlug:${slug}`, { items: [game], isSynced: true });
  });
}

describe('AdminScoresPage', () => {
  beforeEach(() => {
    client._resetAll();
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: { accessToken: { payload: { sub: 'owner-1' } } },
    } as never);
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows "Initialize Game" when the game has no currentQuestion yet', async () => {
    await renderPage();
    await seedAndSync('g1', { currentQuestion: null });
    expect(await screen.findByRole('button', { name: 'Initialize Game' })).toBeInTheDocument();
  });

  it('initializes the game with currentQuestion/maxQuestionReached: 1 and scoringOpen: true', async () => {
    await renderPage();
    await seedAndSync('g1', { currentQuestion: null });
    await userEvent.click(await screen.findByRole('button', { name: 'Initialize Game' }));

    await vi.waitFor(() => {
      const game = client.models.Game._store.get('g1');
      expect(game).toMatchObject({ currentQuestion: 1, maxQuestionReached: 1, scoringOpen: true });
    });
  });

  it('"Next Question" ratchets maxQuestionReached up, never down', async () => {
    await renderPage();
    await seedAndSync('g1', { currentQuestion: 2, maxQuestionReached: 5 });

    await userEvent.click(await screen.findByRole('button', { name: 'Next Question' }));
    await vi.waitFor(() => {
      const game = client.models.Game._store.get('g1');
      // currentQuestion advances to 3, but maxQuestionReached stays 5 (already higher).
      expect(game).toMatchObject({ currentQuestion: 3, maxQuestionReached: 5 });
    });
  });

  it('"Next Question" raises maxQuestionReached when advancing past the previous high-water mark', async () => {
    await renderPage();
    await seedAndSync('g1', { currentQuestion: 1, maxQuestionReached: 1 });

    await userEvent.click(await screen.findByRole('button', { name: 'Next Question' }));
    await vi.waitFor(() => {
      expect(client.models.Game._store.get('g1')).toMatchObject({
        currentQuestion: 2,
        maxQuestionReached: 2,
      });
    });
  });

  it('disables "Previous Question" at question 1', async () => {
    await renderPage();
    await seedAndSync('g1', { currentQuestion: 1 });
    expect(await screen.findByRole('button', { name: 'Previous Question' })).toBeDisabled();
  });

  it('"Previous Question" does not lower maxQuestionReached', async () => {
    await renderPage();
    await seedAndSync('g1', { currentQuestion: 3, maxQuestionReached: 3 });

    await userEvent.click(await screen.findByRole('button', { name: 'Previous Question' }));
    await vi.waitFor(() => {
      const game = client.models.Game._store.get('g1');
      expect(game?.currentQuestion).toBe(2);
      expect(game?.maxQuestionReached).toBe(3); // unchanged
    });
  });

  it('reset aborts and leaves the game state untouched when a score deletion fails', async () => {
    await client.models.Score.create({
      id: 't1#1',
      gameId: 'g1',
      ownerId: 'owner-1',
      teamId: 't1',
      questionNumber: 1,
      points: 2,
    });
    client.models.Score._failNext('delete', { message: 'boom' });
    await renderPage();
    await seedAndSync('g1', { currentQuestion: 4, maxQuestionReached: 4 });

    await userEvent.click(await screen.findByRole('button', { name: /Reset Scores/ }));

    expect(await screen.findByText(/Failed to reset 1 score/)).toBeInTheDocument();
    const game = client.models.Game._store.get('g1');
    expect(game?.currentQuestion).toBe(4); // NOT reset to 1
  });

  it('reset succeeds and resets currentQuestion/maxQuestionReached to 1, keeping teams', async () => {
    await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1' }));
    await client.models.Score.create({
      id: 't1#1',
      gameId: 'g1',
      ownerId: 'owner-1',
      teamId: 't1',
      questionNumber: 1,
      points: 2,
    });
    await renderPage();
    await seedAndSync('g1', { currentQuestion: 4, maxQuestionReached: 4 });

    await userEvent.click(await screen.findByRole('button', { name: /Reset Scores/ }));

    await vi.waitFor(() => {
      expect(client.models.Game._store.get('g1')).toMatchObject({
        currentQuestion: 1,
        maxQuestionReached: 1,
        scoringOpen: true,
      });
    });
    expect(client.models.Score._store.size).toBe(0);
    expect(client.models.Team._store.has('t1')).toBe(true); // teams preserved
  });

  it('does nothing when the reset confirmation dialog is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderPage();
    await seedAndSync('g1', { currentQuestion: 4, maxQuestionReached: 4 });

    await userEvent.click(await screen.findByRole('button', { name: /Reset Scores/ }));
    // No update call happened — currentQuestion is unchanged.
    expect(client.models.Game._store.get('g1')?.currentQuestion).toBe(4);
  });

  it('exports scores as a downloaded CSV', async () => {
    await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1', name: 'Team One' }));
    await renderPage();
    await seedAndSync('g1', { currentQuestion: 1, maxQuestionReached: 1 });
    await act(async () => {
      live.emit('team:byGame:g1', {
        items: [client.models.Team._store.get('t1')],
        isSynced: true,
      });
    });
    await screen.findByText('Team One');

    await userEvent.click(screen.getByRole('button', { name: 'Export Scores' }));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('optimistically shows an entered score before the live subscription confirms it, and writes it via Score.create', async () => {
    await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1', name: 'Team One' }));
    await renderPage();
    await seedAndSync('g1', { currentQuestion: 1, maxQuestionReached: 1 });
    await act(async () => {
      live.emit('team:byGame:g1', {
        items: [client.models.Team._store.get('t1')],
        isSynced: true,
      });
    });
    const row = (await screen.findByText('Team One')).closest('tr')!;

    await userEvent.click(within(row).getByText('–'));
    const dialog = await screen.findByRole('dialog', { name: /Team One/ });
    await userEvent.click(within(dialog).getByRole('button', { name: '3' }));

    // Optimistic UI shows 3 immediately, before any live confirmation — both
    // in the cell and (coincidentally, with only 1 scored question) the total.
    expect(within(row).getAllByText('3')).toHaveLength(2);
    await vi.waitFor(() => {
      expect(client.models.Score._store.get('t1#1')).toMatchObject({ points: 3 });
    });
  });

  it('bug #2 regression: surfaces an error and rolls back the optimistic entry when both the create AND its collision fallback update fail', async () => {
    await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1', name: 'Team One' }));
    await renderPage();
    await seedAndSync('g1', { currentQuestion: 1, maxQuestionReached: 1 });
    await act(async () => {
      live.emit('team:byGame:g1', { items: [client.models.Team._store.get('t1')], isSynced: true });
    });
    const row = (await screen.findByText('Team One')).closest('tr')!;

    // Seed the row directly in the store (bypassing the live stream), so
    // the component's own scoreMap doesn't know about it yet and takes the
    // `create` branch — which will collide, falling back to `update`,
    // which is also forced to fail here. Before the fix, only the `create`
    // collision was detected; the fallback `update`'s own errors were
    // silently discarded and the optimistic "3" stayed on screen forever.
    client.models.Score._store.set('t1#1', {
      id: 't1#1',
      gameId: 'g1',
      ownerId: 'owner-1',
      teamId: 't1',
      questionNumber: 1,
      points: 1,
    });
    client.models.Score._failNext('update', { message: 'boom' });

    await userEvent.click(within(row).getByText('–'));
    const dialog = await screen.findByRole('dialog', { name: /Team One/ });
    await userEvent.click(within(dialog).getByRole('button', { name: '3' }));

    expect(await screen.findByText('Failed to save score.')).toBeInTheDocument();
    await vi.waitFor(() => {
      // The optimistic "3" is rolled back — the cell reverts to blank
      // rather than permanently showing an unsaved value.
      expect(within(row).queryByText('3')).not.toBeInTheDocument();
    });
  }, 8000);

  it('bug #3 regression: reports (rather than silently swallowing) a failed duplicate-score cleanup', async () => {
    await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1', name: 'Team One' }));
    // Two records for the same (teamId, questionNumber) cell — a duplicate
    // the healing pass should collapse to one.
    client.models.Score._store.set('dup-old', {
      id: 'dup-old',
      gameId: 'g1',
      ownerId: 'owner-1',
      teamId: 't1',
      questionNumber: 1,
      points: 1,
      updatedAt: '2020-01-01T00:00:00.000Z',
    });
    client.models.Score._store.set('dup-new', {
      id: 'dup-new',
      gameId: 'g1',
      ownerId: 'owner-1',
      teamId: 't1',
      questionNumber: 1,
      points: 2,
      updatedAt: '2020-01-02T00:00:00.000Z',
    });
    client.models.Score._failNext('delete', { message: 'boom' });
    const game = makeGame({ slug: 'g1', currentQuestion: 1, maxQuestionReached: 1 });
    client.models.Game._store.set('g1', game);
    await renderPage();
    // Emitted in one shot, with the duplicates present on the score stream's
    // FIRST (and only) synced snapshot — the healing pass runs once per page
    // mount, so a separate empty-then-populated sequence (as `seedAndSync`
    // does elsewhere in this file) would consume that one shot on the empty
    // snapshot and never see the duplicates.
    await act(async () => {
      live.emit('game:bySlug:g1', { items: [game], isSynced: true });
      live.emit('team:byGame:g1', { items: [client.models.Team._store.get('t1')], isSynced: true });
      live.emit('score:byGame:g1', {
        items: [...client.models.Score._store.values()],
        isSynced: true,
      });
    });

    expect(
      await screen.findByText(/Failed to clean up 1 duplicate score record/)
    ).toBeInTheDocument();
  });
});
