'use client';

import { useCallback, useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import { getCurrentUser } from 'aws-amplify/auth';
import type { Schema } from '@/amplify/data/resource';
import { subscribeLive } from '@/app/lib/liveQuery';
import { compareTeamOrder } from '@/app/lib/constants';
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

  const [refreshingUsers, setRefreshingUsers] = useState(false);

  // ── per-user delete ────────────────────────────────────────────────────────
  const [currentSub, setCurrentSub] = useState<string | null>(null);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

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
    // Identify the signed-in admin so we can disable self-delete
    void getCurrentUser()
      .then(({ userId }) => setCurrentSub(userId))
      .catch(() => {});
  }, [loadTeams, loadUsers]);

  // ── Live token subscription ────────────────────────────────────────────────
  // Hydrates on mount AND streams UNUSED→CONSUMED status changes in real-time
  // so the admin sees "Used" badges appear as scorekeepers onboard without
  // reloading. Depends on `teams` for the team-name join; re-subscribes if
  // teams change.
  useEffect(() => {
    if (teams.length === 0) return; // wait until teams have loaded

    return subscribeLive(
      () => client.models.OnboardingToken.observeQuery({ authMode: 'userPool' }),
      ({ items }) => {
        if (items.length === 0) {
          setTokens([]);
          return;
        }

        // Find the most recently generated batch (latest expiresAt across the batch)
        const byBatch = new Map<string, typeof items>();
        for (const item of items) {
          const key = item.batchId ?? '__none__';
          if (!byBatch.has(key)) byBatch.set(key, []);
          byBatch.get(key)!.push(item);
        }

        let latestBatchKey = '__none__';
        let latestExpiry = '';
        for (const [batchKey, batchItems] of byBatch) {
          const maxExpiry = batchItems.reduce(
            (best, t) => (t.expiresAt && t.expiresAt > best ? t.expiresAt : best),
            ''
          );
          if (maxExpiry > latestExpiry) {
            latestExpiry = maxExpiry;
            latestBatchKey = batchKey;
          }
        }

        const latestBatch = byBatch.get(latestBatchKey) ?? [];

        // Join against the sorted teams array to produce QrToken[]
        const mapped: QrToken[] = latestBatch
          .flatMap((t): QrToken[] => {
            const team = teams.find((tm) => tm.id === t.teamId);
            if (!team) return [];
            return [
              {
                tokenId: t.tokenId,
                teamId: t.teamId,
                teamName: team.name,
                groupType: team.groupType ?? null,
                status: (t.status ?? 'UNUSED') as 'UNUSED' | 'CONSUMED',
              },
            ];
          })
          // Preserve the same order as the sorted teams list
          .sort((a, b) => {
            const ai = teams.findIndex((t) => t.id === a.teamId);
            const bi = teams.findIndex((t) => t.id === b.teamId);
            return ai - bi;
          });

        setTokens(mapped);
      }
    );
  }, [teams]); // `client` is module-level stable — no need to list it

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
      // Tokens are now owned by the observeQuery subscription — no manual setTokens needed.
      // The new batch will appear within milliseconds via the live subscription.
      await loadUsers(); // refresh so any newly created scorekeeper users appear
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
      const data = (await res.json()) as { deleted?: number; failures?: number };
      setEndGameResult(
        `Game ended. Deleted ${data.deleted ?? 0} scorekeeper(s).${
          (data.failures ?? 0) > 0 ? ` (${data.failures} failure(s) — see logs)` : ''
        }`
      );
      // Refresh users + teams so deleted scorekeepers and cleared bindings are gone.
      // Token badges update automatically via the live subscription.
      await Promise.all([loadUsers(), loadTeams()]);
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

  // ── delete user ────────────────────────────────────────────────────────────
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
      await Promise.all([loadUsers(), loadTeams()]);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Failed to delete user.');
    } finally {
      setDeletingUser(null);
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  /** Find the team currently assigned to this user. */
  function assignedTeamId(user: CognitoUser): string {
    // For synthetic scorekeepers the username encodes the teamId directly:
    // "team-<teamId>@bible-bowl.internal". This is the most reliable source
    // since Team.scorekeeperUserId may be unset if the binding step failed.
    if (isSyntheticScorekeeper(user)) {
      const match = user.email.match(/^team-(.+)@/);
      if (match) {
        const teamId = match[1];
        if (teams.some((t) => t.id === teamId)) return teamId;
      }
    }
    const byId = teams.find((t) => t.scorekeeperUserId === user.sub);
    if (byId) return byId.id;
    const byEmail = teams.find(
      (t) => !t.scorekeeperUserId && t.scorekeeperEmail === user.email
    );
    return byEmail?.id ?? '';
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Users</h1>

      {/* ── Scorekeeper Onboarding ── */}
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        {/* Heading row */}
        <div className="mb-4">
          <h2 className="text-base font-semibold text-gray-900">Scorekeeper Onboarding</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Generate one QR code per team. Scorekeepers scan the code to sign in automatically.
          </p>
        </div>

        {/* Button toolbar — Generate/Show/Print on the left, End Game on the right */}
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

          {/* End Game — pushed to the far right */}
          <div className="ml-auto flex flex-col items-end gap-1">
            {endGameConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Delete all scorekeepers?</span>
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
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                    token.status === 'UNUSED'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {token.status === 'UNUSED' ? 'Available' : 'Used'}
                </span>
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Existing Users</h2>
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
              const isAdmin = user.groups.includes('Admins');
              const teamId = synthetic ? assignedTeamId(user) : '';
              const team = teamId ? teams.find((t) => t.id === teamId) : null;
              const isSelf = user.sub === currentSub;
              const confirming = deleteConfirmUser === user.username;
              const deleting = deletingUser === user.username;

              return (
                <li key={user.username} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  {/* Identity — read-only */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-gray-900">
                        {synthetic
                          ? (team?.name ?? 'Unassigned scorekeeper')
                          : user.email}
                      </p>
                      {synthetic ? (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                          QR Scorekeeper
                        </span>
                      ) : (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                          {isAdmin ? 'Admin' : 'Scorekeeper'}
                        </span>
                      )}
                    </div>
                    {!synthetic && (
                      <p className="text-xs text-gray-400">{user.status}</p>
                    )}
                  </div>

                  {/* Delete — two-step confirm */}
                  {confirming ? (
                    <div className="flex items-center gap-2">
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
                    </div>
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
