'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';
import { GAME_STATE_ID, compareTeamOrder, scoreId } from '@/app/lib/constants';
import { subscribeLive } from '@/app/lib/liveQuery';
import ScoreGrid from '@/app/components/ScoreGrid';
import QuickEntryDrawer from '@/app/components/QuickEntryDrawer';

type Team = Schema['Team']['type'];
type Score = Schema['Score']['type'];

const client = generateClient<Schema>({ authMode: 'userPool' });

/**
 * Fire-and-forget: after a full load we delete any duplicate Score records (same
 * teamId+questionNumber), keeping the one with the latest updatedAt. The scoreMap
 * memo already hides duplicates in the UI; this cleans them from the DB over time.
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
    // keep the latest, delete the rest
    const sorted = [...recs].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    sorted.slice(1).forEach((s) => {
      void client.models.Score.delete({ id: s.id }, { authMode: 'userPool' });
    });
  }
}

export default function AdminScoresPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  // Separate sources for score state to avoid flicker when a concurrent
  // subscription event arrives before the server echo of an optimistic write.
  // streamedScores: authoritative collection from observeQuery
  // optimisticScores: pending local writes not yet confirmed by the stream
  const [streamedScores, setStreamedScores] = useState<Score[]>([]);
  const [optimisticScores, setOptimisticScores] = useState<Score[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<number | null>(null);
  // Gate loading on both streams completing their initial sync so the grid
  // paints fully populated (no dashes-then-fill as score pages arrive).
  const [teamsSynced, setTeamsSynced] = useState(false);
  const [scoresSynced, setScoresSynced] = useState(false);
  const loading = !teamsSynced || !scoresSynced;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [recentEntry, setRecentEntry] = useState<{ teamId: string; points: number } | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keeps a stable ref to scoreMap so optimistic saveScore can read it without deps
  const scoreMapRef = useRef<Map<string, Map<number, Score>>>(new Map());
  // Tracks whether healDuplicates has run for this session
  const healedRef = useRef(false);

  // Merged scores: stream + optimistic overlay (optimistic wins for same id if newer).
  // This preserves optimistic writes during the ~100–300 ms before the server echo
  // arrives, even if another subscription event fires in that window.
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

  // When the stream delivers a confirmed version of an optimistic entry, prune it
  // so the stream's authoritative value fully takes over.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOptimisticScores((prev) => {
      if (prev.length === 0) return prev;
      const streamMap = new Map(streamedScores.map((s) => [s.id, s]));
      const next = prev.filter((opt) => {
        const s = streamMap.get(opt.id);
        // Keep optimistic entry if stream doesn't have it yet or ours is still newer
        return !s || (opt.updatedAt ?? '') > (s.updatedAt ?? '');
      });
      return next.length === prev.length ? prev : next; // skip re-render if nothing changed
    });
  }, [streamedScores]);

  // Clear the advance timer on unmount to avoid setState on an unmounted component
  useEffect(
    () => () => {
      if (advanceTimerRef.current !== null) clearTimeout(advanceTimerRef.current);
    },
    []
  );

  // Sorted teams — single source of truth for order (used by both grid and drawer)
  const sortedTeams = useMemo(() => [...teams].sort(compareTeamOrder), [teams]);

  // Score lookup: teamId → (questionNumber → Score)
  // When duplicate records exist for the same (teamId, questionNumber), keep the
  // one with the latest updatedAt so the displayed value is deterministic.
  // Also keep a ref in sync so saveScore can read it without stale-closure issues.
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

  // Default selection to first team once the game is active
  useEffect(() => {
    if (currentQuestion !== null && sortedTeams.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedTeamId((prev) => {
        if (prev && sortedTeams.some((t) => t.id === prev)) return prev;
        return sortedTeams[0].id;
      });
    }
  }, [currentQuestion, sortedTeams]);

  // Team stream
  useEffect(() => {
    return subscribeLive(
      () => client.models.Team.observeQuery({ authMode: 'userPool' }),
      ({ items, isSynced }) => {
        setTeams(items);
        if (isSynced) setTeamsSynced(true);
      }
    );
  }, []);

  // Score stream — run healDuplicates once after the first full sync
  useEffect(() => {
    return subscribeLive(
      () => client.models.Score.observeQuery({ authMode: 'userPool' }),
      ({ items, isSynced }) => {
        setStreamedScores(items);
        if (isSynced) {
          setScoresSynced(true);
          if (!healedRef.current) {
            healedRef.current = true;
            healDuplicates(items); // fire-and-forget background DB cleanup
          }
        }
      }
    );
  }, []);

  // GameState stream
  useEffect(() => {
    return subscribeLive(
      () => client.models.GameState.observeQuery({ authMode: 'userPool' }),
      ({ items }) => {
        setCurrentQuestion(items[0]?.currentQuestion ?? null);
      }
    );
  }, []);

  // Selection helpers
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
      await client.models.GameState.create(
        { id: GAME_STATE_ID, currentQuestion: 1, scoringOpen: true },
        { authMode: 'userPool' }
      );
      // Stream delivers the new GameState — no reload needed
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
      await client.models.GameState.update(
        { id: GAME_STATE_ID, currentQuestion: currentQuestion + 1 },
        { authMode: 'userPool' }
      );
      // Stream delivers the update — no reload needed
    } catch {
      setError('Failed to advance question.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (
      !confirm(
        'Reset all scores and questions?\n\nEvery score will be permanently deleted and the game will return to "not started". Teams are kept.\n\nThis cannot be undone.'
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      // Amplify has no bulk delete — list all pages then delete each Score.
      let nextToken: string | null | undefined;
      do {
        const page = await client.models.Score.list(nextToken ? { nextToken } : undefined);
        await Promise.all(
          page.data.map((s) => client.models.Score.delete({ id: s.id }, { authMode: 'userPool' }))
        );
        nextToken = page.nextToken;
      } while (nextToken);

      // Delete the GameState singleton → returns to "not started".
      if (currentQuestion !== null) {
        await client.models.GameState.delete({ id: GAME_STATE_ID }, { authMode: 'userPool' });
      }
      // Clear any pending optimistic overrides so the grid resets immediately
      setOptimisticScores([]);
      // Streams deliver the individual deletes — no full reload needed
    } catch {
      setError('Failed to reset the game.');
    } finally {
      setBusy(false);
    }
  }

  // Optimistic upsert: update local state immediately, then fire exactly one network
  // write. No round-trip read, no full reload — makes ~2 entries/sec feel instant.
  // The scoreMap is authoritative (fully paginated) so we know the existing record.
  const saveScore = useCallback(
    async (teamId: string, questionNumber: number, points: number) => {
      setError(null);
      const existing = scoreMapRef.current.get(teamId)?.get(questionNumber) ?? null;
      const id = existing?.id ?? scoreId(teamId, questionNumber);
      const now = new Date().toISOString();

      // Apply optimistically: add to the overlay so the grid updates instantly.
      // The cleanup effect removes it once the stream delivers the confirmed echo.
      setOptimisticScores((prev) => {
        const next = prev.filter((s) => s.id !== id);
        // Spread existing to preserve any Amplify-generated fields we don't touch
        next.push({
          ...(existing ?? {}),
          id,
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
            { id, teamId, questionNumber, points },
            { authMode: 'userPool' }
          );
          if (errors?.length) {
            // Deterministic id already exists (concurrent race) — update instead
            await client.models.Score.update({ id, points }, { authMode: 'userPool' });
          }
        }
      } catch {
        setError('Failed to save score.');
        // Roll back: remove optimistic override; stream retains the old value
        setOptimisticScores((prev) => prev.filter((s) => s.id !== id));
      }
    },
    [] // no deps needed — reads scoreMapRef (stable ref) and writes via stable setters
  );

  // Shared entry helper used by keyboard shortcuts (grid) and quick-entry drawer:
  // saves the score, shows a brief confirmation flash, then advances to the next team.
  const enterScoreAndAdvance = useCallback(
    (teamId: string, points: number) => {
      if (currentQuestion === null) return;
      void saveScore(teamId, currentQuestion, points);
      // Flash confirmation for ~450 ms before advancing
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
      // Stream delivers the delete — no reload needed
    } catch {
      setError('Failed to clear score.');
    }
  }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Scores</h1>
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
      )}

      {quickEntryOpen && (
        <QuickEntryDrawer
          sortedTeams={sortedTeams}
          scoreMap={scoreMap}
          currentQuestion={currentQuestion}
          selectedTeamId={selectedTeamId}
          onSelect={selectTeam}
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
          className="mt-3 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          Reset Scores &amp; Questions
        </button>
      </div>
    </div>
  );
}
