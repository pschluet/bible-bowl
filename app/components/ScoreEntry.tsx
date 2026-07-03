'use client';

import { useState } from 'react';
import type { Schema } from '@/amplify/data/resource';
import GroupPill from '@/app/components/GroupPill';
import ScoreButtonGrid from '@/app/components/ScoreButtonGrid';

type Team = Schema['Team']['type'];

type ScoreEntryProps = {
  team: Team;
  currentQuestion: number | null;
  existingScore: number | null;
};

export default function ScoreEntry({ team, currentQuestion, existingScore }: ScoreEntryProps) {
  const [submitting, setSubmitting] = useState(false);
  const [pendingPoints, setPendingPoints] = useState<number | null>(null);
  const [submittedScore, setSubmittedScore] = useState<number | null>(existingScore);
  const [prevExisting, setPrevExisting] = useState(existingScore);
  const [error, setError] = useState<string | null>(null);

  // Re-sync local optimistic state with the live prop so that an admin delete
  // (existingScore → null) returns the scorekeeper to the entry screen.
  // Uses the "adjust state during render" pattern to avoid a setState-in-effect error.
  if (existingScore !== prevExisting) {
    setPrevExisting(existingScore);
    setSubmittedScore(existingScore);
  }

  async function handleSelect(points: number) {
    if (currentQuestion === null || submittedScore !== null || submitting) {
      return;
    }
    setSubmitting(true);
    setPendingPoints(points);
    setError(null);
    try {
      const res = await fetch('/api/scorekeeper/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: team.id, questionNumber: currentQuestion, points }),
      });
      const data = (await res.json()) as { error?: string };
      if (res.status === 409) {
        // A record already exists for this question (e.g. admin already scored it,
        // or a duplicate submit race). Treat it as already-scored.
        setError('This question has already been scored.');
      } else if (!res.ok) {
        setError(
          data.error === 'SCORING_CLOSED'
            ? 'Scoring is now closed.'
            : 'Could not submit score. Please try again.'
        );
      } else {
        setSubmittedScore(points);
      }
    } catch {
      setError('Could not submit score. Please try again.');
    } finally {
      setSubmitting(false);
      setPendingPoints(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Team header */}
      <div className="flex flex-col items-center gap-1 text-center">
        <h2 className="text-3xl font-bold text-gray-900">{team.name}</h2>
        <GroupPill groupType={team.groupType} />
      </div>

      {currentQuestion === null ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-600">
          Waiting for the game to start…
        </p>
      ) : (
        <>
          {/* Question label */}
          <p className="text-center text-xl font-semibold text-gray-700">
            Question {currentQuestion}
          </p>

          {submittedScore !== null ? (
            /* Confirmation card */
            <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center shadow-sm">
              <p className="font-bold text-green-700" style={{ fontSize: '3.75rem' }}>
                {submittedScore}
              </p>
              <p className="mt-2 text-xl font-semibold text-green-700">Score submitted ✓</p>
              <p className="mt-1 text-base text-gray-500">Recorded for Q{currentQuestion}</p>
            </div>
          ) : (
            <ScoreButtonGrid
              onSelect={handleSelect}
              disabled={submitting}
              pendingValue={pendingPoints}
            />
          )}

          {error && <p className="text-center text-sm text-red-600">{error}</p>}
        </>
      )}
    </div>
  );
}
