'use client';

import { useCallback, useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '@/amplify/data/resource';
import { GAME_STATE_ID } from '@/app/lib/constants';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import Leaderboard, { type LeaderboardTeam, type ScoreHistoryEntry } from '@/app/components/Leaderboard';

const FAVORITE_KEY = 'bb_favorite';
const POLL_MS = 5000;
const SITE_URL = 'https://bible.pauldev.io/';

const client = generateClient<Schema>();

export default function ViewerPage() {
  const [teams, setTeams] = useState<LeaderboardTeam[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [favoriteTeamIds, setFavoriteTeamIds] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<string[]>([]);
  const [qrExpanded, setQrExpanded] = useState(false);

  useEffect(() => {
    // localStorage is unavailable during SSR, so read it after mount.
    // Support both the new JSON-array format and the legacy plain-string format.
    const raw = localStorage.getItem(FAVORITE_KEY);
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFavoriteTeamIds(new Set(parsed as string[]));
        return;
      }
    } catch {
      // Not valid JSON — fall through to legacy handling.
    }
    // Legacy: a bare team-id string.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFavoriteTeamIds(new Set([raw]));
  }, []);

  // Close full-screen QR on Escape
  useEffect(() => {
    if (!qrExpanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setQrExpanded(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [qrExpanded]);

  const onFavorite = useCallback((id: string) => {
    setFavoriteTeamIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      if (next.size) localStorage.setItem(FAVORITE_KEY, JSON.stringify([...next]));
      else localStorage.removeItem(FAVORITE_KEY);
      return next;
    });
  }, []);

  const fetchData = useCallback(async () => {
    // allow.guest() compiles to identityPool IAM; allow.authenticated() compiles to
    // Cognito user-pools "private". Pick the right mode so both states get through.
    const session = await fetchAuthSession({ forceRefresh: false }).catch(() => null);
    const authMode = session?.tokens?.accessToken ? 'userPool' : 'iam';
    setGroups(
      (session?.tokens?.accessToken?.payload['cognito:groups'] as string[] | undefined) ?? []
    );

    const [teamsRes, scoresRes, gameStateRes] = await Promise.all([
      client.models.Team.list({ authMode }),
      client.models.Score.list({ authMode }),
      client.models.GameState.get({ id: GAME_STATE_ID }, { authMode }),
    ]);

    // De-dupe: keep only the latest record per (teamId, questionNumber) by updatedAt.
    // This guards against duplicate Score records that may exist from prior bugs.
    const latestByCell = new Map<string, (typeof scoresRes.data)[number]>();
    for (const s of scoresRes.data) {
      const k = `${s.teamId}#${s.questionNumber}`;
      const prev = latestByCell.get(k);
      if (!prev || (s.updatedAt ?? '') > (prev.updatedAt ?? '')) latestByCell.set(k, s);
    }

    const totals = new Map<string, number>();
    const historyByTeam = new Map<string, ScoreHistoryEntry[]>();
    for (const score of latestByCell.values()) {
      totals.set(score.teamId, (totals.get(score.teamId) ?? 0) + (score.points ?? 0));
      const arr = historyByTeam.get(score.teamId) ?? [];
      arr.push({ questionNumber: score.questionNumber, points: score.points ?? 0 });
      historyByTeam.set(score.teamId, arr);
    }

    const computed: LeaderboardTeam[] = teamsRes.data
      .map((team) => ({
        id: team.id,
        name: team.name,
        total: totals.get(team.id) ?? 0,
        groupType: team.groupType ?? null,
        history: (historyByTeam.get(team.id) ?? []).sort(
          (a, b) => a.questionNumber - b.questionNumber
        ),
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

  const isAdmin = groups.includes('Admins');
  const isScorekeeper = groups.includes('Scorekeepers');

  return (
    <main className="flex min-h-full flex-col">
      <header className="relative border-b border-gray-200 bg-white px-4 py-4 text-center">
        <h1 className="text-xl font-bold text-indigo-700">🏆 Bible Bowl Live Scores</h1>
        <p className="mt-1 text-sm text-gray-500">
          {currentQuestion === null ? 'Waiting to start' : `Question ${currentQuestion}`}
        </p>
        {(isAdmin || isScorekeeper) && (
          <nav className="mt-2 flex justify-center gap-4">
            {isAdmin && (
              <Link
                href="/admin/scores"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
              >
                Admin
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

        {/* QR thumbnail — top-right of header */}
        <button
          type="button"
          onClick={() => setQrExpanded(true)}
          aria-label="Show full-screen QR code"
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 hover:bg-gray-100"
        >
          <QRCodeSVG value={SITE_URL} size={40} />
        </button>
      </header>

      {/* Full-screen QR overlay */}
      {qrExpanded && (
        <div
          role="dialog"
          aria-label="Full-screen QR code"
          className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-6 bg-black p-6"
          onClick={() => setQrExpanded(false)}
        >
          <QRCodeSVG
            value={SITE_URL}
            size={500}
            bgColor="#000000"
            fgColor="#ffffff"
            className="h-auto w-full max-w-[500px]"
          />
          <p className="text-lg font-medium text-white">{SITE_URL}</p>
        </div>
      )}

      <Leaderboard
        teams={teams}
        favoriteTeamIds={favoriteTeamIds}
        onFavorite={onFavorite}
        currentQuestion={currentQuestion}
        loading={loading}
      />
    </main>
  );
}
