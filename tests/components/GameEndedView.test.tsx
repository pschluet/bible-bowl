import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import GameEndedView from '@/app/components/GameEndedView';

describe('GameEndedView', () => {
  it('renders the "scoring is closed" message', () => {
    render(<GameEndedView />);
    expect(screen.getByRole('heading', { name: 'Scoring is closed' })).toBeInTheDocument();
    expect(screen.getByText(/thank you for participating/i)).toBeInTheDocument();
  });
});
