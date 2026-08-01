import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getCurrentUser } from 'aws-amplify/auth';

vi.mock('aws-amplify/auth', () => ({ getCurrentUser: vi.fn() }));

const SuperAdminUsersPage = (await import('@/app/admin/users/page')).default;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

const USERS = [
  {
    username: 'super@x.com',
    email: 'super@x.com',
    sub: 'super-sub',
    status: 'CONFIRMED',
    groups: ['SuperAdmins'],
  },
  {
    username: 'admin@x.com',
    email: 'admin@x.com',
    sub: 'admin-sub',
    status: 'CONFIRMED',
    groups: ['Admins'],
  },
  {
    username: 'team-1@bible-bowl.internal',
    email: 'team-1@bible-bowl.internal',
    sub: 'sk-sub',
    status: 'CONFIRMED',
    groups: ['Scorekeepers'],
  },
];

describe('SuperAdminUsersPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(getCurrentUser).mockResolvedValue({ userId: 'super-sub' } as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads and lists users with role badges', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { users: USERS }));
    render(<SuperAdminUsersPage />);

    expect(await screen.findByText('super@x.com')).toBeInTheDocument();
    const superRow = screen.getByText('super@x.com').closest('li')!;
    expect(within(superRow).getByText('Super Admin')).toBeInTheDocument();

    const adminRow = screen.getByText('admin@x.com').closest('li')!;
    expect(within(adminRow).getByText('Admin')).toBeInTheDocument();

    const skRow = screen.getByText('team-1@bible-bowl.internal').closest('li')!;
    expect(within(skRow).getByText('QR Scorekeeper')).toBeInTheDocument();
  });

  it('disables the delete button for the currently signed-in user (self-delete guard)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { users: USERS }));
    render(<SuperAdminUsersPage />);
    await screen.findByText('super@x.com');

    const superRow = screen.getByText('super@x.com').closest('li')!;
    expect(within(superRow).getByRole('button', { name: 'Delete' })).toBeDisabled();

    const adminRow = screen.getByText('admin@x.com').closest('li')!;
    expect(within(adminRow).getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('creates a new admin and refreshes the list on success', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, { users: USERS })) // initial load
      .mockResolvedValueOnce(jsonResponse(200, { success: true })) // POST create
      .mockResolvedValueOnce(jsonResponse(200, { users: [...USERS] })); // reload
    render(<SuperAdminUsersPage />);
    await screen.findByText('super@x.com');

    await userEvent.type(screen.getByLabelText('Email'), 'newadmin@x.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create Admin' }));

    expect(await screen.findByText(/admin user created/i)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/users',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'newadmin@x.com' }),
      })
    );
  });

  it('shows the server error message when user creation fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, { users: USERS }))
      .mockResolvedValueOnce(jsonResponse(409, { error: 'A user with that email already exists' }));
    render(<SuperAdminUsersPage />);
    await screen.findByText('super@x.com');

    await userEvent.type(screen.getByLabelText('Email'), 'admin@x.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create Admin' }));

    expect(await screen.findByText('A user with that email already exists')).toBeInTheDocument();
  });

  it('deletes a user after confirming, then refreshes the list', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, { users: USERS }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true })) // DELETE
      .mockResolvedValueOnce(jsonResponse(200, { users: [USERS[0], USERS[2]] })); // reload w/o admin
    render(<SuperAdminUsersPage />);
    await screen.findByText('super@x.com');

    const adminRow = screen.getByText('admin@x.com').closest('li')!;
    await userEvent.click(within(adminRow).getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(adminRow).getByRole('button', { name: 'Confirm' }));

    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/users',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ username: 'admin@x.com', sub: 'admin-sub' }),
      })
    );
  });
});
