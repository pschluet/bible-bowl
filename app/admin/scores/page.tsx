'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';
import { GAME_STATE_ID, compareTeamOrder, listAll, scoreId } from '@/app/lib/constants';
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
    if (!arr) { arr = []; byKey.set(k, arr); }
    arr.push(s);
  }
  for (const recs of byKey.values()) {
    if (recs.length < 2) continue;
    // keep the latest, delete the rest
    const sorted = [...recs].sort(
      (a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
    );
    sorted.slice(1).forEach((s) => {
      void client.models.Score.delete({ id: s.id }, { authMode: 'userPool' });
    });
  }
}

export default function AdminScoresPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [recentEntry, setRecentEntry] = useState<{ teamId: string; points: number } | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keeps a stable ref to scoreMap so optimistic saveScore can read it without deps
  const scoreMapRef = useRef<Map<string, Map<number, Score>>>(new Map());
  // Timestamp of the last entry — used to suppress the background poll while typing
  const lastEntryRef = useRef<number>(0);

  // Clear the advance timer on unmount to avoid setState on an unmounted component
  useEffect(() => () => {
    if (advanceTimerRef.current !== null) clearTimeout(advanceTimerRef.current);
  }, []);

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
  useEffect(() => { scoreMapRef.current = scoreMap; }, [scoreMap]);

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

  const load = useCallback(async () => {
    try {
      const [teamsAll, scoresAll, gameStateRes] = await Promise.all([
        listAll((o) => client.models.Team.list(o)),
        listAll((o) => client.models.Score.list(o)),
        client.models.GameState.get({ id: GAME_STATE_ID }),
      ]);
      setTeams(teamsAll);
      setScores(scoresAll);
      setCurrentQuestion(gameStateRes.data?.currentQuestion ?? null);
      setError(null);
      healDuplicates(scoresAll); // fire-and-forget background cleanup
    } catch {
      setError('Failed to load scores.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Poll every 5 s, but skip the full read while the admin is actively entering
    // scores (last entry < 6 s ago) to prevent server reads from clobbering fresh
    // optimistic values. The poll resumes once they pause.
    const interval = setInterval(() => {
      if (Date.now() - lastEntryRef.current > 6000) void load();
    }, 5000);
    return () => clearInterval(interval);
  }, [load]);

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
        { id: GAME_STATE_ID, currentQuestion: 1 },
        { authMode: 'userPool' }
      );
      await load();
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
      await load();
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
        const page = await client.models.Score.list(
          nextToken ? { nextToken } : undefined
        );
        await Promise.all(
          page.data.map((s) => client.models.Score.delete({ id: s.id }, { authMode: 'userPool' }))
        );
        nextToken = page.nextToken;
      } while (nextToken);

      // Delete the GameState singleton → returns to "not started".
      if (currentQuestion !== null) {
        await client.models.GameState.delete({ id: GAME_STATE_ID }, { authMode: 'userPool' });
      }
      await load();
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

      // Apply optimistically to local state so the grid updates instantly
      setScores((cur) => {
        const next = cur.filter((s) => s.id !== id);
        // Spread existing to preserve any Amplify-generated fields we don't touch
        next.push({ ...(existing ?? {}), id, teamId, questionNumber, points, updatedAt: now } as Score);
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
        // Roll back optimistic entry on network failure
        setScores((cur) => {
          const next = cur.filter((s) => s.id !== id);
          if (existing) next.push(existing);
          return next;
        });
      }
    },
    [] // no deps needed — reads scoreMapRef (stable ref) and writes via setScores updater fn
  );

  // Shared entry helper used by keyboard shortcuts (grid) and quick-entry drawer:
  // saves the score, shows a brief confirmation flash, then advances to the next team.
  const enterScoreAndAdvance = useCallback(
    (teamId: string, points: number) => {
      if (currentQuestion === null) return;
      lastEntryRef.current = Date.now(); // suppress background poll while entering
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
    [currentQuestion, saveScore, selectNext] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleScoreDelete = useCallback(
    async (existingId: string) => {
      setError(null);
      try {
        await client.models.Score.delete({ id: existingId }, { authMode: 'userPool' });
        await load();
      } catch {
        setError('Failed to clear score.');
      }
    },
    [load]
  );

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
          Delete all scores and reset the game to &ldquo;not started&rdquo;. Teams and
          scorekeeper assignments are kept.
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
