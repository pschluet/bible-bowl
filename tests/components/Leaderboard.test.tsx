import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Leaderboard, { type LeaderboardTeam } from '@/app/components/Leaderboard';

function team(overrides: Partial<LeaderboardTeam> & { id: string }): LeaderboardTeam {
  return {
    name: `Team ${overrides.id}`,
    total: 0,
    groupType: null,
    history: [],
    ...overrides,
  };
}

describe('Leaderboard', () => {
  it('shows a loading spinner while loading', () => {
    const { container } = render(
      <Leaderboard teams={[]} favoriteTeamIds={new Set()} onFavorite={() => {}} loading />
    );
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows "No teams yet" when there are no teams and not loading', () => {
    render(
      <Leaderboard teams={[]} favoriteTeamIds={new Set()} onFavorite={() => {}} loading={false} />
    );
    expect(screen.getByText('No teams yet')).toBeInTheDocument();
  });

  it('renders group columns in fixed order (Teen, Pre-Teen, Adult), skipping empty groups', () => {
    const teams = [
      team({ id: 'a', groupType: 'Adult', total: 1 }),
      team({ id: 't', groupType: 'Teen', total: 1 }),
      // No PreTeen team at all.
    ];
    render(
      <Leaderboard
        teams={teams}
        favoriteTeamIds={new Set()}
        onFavorite={() => {}}
        loading={false}
      />
    );

    const labels = screen.getAllByText(/^(Teen|Pre-Teen|Adult)$/);
    expect(labels.map((el) => el.textContent)).toEqual(['Teen', 'Adult']);
    expect(screen.queryByText('Pre-Teen')).not.toBeInTheDocument();
  });

  it('puts teams with no/unrecognized groupType into a full-width "Other" section', () => {
    const teams = [team({ id: 'x', groupType: null, total: 1 })];
    render(
      <Leaderboard
        teams={teams}
        favoriteTeamIds={new Set()}
        onFavorite={() => {}}
        loading={false}
      />
    );
    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(screen.getByText('Team x')).toBeInTheDocument();
  });

  it('gives tied teams the same medal and skips the next rank (1, 1, 3, 4)', () => {
    const teams = [
      team({ id: 'a', groupType: 'Teen', total: 10 }),
      team({ id: 'b', groupType: 'Teen', total: 10 }),
      team({ id: 'c', groupType: 'Teen', total: 5 }),
      team({ id: 'd', groupType: 'Teen', total: 1 }),
    ];
    render(
      <Leaderboard
        teams={teams}
        favoriteTeamIds={new Set()}
        onFavorite={() => {}}
        loading={false}
      />
    );

    const rowA = screen.getByText('Team a').closest('button')!.parentElement!;
    const rowB = screen.getByText('Team b').closest('button')!.parentElement!;
    const rowC = screen.getByText('Team c').closest('button')!.parentElement!;
    const rowD = screen.getByText('Team d').closest('button')!.parentElement!;
    expect(within(rowA).getByText('🥇')).toBeInTheDocument();
    expect(within(rowB).getByText('🥇')).toBeInTheDocument();
    // Rank 3 (bronze medal) — tied teams consumed ranks 1 and 1, not 1 and 2.
    expect(within(rowC).getByText('🥉')).toBeInTheDocument();
    // Rank 4, past the medals, renders as a plain number.
    expect(within(rowD).getByText('4')).toBeInTheDocument();
  });

  it('shows the latest-score badge for the most recently answered question', () => {
    const teams = [
      team({
        id: 'a',
        groupType: 'Teen',
        total: 5,
        history: [
          { questionNumber: 1, points: 2 },
          { questionNumber: 2, points: 3 },
        ],
      }),
    ];
    render(
      <Leaderboard
        teams={teams}
        favoriteTeamIds={new Set()}
        onFavorite={() => {}}
        loading={false}
      />
    );
    expect(screen.getByText('Q2: 3')).toBeInTheDocument();
  });

  it('expands to show score history in most-recent-first order', async () => {
    const teams = [
      team({
        id: 'a',
        groupType: 'Teen',
        total: 5,
        history: [
          { questionNumber: 1, points: 2 },
          { questionNumber: 2, points: 3 },
        ],
      }),
    ];
    render(
      <Leaderboard
        teams={teams}
        favoriteTeamIds={new Set()}
        onFavorite={() => {}}
        loading={false}
      />
    );

    await userEvent.click(screen.getByRole('button', { expanded: false }));

    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Q2')).toBeInTheDocument();
    expect(within(items[1]).getByText('Q1')).toBeInTheDocument();
  });

  it('calls onFavorite with the team id when the star is tapped', async () => {
    const onFavorite = vi.fn();
    const teams = [team({ id: 'a', groupType: 'Teen', total: 1 })];
    render(
      <Leaderboard
        teams={teams}
        favoriteTeamIds={new Set()}
        onFavorite={onFavorite}
        loading={false}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Set as favorite' }));
    expect(onFavorite).toHaveBeenCalledWith('a');
  });

  it('pins a favorited team in its own sticky card, in addition to its normal row', () => {
    const teams = [
      team({ id: 'a', groupType: 'Teen', total: 10 }),
      team({ id: 'b', groupType: 'Teen', total: 1 }),
    ];
    render(
      <Leaderboard
        teams={teams}
        favoriteTeamIds={new Set(['b'])}
        onFavorite={() => {}}
        loading={false}
      />
    );
    expect(screen.getByText('★ Your Team')).toBeInTheDocument();
    // Team b's name appears twice: once in the sticky favorite card, once in
    // its normal group row.
    expect(screen.getAllByText('Team b')).toHaveLength(2);
  });

  it("computes a favorited team's rank within its own group, not globally", () => {
    // Team b is #1 in Adult even though its total is lower than every Teen team.
    const teams = [
      team({ id: 'teen1', groupType: 'Teen', total: 100 }),
      team({ id: 'teen2', groupType: 'Teen', total: 90 }),
      team({ id: 'b', groupType: 'Adult', total: 1 }),
    ];
    render(
      <Leaderboard
        teams={teams}
        favoriteTeamIds={new Set(['b'])}
        onFavorite={() => {}}
        loading={false}
      />
    );
    const stickyCard = screen.getByText('★ Your Team').closest('button')!;
    expect(within(stickyCard).getByText('🥇')).toBeInTheDocument();
  });

  it('shows only the top 3 rows in a group of more than 3 until "Show all" is tapped', async () => {
    const teams = Array.from({ length: 5 }, (_, i) =>
      team({ id: `t${i}`, groupType: 'Teen', total: 10 - i })
    );
    render(
      <Leaderboard
        teams={teams}
        favoriteTeamIds={new Set()}
        onFavorite={() => {}}
        loading={false}
      />
    );

    const rowFor = (id: string) =>
      screen.getByText(`Team ${id}`).closest('div[class]')!.parentElement!;
    // Row index 4 (5th team) is hidden until expanded.
    expect(rowFor('t4').className).toContain('hidden');

    await userEvent.click(screen.getByRole('button', { name: /Show all \(5\)/ }));
    expect(rowFor('t4').className).not.toContain('hidden');
    expect(screen.getByRole('button', { name: /Show less/ })).toBeInTheDocument();
  });

  it('does not show a "Show all" toggle for a group of 3 or fewer teams', () => {
    const teams = [
      team({ id: 'a', groupType: 'Teen', total: 3 }),
      team({ id: 'b', groupType: 'Teen', total: 2 }),
    ];
    render(
      <Leaderboard
        teams={teams}
        favoriteTeamIds={new Set()}
        onFavorite={() => {}}
        loading={false}
      />
    );
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });
});
