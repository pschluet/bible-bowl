'use client';

import { useEffect, useMemo, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import Link from 'next/link';
import type { Schema } from '@/amplify/data/resource';
import { subscribeLive } from '@/app/lib/liveQuery';
import { normalizeSlug, validateSlug } from '@/app/lib/constants';
import Spinner from '@/app/components/Spinner';

type Game = Schema['Game']['type'];

const client = generateClient<Schema>({ authMode: 'userPool' });

export default function AdminGamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [userSub, setUserSub] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [ownerEmails, setOwnerEmails] = useState<Map<string, string>>(new Map());

  // Create form
  const [newTitle, setNewTitle] = useState('');
  const [editedSlug, setEditedSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Delete state
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [deleteConfirmSlug, setDeleteConfirmSlug] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Derive the normalized slug from the title when the title changes,
  // unless the user has manually edited the slug field.
  const [slugEdited, setSlugEdited] = useState(false);
  const suggestedSlug = useMemo(() => normalizeSlug(newTitle), [newTitle]);
  // Derived during render — no effect needed.
  const newSlugRaw = slugEdited ? editedSlug : suggestedSlug;

  // Load current user's sub and groups; fetch owner email map if super admin
  useEffect(() => {
    void fetchAuthSession().then(async (session) => {
      const sub = (session.tokens?.accessToken?.payload.sub as string | undefined) ?? null;
      const groups =
        (session.tokens?.accessToken?.payload['cognito:groups'] as string[] | undefined) ?? [];
      const superAdmin = groups.includes('SuperAdmins');
      setUserSub(sub);
      setIsSuperAdmin(superAdmin);

      if (superAdmin) {
        try {
          const res = await fetch('/api/admin/users');
          if (res.ok) {
            const data = (await res.json()) as { users: Array<{ sub: string; email: string }> };
            setOwnerEmails(new Map(data.users.map((u) => [u.sub, u.email])));
          }
        } catch {
          // Non-fatal — fall back to showing sub
        }
      }
    });
  }, []);

  // Subscribe to all games — owner auth means admins only see their own,
  // super admins see all. Filter client-side for the admin's own games
  // (super admins see all).
  useEffect(() => {
    return subscribeLive(
      () => client.models.Game.observeQuery({ authMode: 'userPool' }),
      ({ items, isSynced }) => {
        setGames(items);
        if (isSynced) setLoading(false);
      },
      'game:all:userPool'
    );
  }, []);

  // Show only the current admin's games unless super admin
  const visibleGames = useMemo(() => {
    if (isSuperAdmin || !userSub) return games;
    return games.filter((g) => g.ownerId === userSub);
  }, [games, isSuperAdmin, userSub]);

  const sortedGames = useMemo(
    () => [...visibleGames].sort((a, b) => a.title.localeCompare(b.title)),
    [visibleGames]
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);

    const slug = normalizeSlug(newSlugRaw);
    const title = newTitle.trim();

    if (!title) {
      setCreateError('Title is required.');
      return;
    }
    const slugErr = validateSlug(slug);
    if (slugErr) {
      setCreateError(slugErr);
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/admin/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, slug }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; slug?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? 'Failed to create game.');
      }
      // Game will appear via subscription. Reset form.
      setNewTitle('');
      setEditedSlug('');
      setSlugEdited(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create game.');
    } finally {
      setCreating(false);
    }
  }

  // Deleting a game with lots of teams/scores can transiently fail server-side
  // (e.g. under load). The delete is idempotent and convergent — each pass only
  // touches whatever's left — so a few automatic retries finish the job without
  // making the admin re-click Delete themselves.
  async function handleDelete(slug: string) {
    setDeletingSlug(slug);
    setDeleteError(null);
    setDeleteConfirmSlug(null);

    const maxAttempts = 3;
    let lastError = 'Failed to delete game.';
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await fetch('/api/admin/games', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId: slug }),
          });
          if (res.ok) return; // Game disappears via subscription
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          lastError = data?.error ?? lastError;
          if (res.status === 404) break; // already gone — retrying won't help
        } catch (err) {
          lastError = err instanceof Error ? err.message : lastError;
        }
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
      setDeleteError(lastError);
    } finally {
      setDeletingSlug(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Games</h1>

      {/* Create game */}
      <form onSubmit={handleCreate} className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-900">Create Game</h2>
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="game-title" className="mb-1 block text-sm font-medium text-gray-700">
              Title
            </label>
            <input
              id="game-title"
              type="text"
              required
              placeholder="e.g. Faith Community 2026"
              value={newTitle}
              onChange={(e) => {
                setNewTitle(e.target.value);
              }}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="game-slug" className="mb-1 block text-sm font-medium text-gray-700">
              Game Code{' '}
              <span className="font-normal text-gray-400">
                (public URL: /g/
                <span className="italic">{normalizeSlug(newSlugRaw) || 'code'}</span>)
              </span>
            </label>
            <input
              id="game-slug"
              type="text"
              required
              placeholder="e.g. faith-2026"
              value={newSlugRaw}
              onChange={(e) => {
                setEditedSlug(e.target.value);
                setSlugEdited(true);
              }}
              onBlur={() => setEditedSlug(normalizeSlug(newSlugRaw))}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-indigo-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-400">
              Lowercase letters, numbers, and hyphens only. Immutable after creation.
            </p>
          </div>
          {createError && (
            <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{createError}</div>
          )}
          <button
            type="submit"
            disabled={creating || !newTitle.trim() || !newSlugRaw.trim()}
            className="self-start rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create Game'}
          </button>
        </div>
      </form>

      {deleteError && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
          {deleteError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
        </div>
      ) : sortedGames.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
          No games yet. Create one above.
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {sortedGames.map((game) => {
            const confirming = deleteConfirmSlug === game.slug;
            const deleting = deletingSlug === game.slug;

            return (
              <li
                key={game.slug}
                className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/games/${game.slug}/scores`}
                    className="font-semibold text-gray-900 hover:text-indigo-700"
                  >
                    {game.title}
                  </Link>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">/g/{game.slug}</p>
                  {isSuperAdmin && game.ownerId !== userSub && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Owner: {ownerEmails.get(game.ownerId) ?? game.ownerId}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Link
                    href={`/admin/games/${game.slug}/scores`}
                    className="rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
                  >
                    Manage
                  </Link>
                  <Link
                    href={`/g/${game.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Leaderboard ↗
                  </Link>
                  {confirming ? (
                    <>
                      <span className="text-xs text-gray-500">Delete game + all data?</span>
                      <button
                        type="button"
                        onClick={() => void handleDelete(game.slug)}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmSlug(null)}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmSlug(game.slug)}
                      disabled={deleting}
                      className="flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {deleting && (
                        <Spinner className="h-3.5 w-3.5 border-2 border-red-200 border-t-red-600" />
                      )}
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
