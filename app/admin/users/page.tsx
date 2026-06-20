'use client';

import { useCallback, useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';
import { compareTeamOrder, teamOptionLabel } from '@/app/lib/constants';
import { SCOREKEEPER_EMAIL_DOMAIN } from '@/app/lib/cognito';
import QrCodeDisplay, { type QrToken } from '@/app/components/QrCodeDisplay';
import QrCodePrintGrid from '@/app/components/QrCodePrintGrid';

type Team = Schema['Team']['type'];

interface CognitoUser {
  username: string;
  email: string;
  sub: string;
  status: string;
  groups: string[];
}

type Role = 'Admins' | 'Scorekeepers';

const client = generateClient<Schema>({ authMode: 'userPool' });

/** True for QR-onboarded scorekeeper users (synthetic username pattern). */
function isSyntheticScorekeeper(user: CognitoUser): boolean {
  return user.email.endsWith(`@${SCOREKEEPER_EMAIL_DOMAIN}`);
}

export default function AdminUsersPage() {
  // ── teams ──────────────────────────────────────────────────────────────────
  const [teams, setTeams] = useState<Team[]>([]);

  // ── QR onboarding section ──────────────────────────────────────────────────
  const [tokens, setTokens] = useState<QrToken[]>([]);
  const [generating, setGenerating] = useState(false);
  const [qrDisplayIndex, setQrDisplayIndex] = useState<number | null>(null);
  const [showPrintGrid, setShowPrintGrid] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // End Game
  const [endingGame, setEndingGame] = useState(false);
  const [endGameConfirm, setEndGameConfirm] = useState(false);
  const [endGameResult, setEndGameResult] = useState<string | null>(null);

  // ── create admin form ──────────────────────────────────────────────────────
  const [adminEmail, setAdminEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── existing-users list ────────────────────────────────────────────────────
  const [users, setUsers] = useState<CognitoUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  // ── per-row in-flight tracking ─────────────────────────────────────────────
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [savingTeam, setSavingTeam] = useState<string | null>(null);

  // ── load teams + users ─────────────────────────────────────────────────────
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
    void loadUsers();
  }, [loadTeams, loadUsers]);

  // ── QR generation ──────────────────────────────────────────────────────────
  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch('/api/scorekeeper/generate', { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Failed to generate QR codes.');
      }
      const data = (await res.json()) as { tokens: QrToken[] };
      setTokens(data.tokens);
      await loadUsers(); // refresh so new scorekeepers appear
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Failed to generate QR codes.');
    } finally {
      setGenerating(false);
    }
  }

  // ── End Game ───────────────────────────────────────────────────────────────
  async function handleEndGame() {
    setEndingGame(true);
    setEndGameResult(null);
    setEndGameConfirm(false);
    try {
      const res = await fetch('/api/scorekeeper/end-game', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to end game.');
      const data = (await res.json()) as { signedOut?: number; failures?: number };
      setEndGameResult(
        `Game ended. Signed out ${data.signedOut ?? 0} scorekeeper(s).${
          (data.failures ?? 0) > 0 ? ` (${data.failures} failure(s) — see logs)` : ''
        }`
      );
      setTokens([]); // tokens are now all consumed
    } catch (err) {
      setEndGameResult(err instanceof Error ? err.message : 'Failed to end game.');
    } finally {
      setEndingGame(false);
    }
  }

  // ── create admin user ──────────────────────────────────────────────────────
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

  // ── change role ────────────────────────────────────────────────────────────
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

  // ── assign team ────────────────────────────────────────────────────────────
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

  // ── helpers ────────────────────────────────────────────────────────────────
  function userRole(user: CognitoUser): Role {
    if (user.groups.includes('Admins')) return 'Admins';
    return 'Scorekeepers';
  }

  /** Find the team currently assigned to this user (by sub or email fallback). */
  function assignedTeamId(user: CognitoUser): string {
    const byId = teams.find((t) => t.scorekeeperUserId === user.sub);
    if (byId) return byId.id;
    const byEmail = teams.find(
      (t) => !t.scorekeeperUserId && t.scorekeeperEmail === user.email
    );
    return byEmail?.id ?? '';
  }

  /**
   * For QR-onboarded scorekeepers, shows their team name instead of the
   * synthetic email. Falls back to the email for regular admin users.
   */
  function displayName(user: CognitoUser): string {
    if (isSyntheticScorekeeper(user)) {
      const teamId = assignedTeamId(user);
      const team = teamId ? teams.find((t) => t.id === teamId) : null;
      return team ? `${team.name} (scorekeeper)` : 'Unassigned scorekeeper';
    }
    return user.email;
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Users</h1>

      {/* ── Scorekeeper Onboarding ── */}
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Scorekeeper Onboarding</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Generate one QR code per team. Scorekeepers scan the code to sign in automatically.
            </p>
          </div>

          {/* End Game — right side */}
          <div className="flex flex-col items-end gap-1">
            {endGameConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Sign out all scorekeepers?</span>
                <button
                  type="button"
                  onClick={handleEndGame}
                  disabled={endingGame}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {endingGame ? 'Ending…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => setEndGameConfirm(false)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEndGameConfirm(true)}
                className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
              >
                End Game
              </button>
            )}
            {endGameResult && (
              <p className="text-xs text-gray-500">{endGameResult}</p>
            )}
          </div>
        </div>

        {/* Generate button */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {generating
              ? 'Generating…'
              : tokens.length > 0
              ? 'Regenerate QR Codes'
              : 'Generate QR Codes'}
          </button>

          {tokens.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setQrDisplayIndex(0)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Show All QR Codes
              </button>
              <button
                type="button"
                onClick={() => setShowPrintGrid(true)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Print All
              </button>
            </>
          )}
        </div>

        {generateError && (
          <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
            {generateError}
          </div>
        )}

        {/* Per-team token list */}
        {tokens.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {tokens.map((token, idx) => (
              <li
                key={token.tokenId}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {token.teamName}
                  </p>
                  {token.groupType && (
                    <p className="text-xs text-gray-400">{token.groupType}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setQrDisplayIndex(idx)}
                  className="shrink-0 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                >
                  Show QR
                </button>
              </li>
            ))}
          </ul>
        )}

        {tokens.length === 0 && !generating && (
          <p className="text-sm text-gray-400">
            No QR codes generated yet. Click &quot;Generate QR Codes&quot; to create them.
          </p>
        )}
      </section>

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
          login. Scorekeepers onboard via QR code — use the section above.
        </p>
      </form>

      {/* ── Existing users list ── */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Existing Users</h2>

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
              const currentRole = userRole(user);
              const isScorekeeper = currentRole === 'Scorekeepers';
              const currentTeamId = assignedTeamId(user);
              const roleChanging = savingRole === user.username;
              const teamChanging = savingTeam === user.username;
              const synthetic = isSyntheticScorekeeper(user);

              return (
                <li key={user.username} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900">{displayName(user)}</p>
                    <p className="truncate text-xs text-gray-400">
                      {synthetic ? 'QR scorekeeper' : user.status}
                    </p>
                  </div>

                  {/* Role selector */}
                  <select
                    value={currentRole}
                    disabled={roleChanging || teamChanging}
                    onChange={(e) => {
                      void handleRoleChange(user, e.target.value as Role);
                    }}
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                    aria-label={`Role for ${displayName(user)}`}
                  >
                    <option value="Admins">Admin</option>
                    <option value="Scorekeepers">Scorekeeper</option>
                  </select>

                  {/* Team selector — only for scorekeepers; includes group type */}
                  {isScorekeeper && (
                    <select
                      value={currentTeamId}
                      disabled={roleChanging || teamChanging}
                      onChange={(e) => {
                        void handleTeamChange(user, e.target.value);
                      }}
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                      aria-label={`Team for ${displayName(user)}`}
                    >
                      <option value="">— no team —</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {teamOptionLabel(team)}
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
      </section>

      {/* ── QR display carousel (portal-style overlay) ── */}
      {qrDisplayIndex !== null && tokens.length > 0 && (
        <QrCodeDisplay
          tokens={tokens}
          initialIndex={qrDisplayIndex}
          onClose={() => setQrDisplayIndex(null)}
        />
      )}

      {/* ── Print grid overlay ── */}
      {showPrintGrid && tokens.length > 0 && (
        <QrCodePrintGrid
          tokens={tokens}
          onClose={() => setShowPrintGrid(false)}
        />
      )}
    </div>
  );
}
