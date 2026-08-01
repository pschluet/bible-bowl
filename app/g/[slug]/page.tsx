'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import { notFound } from 'next/navigation';
import type { Schema } from '@/amplify/data/resource';
import { subscribeLive } from '@/app/lib/liveQuery';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import Leaderboard, {
  type LeaderboardTeam,
  type ScoreHistoryEntry,
} from '@/app/components/Leaderboard';
import { dedupeScoresByCell } from '@/app/lib/scores';
import { readFavorites, serializeFavorites, sortLeaderboardTeams } from '@/app/lib/leaderboard';

const FAVORITE_KEY = 'bb_favorite';
const client = generateClient<Schema>();

interface Props {
  params: Promise<{ slug: string }>;
}

export default function GameLeaderboardPage({ params }: Props) {
  const { slug } = use(params);

  const [favoriteTeamIds, setFavoriteTeamIds] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [qrExpanded, setQrExpanded] = useState(false);
  const [siteUrl, setSiteUrl] = useState('');
  const [teamsSynced, setTeamsSynced] = useState(false);
  const [scoresSynced, setScoresSynced] = useState(false);
  const [gameSynced, setGameSynced] = useState(false);
  const [gameNotFound, setGameNotFound] = useState(false);
  const loading = !teamsSynced || !scoresSynced || !gameSynced;

  const [authMode, setAuthMode] = useState<'userPool' | 'iam' | null>(null);

  const [rawTeams, setRawTeams] = useState<Schema['Team']['type'][]>([]);
  const [rawScores, setRawScores] = useState<Schema['Score']['type'][]>([]);
  const [game, setGame] = useState<Schema['Game']['type'] | null>(null);

  const currentQuestion = game?.currentQuestion ?? null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFavoriteTeamIds(readFavorites(localStorage.getItem(FAVORITE_KEY)));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSiteUrl(window.location.href);
  }, []);

  useEffect(() => {
    if (!qrExpanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setQrExpanded(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [qrExpanded]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [menuOpen]);

  useEffect(() => {
    void fetchAuthSession({ forceRefresh: false })
      .catch(() => null)
      .then((session) => {
        const mode: 'userPool' | 'iam' = session?.tokens?.accessToken ? 'userPool' : 'iam';
        setAuthMode(mode);
        setGroups(
          (session?.tokens?.accessToken?.payload['cognito:groups'] as string[] | undefined) ?? []
        );
      });
  }, []);

  // Game stream — filtered to this slug
  useEffect(() => {
    if (!authMode) return;
    const mode = authMode;
    return subscribeLive(
      () =>
        client.models.Game.observeQuery({
          authMode: mode,
          filter: { slug: { eq: slug } },
        }),
      ({ items, isSynced }) => {
        if (isSynced) {
          setGameSynced(true);
          if (items.length === 0) setGameNotFound(true);
        }
        setGame(items[0] ?? null);
      },
      `game:bySlug:${slug}:${mode}`
    );
  }, [authMode, slug]);

  // Team stream — filtered to this game
  useEffect(() => {
    if (!authMode) return;
    const mode = authMode;
    return subscribeLive(
      () =>
        client.models.Team.observeQuery({
          authMode: mode,
          filter: { gameId: { eq: slug } },
        }),
      ({ items, isSynced }) => {
        setRawTeams(items);
        if (isSynced) setTeamsSynced(true);
      },
      `team:byGame:${slug}:${mode}`
    );
  }, [authMode, slug]);

  // Score stream — filtered to this game
  useEffect(() => {
    if (!authMode) return;
    const mode = authMode;
    return subscribeLive(
      () =>
        client.models.Score.observeQuery({
          authMode: mode,
          filter: { gameId: { eq: slug } },
        }),
      ({ items, isSynced }) => {
        setRawScores(items);
        if (isSynced) setScoresSynced(true);
      },
      `score:byGame:${slug}:${mode}`
    );
  }, [authMode, slug]);

  // Amplify's observeQuery re-delivers the FULL score list on every single
  // write (see app/lib/liveQuery.ts), so this rebuilds every team's derived
  // object on every delta — even for teams whose scores didn't change.
  // Rather than fight that with a cross-render reference cache (which would
  // need to mutate a ref during render — disallowed by this project's React
  // Compiler lint rules), Leaderboard's per-row memoization does a cheap
  // value-based comparison of each team's data instead of relying on
  // reference equality, so an unaffected row still skips its re-render.
  const teams = useMemo((): LeaderboardTeam[] => {
    const deduped = dedupeScoresByCell(rawScores);

    const totals = new Map<string, number>();
    const historyByTeam = new Map<string, ScoreHistoryEntry[]>();
    for (const score of deduped) {
      totals.set(score.teamId, (totals.get(score.teamId) ?? 0) + (score.points ?? 0));
      const arr = historyByTeam.get(score.teamId) ?? [];
      arr.push({ questionNumber: score.questionNumber, points: score.points ?? 0 });
      historyByTeam.set(score.teamId, arr);
    }

    const mapped = rawTeams.map((team) => ({
      id: team.id,
      name: team.name,
      total: totals.get(team.id) ?? 0,
      groupType: team.groupType ?? null,
      history: (historyByTeam.get(team.id) ?? []).sort(
        (a, b) => a.questionNumber - b.questionNumber
      ),
    }));
    return sortLeaderboardTeams(mapped);
  }, [rawTeams, rawScores]);

  const onFavorite = useCallback((id: string) => {
    setFavoriteTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const serialized = serializeFavorites(next);
      if (serialized) localStorage.setItem(FAVORITE_KEY, serialized);
      else localStorage.removeItem(FAVORITE_KEY);
      return next;
    });
  }, []);

  // Show 404 after the game subscription has synced and found nothing
  if (gameNotFound && !loading) {
    notFound();
  }

  const isAdmin = groups.includes('Admins') || groups.includes('SuperAdmins');
  const isScorekeeper = groups.includes('Scorekeepers');

  return (
    <main className="flex min-h-full flex-col">
      <header className="relative border-b border-gray-200 bg-white px-4 py-4 text-center">
        <h1 className="text-lg font-bold text-indigo-700 sm:text-3xl">
          {game ? game.title : '🏆 Bible Bowl Live Scores'}
        </h1>
        <p className="mt-1 flex items-center justify-center gap-2 text-sm font-semibold text-gray-500 sm:text-lg">
          {currentQuestion !== null && (
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-amber-500 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
            </span>
          )}
          {currentQuestion === null ? 'Waiting to start' : `Question ${currentQuestion}`}
        </p>
        {/* Navigation menu — top-right of header */}
        <div ref={menuRef} className="absolute right-3 top-1/2 z-50 -translate-y-1/2">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-gray-100"
          >
            {/* Three bars that morph into an X when open */}
            <span className="flex flex-col gap-1">
              <span
                className={`h-0.5 w-5 rounded-full bg-indigo-600 transition-transform duration-300 ease-in-out origin-center${menuOpen ? ' translate-y-[6px] rotate-45' : ''}`}
              />
              <span
                className={`h-0.5 w-5 rounded-full bg-indigo-600 transition-[transform,opacity] duration-200 ease-in-out origin-center${menuOpen ? ' opacity-0' : ''}`}
              />
              <span
                className={`h-0.5 w-5 rounded-full bg-indigo-600 transition-transform duration-300 ease-in-out origin-center${menuOpen ? ' -translate-y-[6px] -rotate-45' : ''}`}
              />
            </span>
          </button>

          {/* Dropdown — always mounted; grid-rows animation expands/contracts height */}
          <nav
            className={`absolute right-0 z-50 mt-2 grid w-48 transition-[grid-template-rows,opacity] duration-300 ease-in-out${menuOpen ? ' grid-rows-[1fr] opacity-100' : ' grid-rows-[0fr] opacity-0 pointer-events-none'}`}
          >
            <div className="flex flex-col overflow-hidden rounded-md border border-gray-200 bg-white py-1 text-left shadow-lg">
              <Link
                href="/"
                onClick={() => setMenuOpen(false)}
                className="block w-full px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-gray-100"
              >
                All Games
              </Link>
              {isAdmin && (
                <Link
                  href="/admin/games"
                  onClick={() => setMenuOpen(false)}
                  className="block w-full px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-gray-100"
                >
                  Admin
                </Link>
              )}
              {isScorekeeper && (
                <Link
                  href="/scorekeeper"
                  onClick={() => setMenuOpen(false)}
                  className="block w-full px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-gray-100"
                >
                  Scorekeeper
                </Link>
              )}
              {!isAdmin && !isScorekeeper && (
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="block w-full px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-gray-100"
                >
                  Admin Login
                </Link>
              )}
              {siteUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setQrExpanded(true);
                    setMenuOpen(false);
                  }}
                  className="block w-full px-4 py-2 text-left text-sm font-medium text-indigo-600 hover:bg-gray-100"
                >
                  Show QR
                </button>
              )}
            </div>
          </nav>
        </div>
      </header>

      {qrExpanded && (
        <div
          role="dialog"
          aria-label="Full-screen QR code"
          className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-6 bg-black p-6"
          onClick={() => setQrExpanded(false)}
        >
          <p className="text-center text-4xl font-bold text-white sm:text-7xl">
            Scan for Live Scores
          </p>
          <QRCodeSVG
            value={siteUrl}
            size={500}
            bgColor="#000000"
            fgColor="#ffffff"
            className="h-auto w-full max-w-[500px]"
          />
          <p className="text-lg font-medium text-white">{siteUrl}</p>
        </div>
      )}

      <Leaderboard
        teams={teams}
        favoriteTeamIds={favoriteTeamIds}
        onFavorite={onFavorite}
        loading={loading}
      />
    </main>
  );
}
