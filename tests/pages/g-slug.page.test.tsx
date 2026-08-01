import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { makeGame, makeScore, makeTeam } from '../support/factories';

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
// next/navigation's real notFound() throws a special digest to trigger the
// framework's not-found boundary; mock it the same way so the test can
// assert it was invoked without a real Next router context.
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('qrcode.react', () => ({ QRCodeSVG: () => null }));

const { __registry: live } = (await import('@/app/lib/liveQuery')) as unknown as {
  __registry: import('../support/live-mock').LiveRegistry;
};
const GameLeaderboardPage = (await import('@/app/g/[slug]/page')).default;

async function renderPage(slug = 'g1') {
  let result!: ReturnType<typeof render>;
  // `use(params)` suspends for at least one microtask; wrapping the initial
  // render in an awaited `act` lets React flush that suspension (and run the
  // resulting effects, including the subscribeLive calls) before the test
  // proceeds, instead of leaving the component suspended mid-`act`.
  await act(async () => {
    result = render(
      <Suspense fallback={<div>loading params</div>}>
        <GameLeaderboardPage params={Promise.resolve({ slug })} />
      </Suspense>
    );
  });
  return result;
}

describe('GameLeaderboardPage (/g/[slug])', () => {
  beforeEach(() => {
    vi.mocked(fetchAuthSession).mockResolvedValue({} as never); // unauthenticated -> iam mode
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows "Waiting to start" before the game has a currentQuestion, then live-updates totals', async () => {
    await renderPage('g1');
    await vi.waitFor(() => expect(live.subscriberCount('game:bySlug:g1:iam')).toBeGreaterThan(0));

    live.emit('game:bySlug:g1:iam', {
      items: [makeGame({ slug: 'g1', currentQuestion: null })],
      isSynced: true,
    });
    live.emit('team:byGame:g1:iam', {
      items: [makeTeam({ id: 't1', name: 'Team One' })],
      isSynced: true,
    });
    live.emit('score:byGame:g1:iam', { items: [], isSynced: true });

    expect(await screen.findByText('Waiting to start')).toBeInTheDocument();
    expect(screen.getByText('Team One')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument(); // total

    // A live score delta updates the total without a page refresh.
    live.emit('score:byGame:g1:iam', {
      items: [makeScore({ teamId: 't1', questionNumber: 1, points: 3 })],
      isSynced: true,
    });
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('shows "Question N" with the current question once the game is initialized', async () => {
    await renderPage('g1');
    await vi.waitFor(() => expect(live.subscriberCount('game:bySlug:g1:iam')).toBeGreaterThan(0));
    live.emit('game:bySlug:g1:iam', {
      items: [makeGame({ slug: 'g1', currentQuestion: 5 })],
      isSynced: true,
    });
    live.emit('team:byGame:g1:iam', { items: [], isSynced: true });
    live.emit('score:byGame:g1:iam', { items: [], isSynced: true });

    expect(await screen.findByText('Question 5')).toBeInTheDocument();
  });

  it('renders a 404 only after the game subscription has synced and found zero rows', async () => {
    const notFound = (await import('next/navigation')).notFound;
    await renderPage('missing-game');
    await vi.waitFor(() =>
      expect(live.subscriberCount('game:bySlug:missing-game:iam')).toBeGreaterThan(0)
    );

    // Not synced yet — must NOT call notFound even with zero items.
    live.emit('game:bySlug:missing-game:iam', { items: [], isSynced: false });
    expect(notFound).not.toHaveBeenCalled();

    // Still loading (team/score streams haven't synced) — notFound is called
    // internally once gameSynced flips, but the actual notFound() throw only
    // surfaces once `loading` is also false. Sync the other two streams too.
    live.emit('team:byGame:missing-game:iam', { items: [], isSynced: true });
    live.emit('score:byGame:missing-game:iam', { items: [], isSynced: true });

    // Now sync the game stream with zero rows — this is the trigger. The
    // `notFound()` throw happens during the render `act()` flushes, not
    // synchronously inside the listener call itself, so the emit must be
    // wrapped in `act()` for the throw to propagate here.
    expect(() => {
      act(() => {
        live.emit('game:bySlug:missing-game:iam', { items: [], isSynced: true });
      });
    }).toThrow('NEXT_NOT_FOUND');
  });

  it('reads favorited team ids from localStorage on mount', async () => {
    localStorage.setItem('bb_favorite', JSON.stringify(['t1']));
    await renderPage('g1');
    await vi.waitFor(() => expect(live.subscriberCount('game:bySlug:g1:iam')).toBeGreaterThan(0));
    live.emit('game:bySlug:g1:iam', { items: [makeGame({ slug: 'g1' })], isSynced: true });
    live.emit('team:byGame:g1:iam', {
      items: [makeTeam({ id: 't1', name: 'Team One' })],
      isSynced: true,
    });
    live.emit('score:byGame:g1:iam', { items: [], isSynced: true });

    expect(await screen.findByText('★ Your Team')).toBeInTheDocument();
  });

  it('persists a favorite toggle to localStorage', async () => {
    await renderPage('g1');
    await vi.waitFor(() => expect(live.subscriberCount('game:bySlug:g1:iam')).toBeGreaterThan(0));
    live.emit('game:bySlug:g1:iam', { items: [makeGame({ slug: 'g1' })], isSynced: true });
    live.emit('team:byGame:g1:iam', {
      items: [makeTeam({ id: 't1', name: 'Team One' })],
      isSynced: true,
    });
    live.emit('score:byGame:g1:iam', { items: [], isSynced: true });
    await screen.findByText('Team One');

    const star = screen.getByRole('button', { name: 'Set as favorite' });
    star.click();

    await vi.waitFor(() => {
      expect(JSON.parse(localStorage.getItem('bb_favorite') ?? '[]')).toEqual(['t1']);
    });
  });
});
