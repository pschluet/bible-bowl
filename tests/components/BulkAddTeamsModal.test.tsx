import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BulkAddTeamsModal from '@/app/components/BulkAddTeamsModal';

describe('BulkAddTeamsModal', () => {
  it('shows "Add teams" and a disabled submit button before anything is typed', () => {
    render(<BulkAddTeamsModal onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add teams' })).toBeDisabled();
  });

  it('previews valid rows with a checkmark and the parsed group', async () => {
    render(<BulkAddTeamsModal onSubmit={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Team names'), 'Grace Chapel');
    await userEvent.type(screen.getByLabelText('Team types'), 'Teen');

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Grace Chapel')).toBeInTheDocument();
    expect(within(row).getByText('✓')).toBeInTheDocument();
    expect(within(row).getByText('Teen')).toBeInTheDocument();
  });

  it('previews an invalid row with its error message', async () => {
    render(<BulkAddTeamsModal onSubmit={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Team names'), 'Grace Chapel');
    await userEvent.type(screen.getByLabelText('Team types'), 'Not A Real Type');

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('✗')).toBeInTheDocument();
    expect(within(row).getByText('unknown type "Not A Real Type"')).toBeInTheDocument();
  });

  it('applies the single-type shortcut to every name row', async () => {
    render(<BulkAddTeamsModal onSubmit={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Team names'), 'Church A{enter}Church B');
    await userEvent.type(screen.getByLabelText('Team types'), 'Adult');

    expect(screen.getByRole('button', { name: 'Add 2 teams' })).toBeEnabled();
  });

  it('shows "Add N of M teams" when only some rows are valid', async () => {
    render(<BulkAddTeamsModal onSubmit={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Team names'), 'Church A{enter}Church B');
    await userEvent.type(screen.getByLabelText('Team types'), 'Adult{enter}Bogus');

    expect(screen.getByRole('button', { name: 'Add 1 of 2 teams' })).toBeInTheDocument();
  });

  it('calls onSubmit with only the valid rows, mapped to {name, groupType}', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<BulkAddTeamsModal onSubmit={onSubmit} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Team names'), 'Church A{enter}Church B');
    await userEvent.type(screen.getByLabelText('Team types'), 'Adult{enter}Bogus');

    await userEvent.click(screen.getByRole('button', { name: 'Add 1 of 2 teams' }));

    expect(onSubmit).toHaveBeenCalledWith([{ name: 'Church A', groupType: 'Adult' }]);
  });

  it('shows an error and re-enables the form if onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('network error'));
    render(<BulkAddTeamsModal onSubmit={onSubmit} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Team names'), 'Church A');
    await userEvent.type(screen.getByLabelText('Team types'), 'Adult');

    await userEvent.click(screen.getByRole('button', { name: 'Add 1 team' }));

    expect(await screen.findByText(/failed to add some teams/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add 1 team' })).toBeEnabled();
  });

  it('Escape calls onClose', async () => {
    const onClose = vi.fn();
    render(<BulkAddTeamsModal onSubmit={vi.fn()} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
