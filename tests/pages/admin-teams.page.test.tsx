import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import userEvent from '@testing-library/user-event';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import { makeTeam } from '../support/factories';
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
const AdminTeamsPage = (await import('@/app/admin/games/[slug]/teams/page')).default;

async function renderPage(slug = 'g1') {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <Suspense fallback={<div>loading params</div>}>
        <AdminTeamsPage params={Promise.resolve({ slug })} />
      </Suspense>
    );
  });
  return result;
}

async function syncTeams(slug = 'g1') {
  await act(async () => {
    live.emit(`team:byGame:${slug}`, {
      items: [...client.models.Team._store.values()],
      isSynced: true,
    });
  });
}

describe('AdminTeamsPage', () => {
  beforeEach(() => {
    client._resetAll();
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: { accessToken: { payload: { sub: 'owner-1' } } },
    } as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows "No teams yet" when the game has no teams', async () => {
    await renderPage();
    await syncTeams();
    expect(await screen.findByText('No teams yet.')).toBeInTheDocument();
  });

  it('rejects adding a team with a blank (whitespace-only) name', async () => {
    await renderPage();
    await syncTeams();
    await userEvent.type(screen.getByPlaceholderText('Church name'), '   ');
    expect(screen.getByRole('button', { name: 'Add Team' })).toBeDisabled();
  });

  it('adds a team with the trimmed name and selected group', async () => {
    await renderPage();
    await syncTeams();
    await userEvent.type(screen.getByPlaceholderText('Church name'), '  Grace Chapel  ');
    await userEvent.click(screen.getByRole('button', { name: 'Add Team' }));

    await vi.waitFor(() => {
      const created = [...client.models.Team._store.values()].find(
        (t) => t.name === 'Grace Chapel'
      );
      expect(created).toMatchObject({ name: 'Grace Chapel', groupType: 'Teen', gameId: 'g1' });
    });
  });

  it('renames a team inline', async () => {
    await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1', name: 'Old Name' }));
    await renderPage();
    await syncTeams();
    await screen.findByText('Old Name');

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByDisplayValue('Old Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'New Name{enter}');

    await vi.waitFor(() => {
      expect(client.models.Team._store.get('t1')?.name).toBe('New Name');
    });
  });

  it("changes a team's group inline", async () => {
    await client.models.Team.create(
      makeTeam({ id: 't1', gameId: 'g1', name: 'Team One', groupType: 'Teen' })
    );
    await renderPage();
    await syncTeams();
    await screen.findByText('Team One');

    await userEvent.selectOptions(screen.getByLabelText('Group for Team One'), 'Adult');

    await vi.waitFor(() => {
      expect(client.models.Team._store.get('t1')?.groupType).toBe('Adult');
    });
  });

  it('bulk-adds teams from the modal with sequential displayOrder values', async () => {
    await renderPage();
    await syncTeams();
    await userEvent.click(screen.getByRole('button', { name: 'Bulk add' }));

    await userEvent.type(screen.getByLabelText('Team names'), 'Church A{enter}Church B');
    await userEvent.type(screen.getByLabelText('Team types'), 'Teen');
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 teams' }));

    await vi.waitFor(() => {
      const teams = [...client.models.Team._store.values()].sort(
        (a, b) => (Number(a.displayOrder) ?? 0) - (Number(b.displayOrder) ?? 0)
      );
      expect(teams.map((t) => t.name)).toEqual(['Church A', 'Church B']);
      expect(teams.map((t) => t.displayOrder)).toEqual([0, 1]);
    });
  });

  it('deleting a single team also deletes its Score rows (bug #11 fix: no orphaned scores)', async () => {
    await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1', name: 'Team One' }));
    await client.models.Score.create({
      id: 't1#1',
      gameId: 'g1',
      ownerId: 'owner-1',
      teamId: 't1',
      questionNumber: 1,
      points: 2,
    });
    await renderPage();
    await syncTeams();
    await screen.findByText('Team One');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await vi.waitFor(() => {
      expect(client.models.Team._store.has('t1')).toBe(false);
    });
    expect(client.models.Score._store.has('t1#1')).toBe(false);
  });

  it('shows an error and keeps the team when its score deletion fails', async () => {
    await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1', name: 'Team One' }));
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
    await syncTeams();
    await screen.findByText('Team One');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/Failed to delete 1 score/)).toBeInTheDocument();
    expect(client.models.Team._store.has('t1')).toBe(true); // team NOT deleted
  });

  it('does not delete a team if the confirmation dialog is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1', name: 'Team One' }));
    await renderPage();
    await syncTeams();
    await screen.findByText('Team One');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(client.models.Team._store.has('t1')).toBe(true);
  });

  it('"Delete all" removes every team and every score for the game', async () => {
    await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1', name: 'Team One' }));
    await client.models.Team.create(makeTeam({ id: 't2', gameId: 'g1', name: 'Team Two' }));
    await client.models.Score.create({
      id: 't1#1',
      gameId: 'g1',
      ownerId: 'owner-1',
      teamId: 't1',
      questionNumber: 1,
      points: 2,
    });
    await renderPage();
    await syncTeams();
    await screen.findByText('Team One');

    await userEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await vi.waitFor(() => {
      expect(client.models.Team._store.size).toBe(0);
    });
    expect(client.models.Score._store.size).toBe(0);
  });

  it('reports a partial failure during "Delete all" without silently succeeding', async () => {
    await client.models.Team.create(makeTeam({ id: 't1', gameId: 'g1', name: 'Team One' }));
    await client.models.Team.create(makeTeam({ id: 't2', gameId: 'g1', name: 'Team Two' }));
    client.models.Team._failNext('delete', { message: 'boom' });
    await renderPage();
    await syncTeams();
    await screen.findByText('Team One');

    await userEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/Failed to delete 1 team/)).toBeInTheDocument();
  });
});
