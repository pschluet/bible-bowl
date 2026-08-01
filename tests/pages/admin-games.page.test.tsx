import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fetchAuthSession } from 'aws-amplify/auth';
import { makeGame } from '../support/factories';

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
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { __registry: live } = (await import('@/app/lib/liveQuery')) as unknown as {
  __registry: import('../support/live-mock').LiveRegistry;
};
const AdminGamesPage = (await import('@/app/admin/games/page')).default;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

function sessionFor(sub: string, groups: string[] = []) {
  return { tokens: { accessToken: { payload: { sub, 'cognito:groups': groups } } } };
}

async function renderPage() {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<AdminGamesPage />);
  });
  return result;
}

describe('AdminGamesPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { users: [] })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('auto-derives the slug from the title until the slug field is manually edited', async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue(sessionFor('owner-1') as never);
    await renderPage();

    await userEvent.type(screen.getByLabelText('Title'), 'My Game!');
    expect(screen.getByLabelText(/Game Code/)).toHaveValue('my-game');

    await userEvent.clear(screen.getByLabelText(/Game Code/));
    await userEvent.type(screen.getByLabelText(/Game Code/), 'custom-code');
    // Further title edits no longer overwrite the manually-edited slug.
    await userEvent.type(screen.getByLabelText('Title'), '!!!');
    expect(screen.getByLabelText(/Game Code/)).toHaveValue('custom-code');
  });

  it("shows only the current admin's own games (ownership filtering)", async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue(sessionFor('owner-1') as never);
    await renderPage();
    await act(async () => {
      live.emit('game:all:userPool', {
        items: [
          makeGame({ slug: 'mine', title: 'My Game', ownerId: 'owner-1' }),
          makeGame({ slug: 'theirs', title: 'Their Game', ownerId: 'owner-2' }),
        ],
        isSynced: true,
      });
    });

    expect(await screen.findByText('My Game')).toBeInTheDocument();
    expect(screen.queryByText('Their Game')).not.toBeInTheDocument();
  });

  it("a SuperAdmin sees every game, with the owning admin's email shown for games they do not own", async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue(sessionFor('super-1', ['SuperAdmins']) as never);
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { users: [{ sub: 'owner-2', email: 'owner2@church.org' }] })
    );
    await renderPage();
    await act(async () => {
      live.emit('game:all:userPool', {
        items: [
          makeGame({ slug: 'mine', title: 'My Game', ownerId: 'super-1' }),
          makeGame({ slug: 'theirs', title: 'Their Game', ownerId: 'owner-2' }),
        ],
        isSynced: true,
      });
    });

    expect(await screen.findByText('My Game')).toBeInTheDocument();
    expect(screen.getByText('Their Game')).toBeInTheDocument();
    expect(screen.getByText(/Owner: owner2@church.org/)).toBeInTheDocument();
  });

  it('creates a game via POST /api/admin/games', async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue(sessionFor('owner-1') as never);
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (url === '/api/admin/users') return jsonResponse(200, { users: [] });
      return jsonResponse(200, { slug: 'my-game' });
    });
    await renderPage();

    await userEvent.type(screen.getByLabelText('Title'), 'My Game');
    await userEvent.click(screen.getByRole('button', { name: 'Create Game' }));

    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/admin/games',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'My Game', slug: 'my-game' }),
        })
      )
    );
  });

  // Real timers: the component's retry backoff (500ms * attempt) is a fixed
  // implementation detail, not injectable, and combining vi.useFakeTimers()
  // with RTL's act()/waitFor() polling here reliably deadlocked. 3 attempts
  // is at most ~1.5s of real backoff, well under the per-test timeout below.
  it('retries a failed delete up to 3 times, then gives up and shows the error', async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue(sessionFor('owner-1') as never);
    vi.mocked(fetch).mockImplementation(async (url, opts) => {
      if (url === '/api/admin/users') return jsonResponse(200, { users: [] });
      if ((opts as RequestInit)?.method === 'DELETE') {
        return jsonResponse(500, { error: 'Server error' });
      }
      return jsonResponse(200, {});
    });
    await renderPage();
    await act(async () => {
      live.emit('game:all:userPool', {
        items: [makeGame({ slug: 'g1', title: 'My Game', ownerId: 'owner-1' })],
        isSynced: true,
      });
    });
    await screen.findByText('My Game');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Server error', {}, { timeout: 4000 })).toBeInTheDocument();
    const deleteCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([, opts]) => (opts as RequestInit)?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(3);
  }, 8000);

  it('stops retrying immediately on a 404 (already gone)', async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue(sessionFor('owner-1') as never);
    vi.mocked(fetch).mockImplementation(async (url, opts) => {
      if (url === '/api/admin/users') return jsonResponse(200, { users: [] });
      if ((opts as RequestInit)?.method === 'DELETE') {
        return jsonResponse(404, { error: 'Game not found.' });
      }
      return jsonResponse(200, {});
    });
    await renderPage();
    await act(async () => {
      live.emit('game:all:userPool', {
        items: [makeGame({ slug: 'g1', title: 'My Game', ownerId: 'owner-1' })],
        isSynced: true,
      });
    });
    await screen.findByText('My Game');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await vi.waitFor(() => {
      const deleteCalls = vi
        .mocked(fetch)
        .mock.calls.filter(([, opts]) => (opts as RequestInit)?.method === 'DELETE');
      expect(deleteCalls).toHaveLength(1);
    });
    // No second attempt follows even after waiting past the retry backoff.
    await new Promise((r) => setTimeout(r, 600));
    const deleteCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([, opts]) => (opts as RequestInit)?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(1);
  });
});
