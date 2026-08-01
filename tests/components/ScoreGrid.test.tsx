import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScoreGrid from '@/app/components/ScoreGrid';

const teams = [
  { id: 't1', name: 'Team One', groupType: 'Teen' },
  { id: 't2', name: 'Team Two', groupType: 'Adult' },
] as never;

function baseProps(overrides: Partial<React.ComponentProps<typeof ScoreGrid>> = {}) {
  return {
    teams,
    scoreMap: new Map(),
    currentQuestion: 1,
    maxQuestion: 1,
    onScoreChange: vi.fn(),
    onScoreDelete: vi.fn(),
    selectedTeamId: 't1',
    onSelect: vi.fn(),
    onSelectNext: vi.fn(),
    onSelectPrev: vi.fn(),
    onEnterScore: vi.fn(),
    recentEntry: null,
    ...overrides,
  };
}

describe('ScoreGrid', () => {
  it('shows a message when there are no teams', () => {
    render(<ScoreGrid {...baseProps({ teams: [] })} />);
    expect(screen.getByText(/no teams yet/i)).toBeInTheDocument();
  });

  it('renders one row per team with its total', () => {
    const scoreMap = new Map([
      [
        't1',
        new Map([
          [1, { id: 's1', points: 2 }],
          [2, { id: 's2', points: 1 }],
        ]),
      ],
    ]) as never;
    render(<ScoreGrid {...baseProps({ scoreMap, maxQuestion: 2 })} />);
    const row = screen.getByText('Team One').closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[cells.length - 1]).toHaveTextContent('3'); // 2 + 1 total
  });

  it('pressing a digit key on the focused row enters that score for the current question', async () => {
    const onEnterScore = vi.fn();
    render(<ScoreGrid {...baseProps({ onEnterScore })} />);
    const row = screen.getByText('Team One').closest('tr')!;
    row.focus();
    await userEvent.keyboard('3');
    expect(onEnterScore).toHaveBeenCalledWith('t1', 3);
  });

  it('pressing "x" clears the existing score for the current question and advances', async () => {
    const onScoreDelete = vi.fn();
    const onSelectNext = vi.fn();
    const scoreMap = new Map([['t1', new Map([[1, { id: 'score-1', points: 2 }]])]]) as never;
    render(<ScoreGrid {...baseProps({ scoreMap, onScoreDelete, onSelectNext })} />);
    const row = screen.getByText('Team One').closest('tr')!;
    row.focus();
    await userEvent.keyboard('x');
    expect(onScoreDelete).toHaveBeenCalledWith('score-1');
    expect(onSelectNext).toHaveBeenCalled();
  });

  it('does nothing on "x" when there is no existing score to clear', async () => {
    const onScoreDelete = vi.fn();
    render(<ScoreGrid {...baseProps({ onScoreDelete })} />);
    const row = screen.getByText('Team One').closest('tr')!;
    row.focus();
    await userEvent.keyboard('x');
    expect(onScoreDelete).not.toHaveBeenCalled();
  });

  it('ArrowDown/ArrowUp call onSelectNext/onSelectPrev', async () => {
    const onSelectNext = vi.fn();
    const onSelectPrev = vi.fn();
    render(<ScoreGrid {...baseProps({ onSelectNext, onSelectPrev })} />);
    const row = screen.getByText('Team One').closest('tr')!;
    row.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(onSelectNext).toHaveBeenCalled();
    await userEvent.keyboard('{ArrowUp}');
    expect(onSelectPrev).toHaveBeenCalled();
  });

  it('clicking a cell opens the edit popover, and picking a value calls onScoreChange', async () => {
    const onScoreChange = vi.fn();
    render(<ScoreGrid {...baseProps({ onScoreChange })} />);
    const row = screen.getByText('Team One').closest('tr')!;
    // The cell button shows "–" when unscored.
    await userEvent.click(within(row).getByText('–'));

    // The popover renders in a portal at document.body, with the team name
    // and question number in its accessible label.
    const dialog = await screen.findByRole('dialog', {
      name: /Edit score for Team One, question 1/i,
    });
    await userEvent.click(within(dialog).getByRole('button', { name: '3' }));

    expect(onScoreChange).toHaveBeenCalledWith('t1', 1, 3);
  });

  it('does not enter a score via keyboard when the game has not started (currentQuestion null)', async () => {
    const onEnterScore = vi.fn();
    render(<ScoreGrid {...baseProps({ currentQuestion: null, onEnterScore })} />);
    const row = screen.getByText('Team One').closest('tr')!;
    row.focus();
    await userEvent.keyboard('2');
    expect(onEnterScore).not.toHaveBeenCalled();
  });
});
