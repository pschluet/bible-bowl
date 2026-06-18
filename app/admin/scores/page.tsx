'use client';

import { useCallback, useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';
import { GAME_STATE_ID } from '@/app/lib/constants';
import ScoreGrid from '@/app/components/ScoreGrid';

type Team = Schema['Team']['type'];
type Score = Schema['Score']['type'];

const client = generateClient<Schema>({ authMode: 'userPool' });

export default function AdminScoresPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [teamsRes, scoresRes, gameStateRes] = await Promise.all([
        client.models.Team.list(),
        client.models.Score.list(),
        client.models.GameState.get({ id: GAME_STATE_ID }),
      ]);
      setTeams(teamsRes.data);
      setScores(scoresRes.data);
      setCurrentQuestion(gameStateRes.data?.currentQuestion ?? null);
      setError(null);
    } catch {
      setError('Failed to load scores.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => clearInterval(interval);
  }, [load]);

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

  const handleScoreChange = useCallback(
    async (teamId: string, questionNumber: number, points: number, existingId: string | null) => {
      setError(null);
      try {
        if (existingId) {
          await client.models.Score.update({ id: existingId, points }, { authMode: 'userPool' });
        } else {
          await client.models.Score.create(
            { teamId, questionNumber, points },
            { authMode: 'userPool' }
          );
        }
        await load();
      } catch {
        setError('Failed to save score.');
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
        <div>
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
            <button
              type="button"
              onClick={handleNextQuestion}
              disabled={busy}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Next Question
            </button>
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
          teams={teams}
          scores={scores}
          currentQuestion={currentQuestion}
          onScoreChange={handleScoreChange}
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
