import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScoreEditPopover from '@/app/components/ScoreEditPopover';

function renderPopover(overrides: Partial<React.ComponentProps<typeof ScoreEditPopover>> = {}) {
  const anchorEl = document.createElement('button');
  document.body.appendChild(anchorEl);
  return render(
    <ScoreEditPopover
      anchorEl={anchorEl}
      teamName="Grace Chapel"
      groupType="Teen"
      questionNumber={3}
      existingPoints={null}
      onSelect={vi.fn()}
      onClear={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />
  );
}

describe('ScoreEditPopover', () => {
  it('renders as a dialog labeled with the team name and question number', () => {
    renderPopover();
    expect(
      screen.getByRole('dialog', { name: 'Edit score for Grace Chapel, question 3' })
    ).toBeInTheDocument();
  });

  it('calls onSelect with the clicked point value', async () => {
    const onSelect = vi.fn();
    renderPopover({ onSelect });
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('does not show a "Clear score" button when there is no existing score', () => {
    renderPopover({ existingPoints: null });
    expect(screen.queryByRole('button', { name: 'Clear score' })).not.toBeInTheDocument();
  });

  it('shows and wires up "Clear score" when a score already exists', async () => {
    const onClear = vi.fn();
    renderPopover({ existingPoints: 2, onClear });
    await userEvent.click(screen.getByRole('button', { name: 'Clear score' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('marks the existing point value as pressed', () => {
    renderPopover({ existingPoints: 1 });
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '0' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Escape calls onClose', async () => {
    const onClose = vi.fn();
    renderPopover({ onClose });
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the × button calls onClose', async () => {
    const onClose = vi.fn();
    renderPopover({ onClose });
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
