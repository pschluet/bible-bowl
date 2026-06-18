'use client';

import { useCallback, useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';
import { compareTeamOrder } from '@/app/lib/constants';

type Team = Schema['Team']['type'];
type Role = 'Admins' | 'Scorekeepers';

interface CognitoUser {
  username: string;
  email: string;
  sub: string;
  status: string;
  groups: string[];
}

const client = generateClient<Schema>({ authMode: 'userPool' });

export default function AdminUsersPage() {
  // ── create-user form state ──────────────────────────────────────────────
  const [teams, setTeams] = useState<Team[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('Scorekeepers');
  const [teamId, setTeamId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── existing-users list state ───────────────────────────────────────────
  const [users, setUsers] = useState<CognitoUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  // ── per-row in-flight tracking ──────────────────────────────────────────
  const [savingRole, setSavingRole] = useState<string | null>(null); // username
  const [savingTeam, setSavingTeam] = useState<string | null>(null); // username

  // ── load teams + users ──────────────────────────────────────────────────
  const loadTeams = useCallback(async () => {
    try {
      const res = await client.models.Team.list();
      setTeams([...res.data].sort(compareTeamOrder));
    } catch {
      setError('Failed to load teams.');
    }
  }, []);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTeams();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUsers();
  }, [loadTeams, loadUsers]);

  // ── create user ─────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSuccess(null);
    setError(null);
    try {
      const body: { email: string; role: Role; teamId?: string } = {
        email: email.trim(),
        role,
      };
      if (role === 'Scorekeepers' && teamId) body.teamId = teamId;

      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Failed to create user.');
      }

      setSuccess("User created! They'll receive a temporary password by email.");
      setEmail('');
      setTeamId('');
      await Promise.all([loadUsers(), loadTeams()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── change role ─────────────────────────────────────────────────────────
  async function handleRoleChange(user: CognitoUser, newRole: Role) {
    setSavingRole(user.username);
    setUsersError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, role: newRole, sub: user.sub }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Failed to update role.');
      }
      await Promise.all([loadUsers(), loadTeams()]);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Failed to update role.');
    } finally {
      setSavingRole(null);
    }
  }

  // ── assign team ─────────────────────────────────────────────────────────
  async function handleTeamChange(user: CognitoUser, newTeamId: string) {
    setSavingTeam(user.username);
    setUsersError(null);
    try {
      // Clear any existing assignment for this user
      const currentTeam = teams.find((t) => t.scorekeeperUserId === user.sub);
      if (currentTeam && currentTeam.id !== newTeamId) {
        await client.models.Team.update(
          { id: currentTeam.id, scorekeeperUserId: null, scorekeeperEmail: null },
          { authMode: 'userPool' }
        );
      }

      if (newTeamId) {
        await client.models.Team.update(
          { id: newTeamId, scorekeeperUserId: user.sub, scorekeeperEmail: user.email },
          { authMode: 'userPool' }
        );
      }

      await loadTeams();
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Failed to update team assignment.');
    } finally {
      setSavingTeam(null);
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  function userRole(user: CognitoUser): Role {
    if (user.groups.includes('Admins')) return 'Admins';
    return 'Scorekeepers';
  }

  /** Find the team currently assigned to this user (by sub or email fallback). */
  function assignedTeamId(user: CognitoUser): string {
    const byId = teams.find((t) => t.scorekeeperUserId === user.sub);
    if (byId) return byId.id;
    // Fall back to email-only pre-assignment (set during user creation)
    const byEmail = teams.find(
      (t) => !t.scorekeeperUserId && t.scorekeeperEmail === user.email
    );
    return byEmail?.id ?? '';
  }

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Users</h1>

      {/* ── Create user form ── */}
      <form
        onSubmit={handleSubmit}
        className="mb-8 flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-6"
      >
        <h2 className="text-base font-semibold text-gray-900">Create User</h2>

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="role" className="mb-1 block text-sm font-medium text-gray-700">
            Role
          </label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="Admins">Admin</option>
            <option value="Scorekeepers">Scorekeeper</option>
          </select>
        </div>

        {role === 'Scorekeepers' && (
          <div>
            <label htmlFor="team" className="mb-1 block text-sm font-medium text-gray-700">
              Team
            </label>
            <select
              id="team"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">— no team yet —</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Create User
        </button>

        {success && (
          <div className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{success}</div>
        )}
        {error && (
          <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}

        <p className="text-xs text-gray-400">
          Created users must sign in with the temporary password sent to their email and set a new
          password on first login.
        </p>
      </form>

      {/* ── Existing users list ── */}
      <h2 className="mb-3 text-base font-semibold text-gray-900">Existing Users</h2>

      {usersError && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{usersError}</div>
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
            const currentRole = userRole(user);
            const isScorekeeper = currentRole === 'Scorekeepers';
            const currentTeamId = assignedTeamId(user);
            const roleChanging = savingRole === user.username;
            const teamChanging = savingTeam === user.username;

            return (
              <li key={user.username} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">{user.email}</p>
                  <p className="truncate text-xs text-gray-400">{user.status}</p>
                </div>

                {/* Role selector */}
                <select
                  value={currentRole}
                  disabled={roleChanging || teamChanging}
                  onChange={(e) => {
                    void handleRoleChange(user, e.target.value as Role);
                  }}
                  className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                  aria-label={`Role for ${user.email}`}
                >
                  <option value="Admins">Admin</option>
                  <option value="Scorekeepers">Scorekeeper</option>
                </select>

                {/* Team selector — only for scorekeepers */}
                {isScorekeeper && (
                  <select
                    value={currentTeamId}
                    disabled={roleChanging || teamChanging}
                    onChange={(e) => {
                      void handleTeamChange(user, e.target.value);
                    }}
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                    aria-label={`Team for ${user.email}`}
                  >
                    <option value="">— no team —</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                )}

                {(roleChanging || teamChanging) && (
                  <span className="text-xs text-gray-400">Saving…</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
