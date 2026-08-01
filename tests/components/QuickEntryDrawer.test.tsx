import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuickEntryDrawer from '@/app/components/QuickEntryDrawer';

const teams = [
  { id: 't1', name: 'Team One', groupType: 'Teen' },
  { id: 't2', name: 'Team Two', groupType: 'Adult' },
  { id: 't3', name: 'Team Three', groupType: null },
] as never;

function baseProps(overrides: Partial<React.ComponentProps<typeof QuickEntryDrawer>> = {}) {
  return {
    sortedTeams: teams,
    scoreMap: new Map(),
    currentQuestion: 1,
    selectedTeamId: 't2',
    onSelectNext: vi.fn(),
    onSelectPrev: vi.fn(),
    onEnterScore: vi.fn(),
    onClose: vi.fn(),
    recentEntry: null,
    ...overrides,
  };
}

describe('QuickEntryDrawer', () => {
  it('shows the prev and next team names around the selected team', () => {
    render(<QuickEntryDrawer {...baseProps()} />);
    expect(screen.getByText('Team Two')).toBeInTheDocument(); // current, prominent
    expect(screen.getByText('Team One')).toBeInTheDocument(); // prev
    expect(screen.getByText('Team Three')).toBeInTheDocument(); // next
  });

  it('shows the progress indicator as "N / M"', () => {
    render(<QuickEntryDrawer {...baseProps()} />);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('does not show a prev team at the start of the list', () => {
    render(<QuickEntryDrawer {...baseProps({ selectedTeamId: 't1' })} />);
    expect(screen.queryByText('← Prev')).not.toBeInTheDocument();
  });

  it('does not show a next team at the end of the list', () => {
    render(<QuickEntryDrawer {...baseProps({ selectedTeamId: 't3' })} />);
    expect(screen.queryByText('Next →')).not.toBeInTheDocument();
  });

  it('Escape calls onClose', async () => {
    const onClose = vi.fn();
    render(<QuickEntryDrawer {...baseProps({ onClose })} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('ArrowRight/ArrowLeft call onSelectNext/onSelectPrev', async () => {
    const onSelectNext = vi.fn();
    const onSelectPrev = vi.fn();
    render(<QuickEntryDrawer {...baseProps({ onSelectNext, onSelectPrev })} />);
    await userEvent.keyboard('{ArrowRight}');
    expect(onSelectNext).toHaveBeenCalled();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onSelectPrev).toHaveBeenCalled();
  });

  it('digit keys 0-3 enter a score for the selected team', async () => {
    const onEnterScore = vi.fn();
    render(<QuickEntryDrawer {...baseProps({ onEnterScore })} />);
    await userEvent.keyboard('3');
    expect(onEnterScore).toHaveBeenCalledWith('t2', 3);
  });

  it('does not enter a score via keyboard when the game has not started', async () => {
    const onEnterScore = vi.fn();
    render(<QuickEntryDrawer {...baseProps({ onEnterScore, currentQuestion: null })} />);
    await userEvent.keyboard('2');
    expect(onEnterScore).not.toHaveBeenCalled();
  });

  it('a leftward swipe past the threshold calls onSelectNext', () => {
    const onSelectNext = vi.fn();
    const { container } = render(<QuickEntryDrawer {...baseProps({ onSelectNext })} />);
    const panel = container.querySelector('[class*="rounded-t-2xl"]')!;
    fireEvent.touchStart(panel, { touches: [{ clientX: 300 }] });
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 200 }] }); // delta -100
    expect(onSelectNext).toHaveBeenCalled();
  });

  it('a rightward swipe past the threshold calls onSelectPrev', () => {
    const onSelectPrev = vi.fn();
    const { container } = render(<QuickEntryDrawer {...baseProps({ onSelectPrev })} />);
    const panel = container.querySelector('[class*="rounded-t-2xl"]')!;
    fireEvent.touchStart(panel, { touches: [{ clientX: 100 }] });
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 200 }] }); // delta +100
    expect(onSelectPrev).toHaveBeenCalled();
  });

  it('a short swipe under the threshold does nothing', () => {
    const onSelectNext = vi.fn();
    const onSelectPrev = vi.fn();
    const { container } = render(
      <QuickEntryDrawer {...baseProps({ onSelectNext, onSelectPrev })} />
    );
    const panel = container.querySelector('[class*="rounded-t-2xl"]')!;
    fireEvent.touchStart(panel, { touches: [{ clientX: 100 }] });
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 120 }] }); // delta +20
    expect(onSelectNext).not.toHaveBeenCalled();
    expect(onSelectPrev).not.toHaveBeenCalled();
  });

  it('shows the existing score for the selected team when one exists', () => {
    const scoreMap = new Map([['t2', new Map([[1, { points: 3 }]])]]) as never;
    render(<QuickEntryDrawer {...baseProps({ scoreMap })} />);
    expect(screen.getByText('Scored: 3')).toBeInTheDocument();
  });
});
