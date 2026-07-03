'use client';

import { useCallback, useEffect, useState } from 'react';
import { getCurrentUser } from 'aws-amplify/auth';
import { SCOREKEEPER_EMAIL_DOMAIN } from '@/app/lib/cognito';

interface CognitoUser {
  username: string;
  email: string;
  sub: string;
  status: string;
  groups: string[];
}

/** True for QR-onboarded scorekeeper users (synthetic username pattern). */
function isSyntheticScorekeeper(user: CognitoUser): boolean {
  return user.email.endsWith(`@${SCOREKEEPER_EMAIL_DOMAIN}`);
}

export default function SuperAdminUsersPage() {
  // ── create admin form ──────────────────────────────────────────────────────
  const [adminEmail, setAdminEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── existing-users list ────────────────────────────────────────────────────
  const [users, setUsers] = useState<CognitoUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [refreshingUsers, setRefreshingUsers] = useState(false);

  // ── per-user delete ────────────────────────────────────────────────────────
  const [currentSub, setCurrentSub] = useState<string | null>(null);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error('Failed to load users');
      const data = (await res.json()) as { users: CognitoUser[] };
      setUsers(data.users.sort((a, b) => a.email.localeCompare(b.email)));
      setUsersError(null);
    } catch {
      setUsersError('Failed to load users.');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
    void getCurrentUser()
      .then(({ userId }) => setCurrentSub(userId))
      .catch(() => {});
  }, [loadUsers]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSuccess(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail.trim() }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Failed to create user.');
      }

      setSuccess("Admin user created! They'll receive a temporary password by email.");
      setAdminEmail('');
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteUser(user: CognitoUser) {
    setDeletingUser(user.username);
    setUsersError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, sub: user.sub }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Failed to delete user.');
      }
      setDeleteConfirmUser(null);
      await loadUsers();
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Failed to delete user.');
    } finally {
      setDeletingUser(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Users</h1>

      {/* ── Create Admin User form ── */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-6"
      >
        <h2 className="text-base font-semibold text-gray-900">Create Admin User</h2>

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !adminEmail.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create Admin'}
        </button>

        {success && (
          <div className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{success}</div>
        )}
        {error && (
          <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}

        <p className="text-xs text-gray-400">
          Admin users receive a temporary password by email and must set a new password on first
          login. Scorekeepers onboard via QR code — manage them from the game&apos;s Scorekeepers
          page.
        </p>
      </form>

      {/* ── Existing users list ── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">All Users</h2>
          <button
            type="button"
            disabled={refreshingUsers || usersLoading}
            onClick={() => {
              setRefreshingUsers(true);
              void loadUsers().finally(() => setRefreshingUsers(false));
            }}
            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {refreshingUsers ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {usersError && (
          <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
            {usersError}
          </div>
        )}

        {usersLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
          </div>
        ) : users.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
            No users found.
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {users.map((user) => {
              const synthetic = isSyntheticScorekeeper(user);
              const isSuperAdmin = user.groups.includes('SuperAdmins');
              const isAdmin = user.groups.includes('Admins') || isSuperAdmin;
              const isSelf = user.sub === currentSub;
              const confirming = deleteConfirmUser === user.username;
              const deleting = deletingUser === user.username;

              return (
                <li
                  key={user.username}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words font-medium text-gray-900">{user.email}</p>
                      {isSuperAdmin ? (
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                          Super Admin
                        </span>
                      ) : isAdmin ? (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                          Admin
                        </span>
                      ) : synthetic ? (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                          QR Scorekeeper
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                          Scorekeeper
                        </span>
                      )}
                    </div>
                    {!synthetic && <p className="text-xs text-gray-400">{user.status}</p>}
                  </div>

                  <div className="flex items-center gap-2">
                    {confirming ? (
                      <>
                        <span className="text-xs text-gray-500">Delete this user?</span>
                        <button
                          type="button"
                          onClick={() => void handleDeleteUser(user)}
                          disabled={deleting}
                          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {deleting ? 'Deleting…' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmUser(null)}
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmUser(user.username)}
                        disabled={isSelf}
                        title={isSelf ? "You can't delete your own account" : undefined}
                        className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
