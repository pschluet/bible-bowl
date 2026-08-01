'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '@/amplify/data/resource';
import { GROUP_LABELS, GroupType, compareTeamOrder, listAll, scoreId } from '@/app/lib/constants';
import { subscribeLive } from '@/app/lib/liveQuery';
import { buildScoresCsv, downloadCsv, scoresCsvFilename } from '@/app/lib/csv';
import { mapWithConcurrency, withRetry } from '@/app/lib/concurrency';
import {
  buildScoreMap,
  findDuplicateScoreIds,
  isValidPoints,
  mergeLatestById,
  pruneStaleOptimistic,
} from '@/app/lib/scores';
import ScoreGrid from '@/app/components/ScoreGrid';
import QuickEntryDrawer from '@/app/components/QuickEntryDrawer';
import KeyboardLegend from '@/app/components/KeyboardLegend';
import Spinner from '@/app/components/Spinner';

type Team = Schema['Team']['type'];
type Score = Schema['Score']['type'];
type Game = Schema['Game']['type'];

const client = generateClient<Schema>({ authMode: 'userPool' });

/**
 * Maximum simultaneous in-flight delete mutations when resetting a game's
 * scores. An unbounded Promise.all over a full list page can trip AppSync /
 * DynamoDB write-capacity limits on a large game; bounded concurrency +
 * retry avoids that (same pattern as the game-deletion API route).
 */
const RESET_DELETE_CONCURRENCY = 20;

/**
 * After a full load, deletes any duplicate Score records (same
 * teamId+questionNumber), keeping the one with the latest updatedAt. Runs
 * through the same bounded-concurrency + retry helper as every other bulk
 * delete in this file, and reports (rather than silently swallowing) any
 * deletion that still fails after retrying.
 */
async function healDuplicates(all: Score[]): Promise<{ failedIds: string[] }> {
  const idsToDelete = findDuplicateScoreIds(all);
  if (idsToDelete.length === 0) return { failedIds: [] };

  const failedIds: string[] = [];
  await mapWithConcurrency(idsToDelete, RESET_DELETE_CONCURRENCY, async (id) => {
    try {
      await withRetry(async () => {
        const { errors } = await client.models.Score.delete({ id }, { authMode: 'userPool' });
        if (errors && errors.length > 0) throw new Error(errors[0].message);
      });
    } catch (err) {
      failedIds.push(id);
      console.error(`Duplicate-score cleanup failed for ${id}:`, err);
    }
  });
  return { failedIds };
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
  // Highest question ever reached — never decreases when navigating back, so
  // later columns (and their already-entered scores) stay visible.
  const maxQuestionReached = Math.max(currentQuestion ?? 0, game?.maxQuestionReached ?? 0);

  // Get user sub for stamping ownerId on new scores
  useEffect(() => {
    void fetchAuthSession().then((session) => {
      setUserSub((session.tokens?.accessToken?.payload.sub as string | undefined) ?? null);
    });
  }, []);

  const scores = useMemo(
    (): Score[] => mergeLatestById(streamedScores, optimisticScores),
    [streamedScores, optimisticScores]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOptimisticScores((prev) => {
      if (prev.length === 0) return prev;
      const next = pruneStaleOptimistic(prev, streamedScores);
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

  // Amplify's observeQuery re-delivers the FULL score list on every single
  // write (see app/lib/liveQuery.ts), so this rebuilds every team's inner Map
  // on every delta — even for teams whose scores didn't change. Rather than
  // fight that with a cross-render reference cache (which would need to
  // mutate a ref during render — disallowed by this project's React
  // Compiler lint rules), ScoreGrid's per-row memoization does a cheap
  // value-based comparison of `byQuestion` instead of relying on reference
  // equality, so an unaffected row still skips its re-render.
  const scoreMap = useMemo(() => buildScoreMap(scores), [scores]);
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
      },
      `team:byGame:${slug}`
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
            void healDuplicates(items).then(({ failedIds }) => {
              if (failedIds.length > 0) {
                setError(
                  `Failed to clean up ${failedIds.length} duplicate score record(s). Please refresh and try again.`
                );
              }
            });
          }
        }
      },
      `score:byGame:${slug}`
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
      },
      `game:bySlug:${slug}`
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
        { slug, currentQuestion: 1, maxQuestionReached: 1, scoringOpen: true },
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
      const nextQuestion = currentQuestion + 1;
      await client.models.Game.update(
        {
          slug,
          currentQuestion: nextQuestion,
          maxQuestionReached: Math.max(nextQuestion, maxQuestionReached),
        },
        { authMode: 'userPool' }
      );
    } catch {
      setError('Failed to advance question.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePreviousQuestion() {
    if (currentQuestion === null || currentQuestion <= 1) return;
    setBusy(true);
    setError(null);
    try {
      await client.models.Game.update(
        { slug, currentQuestion: currentQuestion - 1 },
        { authMode: 'userPool' }
      );
    } catch {
      setError('Failed to go to previous question.');
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
      // Delete all scores for this game with bounded concurrency + retry so
      // a large game can't trip AppSync / DynamoDB throttling and silently
      // leave orphaned score rows.
      const allScores = await listAll((opts) =>
        client.models.Score.list({ ...opts, filter: { gameId: { eq: slug } } })
      );
      const failures: string[] = [];
      await mapWithConcurrency(allScores, RESET_DELETE_CONCURRENCY, async (s) => {
        try {
          await withRetry(async () => {
            const { errors } = await client.models.Score.delete(
              { id: s.id },
              { authMode: 'userPool' }
            );
            if (errors && errors.length > 0) {
              throw new Error(errors[0].message);
            }
          });
        } catch (err) {
          failures.push(s.id);
          console.error(`Score deletion failed for ${s.id}:`, err);
        }
      });
      if (failures.length > 0) {
        setError(`Failed to reset ${failures.length} score(s). Please try again.`);
        return;
      }

      // Reset currentQuestion (keep the game, just reset progress)
      await client.models.Game.update(
        { slug, currentQuestion: 1, maxQuestionReached: 1, scoringOpen: true },
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
      if (!isValidPoints(points)) {
        setError('Invalid score value.');
        return;
      }
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
          const { errors } = await client.models.Score.update(
            { id, points },
            { authMode: 'userPool' }
          );
          if (errors?.length) throw new Error(errors[0].message);
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
            // Deterministic id already exists (race with another write) —
            // fall back to an update. This fallback's own errors must be
            // checked too, or a non-collision failure here would silently
            // leave the optimistic UI showing a score that was never saved.
            const fallback = await client.models.Score.update(
              { id, points },
              { authMode: 'userPool' }
            );
            if (fallback.errors?.length) throw new Error(fallback.errors[0].message);
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
    const groupLabel = (team: Team) =>
      team.groupType && team.groupType in GROUP_LABELS
        ? GROUP_LABELS[team.groupType as GroupType]
        : '';
    const csvLines = buildScoresCsv(sortedTeams, scoreMap, maxQuestionReached, groupLabel);
    downloadCsv(scoresCsvFilename(new Date()), csvLines);
  }, [maxQuestionReached, sortedTeams, scoreMap]);

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
                onClick={handlePreviousQuestion}
                disabled={busy || currentQuestion <= 1}
                className="rounded-md border border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
              >
                Previous Question
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
            maxQuestion={maxQuestionReached}
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
