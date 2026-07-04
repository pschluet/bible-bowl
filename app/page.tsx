'use client';

import { useEffect, useMemo, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import Link from 'next/link';
import type { Schema } from '@/amplify/data/resource';
import { subscribeLive } from '@/app/lib/liveQuery';

type Game = Schema['Game']['type'];

const client = generateClient<Schema>();

export default function GamePickerPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<string[]>([]);
  const [authMode, setAuthMode] = useState<'userPool' | 'iam' | null>(null);

  useEffect(() => {
    void fetchAuthSession({ forceRefresh: false })
      .catch(() => null)
      .then((session) => {
        setAuthMode(session?.tokens?.accessToken ? 'userPool' : 'iam');
        setGroups(
          (session?.tokens?.accessToken?.payload['cognito:groups'] as string[] | undefined) ?? []
        );
      });
  }, []);

  useEffect(() => {
    if (!authMode) return;
    const mode = authMode;
    return subscribeLive(
      () => client.models.Game.observeQuery({ authMode: mode }),
      ({ items, isSynced }) => {
        setGames(items);
        if (isSynced) setLoading(false);
      },
      `game:all:${mode}`
    );
  }, [authMode]);

  const sortedGames = useMemo(
    () => [...games].sort((a, b) => a.title.localeCompare(b.title)),
    [games]
  );

  const isAdmin = groups.includes('Admins') || groups.includes('SuperAdmins');
  const isScorekeeper = groups.includes('Scorekeepers');

  return (
    <main className="flex min-h-screen flex-col items-center bg-gray-50 px-4 py-12">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold text-indigo-700">🏆 Bible Bowl</h1>
        <p className="mt-2 text-gray-500">Select a game to view the live leaderboard</p>

        {/* Quick nav for logged-in users */}
        {(isAdmin || isScorekeeper) && (
          <nav className="mt-4 flex justify-center gap-4">
            {isAdmin && (
              <Link
                href="/admin/games"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
              >
                Admin Dashboard
              </Link>
            )}
            {isScorekeeper && (
              <Link
                href="/scorekeeper"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
              >
                Scorekeeper
              </Link>
            )}
          </nav>
        )}
        {!isAdmin && !isScorekeeper && (
          <nav className="mt-4 flex justify-center">
            <Link
              href="/login"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              Admin Login
            </Link>
          </nav>
        )}
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
        </div>
      ) : sortedGames.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-10 text-center text-gray-400">
          No games are currently available.
        </div>
      ) : (
        <ul className="w-full max-w-md divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {sortedGames.map((game) => (
            <li key={game.slug}>
              <Link
                href={`/g/${game.slug}`}
                className="flex items-center gap-3 px-5 py-4 hover:bg-indigo-50"
              >
                <div className="flex-1">
                  <p className="font-semibold text-gray-900">{game.title}</p>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">/g/{game.slug}</p>
                </div>
                <span className="text-gray-400 text-sm">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
