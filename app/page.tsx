'use client';

import { useCallback, useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '@/amplify/data/resource';
import { GAME_STATE_ID } from '@/app/lib/constants';
import Leaderboard, { type LeaderboardTeam } from '@/app/components/Leaderboard';

const FAVORITE_KEY = 'bb_favorite';
const POLL_MS = 5000;

const client = generateClient<Schema>();

export default function ViewerPage() {
  const [teams, setTeams] = useState<LeaderboardTeam[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [favoriteTeamId, setFavoriteTeamId] = useState<string | null>(null);

  useEffect(() => {
    // localStorage is unavailable during SSR, so read it after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFavoriteTeamId(localStorage.getItem(FAVORITE_KEY));
  }, []);

  const onFavorite = useCallback((id: string) => {
    setFavoriteTeamId((prev) => {
      const next = prev === id ? null : id;
      if (next) localStorage.setItem(FAVORITE_KEY, next);
      else localStorage.removeItem(FAVORITE_KEY);
      return next;
    });
  }, []);

  const fetchData = useCallback(async () => {
    // allow.guest() compiles to identityPool IAM; allow.authenticated() compiles to
    // Cognito user-pools "private". Pick the right mode so both states get through.
    const session = await fetchAuthSession({ forceRefresh: false }).catch(() => null);
    const authMode = session?.tokens?.accessToken ? 'userPool' : 'iam';

    const [teamsRes, scoresRes, gameStateRes] = await Promise.all([
      client.models.Team.list({ authMode }),
      client.models.Score.list({ authMode }),
      client.models.GameState.get({ id: GAME_STATE_ID }, { authMode }),
    ]);

    const totals = new Map<string, number>();
    for (const score of scoresRes.data) {
      totals.set(score.teamId, (totals.get(score.teamId) ?? 0) + (score.points ?? 0));
    }

    const computed: LeaderboardTeam[] = teamsRes.data
      .map((team) => ({
        id: team.id,
        name: team.name,
        total: totals.get(team.id) ?? 0,
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    setTeams(computed);
    setCurrentQuestion(gameStateRes.data?.currentQuestion ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Async data load + polling: synchronizing React with an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
    const interval = setInterval(() => void fetchData(), POLL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <main className="flex min-h-full flex-col">
      <header className="border-b border-gray-200 bg-white px-4 py-4 text-center">
        <h1 className="text-xl font-bold text-indigo-700">🏆 Bible Bowl Live Scores</h1>
        <p className="mt-1 text-sm text-gray-500">
          {currentQuestion === null ? 'Waiting to start' : `Question ${currentQuestion}`}
        </p>
      </header>
      <Leaderboard
        teams={teams}
        favoriteTeamId={favoriteTeamId}
        onFavorite={onFavorite}
        currentQuestion={currentQuestion}
        loading={loading}
      />
    </main>
  );
}
