import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScoreEntry from '@/app/components/ScoreEntry';

const team = { id: 'team-1', name: 'Grace Chapel', groupType: 'Teen' } as never;

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

describe('ScoreEntry', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows "waiting for the game to start" when currentQuestion is null', () => {
    render(<ScoreEntry team={team} currentQuestion={null} existingScore={null} />);
    expect(screen.getByText(/waiting for the game to start/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '0' })).not.toBeInTheDocument();
  });

  it('shows the score button grid when no score has been submitted yet', () => {
    render(<ScoreEntry team={team} currentQuestion={1} existingScore={null} />);
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
    expect(screen.queryByText(/score submitted/i)).not.toBeInTheDocument();
  });

  it('shows the confirmation card (and hides the button grid) when a score already exists', () => {
    render(<ScoreEntry team={team} currentQuestion={1} existingScore={2} />);
    expect(screen.getByText('Score submitted ✓')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '0' })).not.toBeInTheDocument();
  });

  it('submits a score and shows the confirmation card on success', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { success: true }));
    render(<ScoreEntry team={team} currentQuestion={1} existingScore={null} />);

    await userEvent.click(screen.getByRole('button', { name: '3' }));

    expect(await screen.findByText('Score submitted ✓')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/scorekeeper/score',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ teamId: 'team-1', questionNumber: 1, points: 3 }),
      })
    );
  });

  it('on a 409 (already scored), immediately shows the confirmation state instead of leaving the grid interactive', async () => {
    // Bug #8 fix: previously `submittedScore` stayed null on a 409, so the
    // button grid remained tappable until the live subscription caught up.
    vi.mocked(fetch).mockResolvedValue(jsonResponse(409, { error: 'ALREADY_SCORED' }));
    render(<ScoreEntry team={team} currentQuestion={1} existingScore={null} />);

    await userEvent.click(screen.getByRole('button', { name: '1' }));

    expect(await screen.findByText('Score submitted ✓')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '0' })).not.toBeInTheDocument();
    expect(screen.getByText(/already been scored/i)).toBeInTheDocument();
  });

  it('shows a "scoring is now closed" message on SCORING_CLOSED, and keeps the grid visible', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(403, { error: 'SCORING_CLOSED' }));
    render(<ScoreEntry team={team} currentQuestion={1} existingScore={null} />);

    await userEvent.click(screen.getByRole('button', { name: '1' }));

    expect(await screen.findByText('Scoring is now closed.')).toBeInTheDocument();
    // Not treated as submitted — the grid is still there to retry (though
    // scoring is in fact closed server-side).
    expect(screen.getByRole('button', { name: '0' })).toBeInTheDocument();
  });

  it('returns to the entry buttons when an admin deletes the score (existingScore prop transitions to null)', () => {
    const { rerender } = render(<ScoreEntry team={team} currentQuestion={1} existingScore={2} />);
    expect(screen.getByText('Score submitted ✓')).toBeInTheDocument();

    rerender(<ScoreEntry team={team} currentQuestion={1} existingScore={null} />);
    expect(screen.queryByText('Score submitted ✓')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '0' })).toBeInTheDocument();
  });
});
