import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScoreButtonGrid from '@/app/components/ScoreButtonGrid';

describe('ScoreButtonGrid', () => {
  it('renders one button per point option (0-3)', () => {
    render(<ScoreButtonGrid onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: '0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument();
  });

  it('calls onSelect with the clicked point value', async () => {
    const onSelect = vi.fn();
    render(<ScoreButtonGrid onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('marks buttons aria-disabled (not the native disabled attribute) when disabled', () => {
    render(<ScoreButtonGrid onSelect={() => {}} disabled />);
    const button = screen.getByRole('button', { name: '1' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // The native `disabled` attribute is deliberately not set — the click
    // handler self-guards instead — so the button remains focusable/clickable
    // at the DOM level.
    expect(button).not.toBeDisabled();
  });

  it('does not call onSelect when disabled, even though the button is not natively disabled', async () => {
    const onSelect = vi.fn();
    render(<ScoreButtonGrid onSelect={onSelect} disabled />);
    await userEvent.click(screen.getByRole('button', { name: '1' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a spinner (no numeral) and aria-busy on the pending button', () => {
    render(<ScoreButtonGrid onSelect={() => {}} pendingValue={2} />);
    const pendingButton = screen.getByRole('button', { name: '' }); // no accessible number text
    expect(pendingButton).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button', { name: '2' })).not.toBeInTheDocument();
  });

  it('highlights the active value without a spinner', () => {
    render(<ScoreButtonGrid onSelect={() => {}} activeValue={3} />);
    const activeButton = screen.getByRole('button', { name: '3' });
    expect(activeButton).toHaveAttribute('aria-busy', 'false');
    expect(activeButton.className).toContain('bg-indigo-600');
  });

  it('pendingValue takes precedence over activeValue for the same button', () => {
    render(<ScoreButtonGrid onSelect={() => {}} pendingValue={1} activeValue={1} />);
    // isPending is true, isActive computed as `!isPending && points === activeValue`
    // so it's false — the button shows the spinner, not plain active styling.
    expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument();
  });
});
