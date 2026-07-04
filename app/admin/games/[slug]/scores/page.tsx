'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '@/amplify/data/resource';
import { GROUP_LABELS, GroupType, compareTeamOrder, scoreId } from '@/app/lib/constants';
import { subscribeLive } from '@/app/lib/liveQuery';
import { downloadCsv, escapeCsvField, localTimestamp } from '@/app/lib/csv';
import ScoreGrid from '@/app/components/ScoreGrid';
import QuickEntryDrawer from '@/app/components/QuickEntryDrawer';
import KeyboardLegend from '@/app/components/KeyboardLegend';
import Spinner from '@/app/components/Spinner';

type Team = Schema['Team']['type'];
type Score = Schema['Score']['type'];
type Game = Schema['Game']['type'];

const client = generateClient<Schema>({ authMode: 'userPool' });

/**
 * Fire-and-forget: after a full load we delete any duplicate Score records
 * (same teamId+questionNumber), keeping the one with the latest updatedAt.
 */
function healDuplicates(all: Score[]) {
  const byKey = new Map<string, Score[]>();
  for (const s of all) {
    const k = `${s.teamId}#${s.questionNumber}`;
    let arr = byKey.get(k);
    if (!arr) {
      arr = [];
      byKey.set(k, arr);
    }
    arr.push(s);
  }
  for (const recs of byKey.values()) {
    if (recs.length < 2) continue;
    const sorted = [...recs].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    sorted.slice(1).forEach((s) => {
      void client.models.Score.delete({ id: s.id }, { authMode: 'userPool' });
    });
  }
}

interface Props {
  params: Promise<{ slug: string }>;
}

export default function AdminScoresPage({ params }: Props) {
  const { slug } = use(params);

  const [userSub, setUserSub] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [streamedScores, setStreamedScores] = useState<Score[]>([]);
  const [optimisticScores, setOptimisticScores] = useState<Score[]>([]);
  const [game, setGame] = useState<Game | null>(null);
  const [teamsSynced, setTeamsSynced] = useState(false);
  const [scoresSynced, setScoresSynced] = useState(false);
  const loading = !teamsSynced || !scoresSynced;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [recentEntry, setRecentEntry] = useState<{ teamId: string; points: number } | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreMapRef = useRef<Map<string, Map<number, Score>>>(new Map());
  const healedRef = useRef(false);

  const currentQuestion = game?.currentQuestion ?? null;

  // Get user sub for stamping ownerId on new scores
  useEffect(() => {
    void fetchAuthSession().then((session) => {
      setUserSub((session.tokens?.accessToken?.payload.sub as string | undefined) ?? null);
    });
  }, []);

  const scores = useMemo((): Score[] => {
    if (optimisticScores.length === 0) return streamedScores;
    const map = new Map(streamedScores.map((s) => [s.id, s]));
    for (const opt of optimisticScores) {
      const streamed = map.get(opt.id);
      if (!streamed || (opt.updatedAt ?? '') > (streamed.updatedAt ?? '')) {
        map.set(opt.id, opt);
      }
    }
    return [...map.values()];
  }, [streamedScores, optimisticScores]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOptimisticScores((prev) => {
      if (prev.length === 0) return prev;
      const streamMap = new Map(streamedScores.map((s) => [s.id, s]));
      const next = prev.filter((opt) => {
        const s = streamMap.get(opt.id);
        return !s || (opt.updatedAt ?? '') > (s.updatedAt ?? '');
      });
      return next.length === prev.length ? prev : next;
    });
  }, [streamedScores]);

  useEffect(
    () => () => {
      if (advanceTimerRef.current !== null) clearTimeout(advanceTimerRef.current);
    },
    []
  );

  const sortedTeams = useMemo(() => [...teams].sort(compareTeamOrder), [teams]);

  const scoreMap = useMemo(() => {
    const map = new Map<string, Map<number, Score>>();
    for (const score of scores) {
      let byQuestion = map.get(score.teamId);
      if (!byQuestion) {
        byQuestion = new Map<number, Score>();
        map.set(score.teamId, byQuestion);
      }
      const existing = byQuestion.get(score.questionNumber);
      if (!existing || (score.updatedAt ?? '') > (existing.updatedAt ?? '')) {
        byQuestion.set(score.questionNumber, score);
      }
    }
    return map;
  }, [scores]);
  useEffect(() => {
    scoreMapRef.current = scoreMap;
  }, [scoreMap]);

  useEffect(() => {
    if (currentQuestion !== null && sortedTeams.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedTeamId((prev) => {
        if (prev && sortedTeams.some((t) => t.id === prev)) return prev;
        return sortedTeams[0].id;
      });
    }
  }, [currentQuestion, sortedTeams]);

  // Team stream — filtered to this game
  useEffect(() => {
    return subscribeLive(
      () =>
        client.models.Team.observeQuery({
          authMode: 'userPool',
          filter: { gameId: { eq: slug } },
        }),
      ({ items, isSynced }) => {
        setTeams(items);
        if (isSynced) setTeamsSynced(true);
      }
    );
  }, [slug]);

  // Score stream — filtered to this game
  useEffect(() => {
    return subscribeLive(
      () =>
        client.models.Score.observeQuery({
          authMode: 'userPool',
          filter: { gameId: { eq: slug } },
        }),
      ({ items, isSynced }) => {
        setStreamedScores(items);
        if (isSynced) {
          setScoresSynced(true);
          if (!healedRef.current) {
            healedRef.current = true;
            healDuplicates(items);
          }
        }
      }
    );
  }, [slug]);

  // Game stream — for currentQuestion and scoringOpen
  useEffect(() => {
    return subscribeLive(
      () =>
        client.models.Game.observeQuery({
          authMode: 'userPool',
          filter: { slug: { eq: slug } },
        }),
      ({ items }) => {
        setGame(items[0] ?? null);
      }
    );
  }, [slug]);

  const selectTeam = useCallback((id: string) => setSelectedTeamId(id), []);
  const selectNext = useCallback(() => {
    setSelectedTeamId((prev) => {
      const idx = sortedTeams.findIndex((t) => t.id === prev);
      if (idx >= 0 && idx < sortedTeams.length - 1) return sortedTeams[idx + 1].id;
      return prev;
    });
  }, [sortedTeams]);
  const selectPrev = useCallback(() => {
    setSelectedTeamId((prev) => {
      const idx = sortedTeams.findIndex((t) => t.id === prev);
      if (idx > 0) return sortedTeams[idx - 1].id;
      return prev;
    });
  }, [sortedTeams]);

  async function handleInitialize() {
    setBusy(true);
    setError(null);
    try {
      await client.models.Game.update(
        { slug, currentQuestion: 1, scoringOpen: true },
        { authMode: 'userPool' }
      );
    } catch {
      setError('Failed to initialize game.');
    } finally {
      setBusy(false);
    }
  }

  async function handleNextQuestion() {
    if (currentQuestion === null) return;
    setBusy(true);
    setError(null);
    try {
      await client.models.Game.update(
        { slug, currentQuestion: currentQuestion + 1 },
        { authMode: 'userPool' }
      );
    } catch {
      setError('Failed to advance question.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (
      !confirm(
        'Reset all scores and questions for this game?\n\nEvery score will be permanently deleted and the game will return to "not started". Teams are kept.\n\nThis cannot be undone.'
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      // Delete all scores for this game
      let nextToken: string | null | undefined;
      do {
        const page = await client.models.Score.list({
          filter: { gameId: { eq: slug } },
          ...(nextToken ? { nextToken } : {}),
        });
        await Promise.all(
          page.data.map((s) => client.models.Score.delete({ id: s.id }, { authMode: 'userPool' }))
        );
        nextToken = page.nextToken;
      } while (nextToken);

      // Reset currentQuestion (keep the game, just reset progress)
      await client.models.Game.update(
        { slug, currentQuestion: 1, scoringOpen: true },
        { authMode: 'userPool' }
      );

      setOptimisticScores([]);
    } catch {
      setError('Failed to reset the game.');
    } finally {
      setBusy(false);
    }
  }

  const saveScore = useCallback(
    async (teamId: string, questionNumber: number, points: number) => {
      setError(null);
      const existing = scoreMapRef.current.get(teamId)?.get(questionNumber) ?? null;
      const id = existing?.id ?? scoreId(teamId, questionNumber);
      const now = new Date().toISOString();

      setOptimisticScores((prev) => {
        const next = prev.filter((s) => s.id !== id);
        next.push({
          ...(existing ?? {}),
          id,
          gameId: slug,
          ownerId: game?.ownerId ?? userSub ?? '',
          teamId,
          questionNumber,
          points,
          updatedAt: now,
        } as Score);
        return next;
      });

      try {
        if (existing) {
          await client.models.Score.update({ id, points }, { authMode: 'userPool' });
        } else {
          const { errors } = await client.models.Score.create(
            {
              id,
              gameId: slug,
              ownerId: game?.ownerId ?? userSub ?? '',
              teamId,
              questionNumber,
              points,
            },
            { authMode: 'userPool' }
          );
          if (errors?.length) {
            await client.models.Score.update({ id, points }, { authMode: 'userPool' });
          }
        }
      } catch {
        setError('Failed to save score.');
        setOptimisticScores((prev) => prev.filter((s) => s.id !== id));
      }
    },
    [slug, game, userSub]
  );

  const enterScoreAndAdvance = useCallback(
    (teamId: string, points: number) => {
      if (currentQuestion === null) return;
      void saveScore(teamId, currentQuestion, points);
      setRecentEntry({ teamId, points });
      if (advanceTimerRef.current !== null) clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = setTimeout(() => {
        selectNext();
        setRecentEntry(null);
        advanceTimerRef.current = null;
      }, 450);
    },
    [currentQuestion, saveScore, selectNext]
  );

  const handleScoreDelete = useCallback(async (existingId: string) => {
    setError(null);
    try {
      await client.models.Score.delete({ id: existingId }, { authMode: 'userPool' });
    } catch {
      setError('Failed to clear score.');
    }
  }, []);

  const handleExport = useCallback(() => {
    const questionNumbers = Array.from({ length: currentQuestion ?? 0 }, (_, i) => i + 1);
    const header = ['Team', 'Type', ...questionNumbers.map((q) => `Q${q}`), 'Total'];
    const rows = sortedTeams.map((team) => {
      const byQuestion = scoreMap.get(team.id);
      const typeLabel =
        team.groupType && team.groupType in GROUP_LABELS
          ? GROUP_LABELS[team.groupType as GroupType]
          : '';
      let total = 0;
      const questionCells = questionNumbers.map((q) => {
        const s = byQuestion?.get(q);
        if (s !== undefined) {
          total += s.points;
          return String(s.points);
        }
        return '';
      });
      return [team.name, typeLabel, ...questionCells, String(total)];
    });
    const csvLines = [header, ...rows]
      .map((fields) => fields.map(escapeCsvField).join(','))
      .join('\n');
    const filename = `bible-bowl-scores-${localTimestamp(new Date())}.csv`;
    downloadCsv(filename, csvLines);
  }, [currentQuestion, sortedTeams, scoreMap]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Scores</h1>
            {currentQuestion !== null && <KeyboardLegend />}
          </div>
          {currentQuestion !== null && (
            <p className="text-sm text-gray-500">Current Question: {currentQuestion}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {currentQuestion === null ? (
            <button
              type="button"
              onClick={handleInitialize}
              disabled={busy || loading}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Initialize Game
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setQuickEntryOpen(true)}
                disabled={busy}
                className="rounded-md border border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
              >
                Quick Entry
              </button>
              <button
                type="button"
                onClick={handleNextQuestion}
                disabled={busy}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Next Question
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
        </div>
      ) : (
        <>
          <ScoreGrid
            teams={sortedTeams}
            scoreMap={scoreMap}
            currentQuestion={currentQuestion}
            onScoreChange={saveScore}
            onScoreDelete={handleScoreDelete}
            selectedTeamId={selectedTeamId}
            onSelect={selectTeam}
            onSelectNext={selectNext}
            onSelectPrev={selectPrev}
            onEnterScore={enterScoreAndAdvance}
            recentEntry={recentEntry}
          />
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={handleExport}
              disabled={loading || sortedTeams.length === 0}
              className="rounded-md border border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
            >
              Export Scores
            </button>
          </div>
        </>
      )}

      {quickEntryOpen && (
        <QuickEntryDrawer
          sortedTeams={sortedTeams}
          scoreMap={scoreMap}
          currentQuestion={currentQuestion}
          selectedTeamId={selectedTeamId}
          onSelectNext={selectNext}
          onSelectPrev={selectPrev}
          onEnterScore={enterScoreAndAdvance}
          onClose={() => setQuickEntryOpen(false)}
          recentEntry={recentEntry}
        />
      )}

      <div className="mt-10 rounded-lg border border-red-200 bg-red-50 p-4">
        <h2 className="text-sm font-semibold text-red-800">Danger Zone</h2>
        <p className="mt-1 text-sm text-red-700">
          Delete all scores and reset the game to &ldquo;not started&rdquo;. Teams and scorekeeper
          assignments are kept.
        </p>
        <button
          type="button"
          onClick={handleReset}
          disabled={busy || loading}
          className="mt-3 flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy && <Spinner />}
          Reset Scores &amp; Questions
        </button>
      </div>
    </div>
  );
}
