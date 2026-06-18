'use client';

import { useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';
import GroupPill from '@/app/components/GroupPill';

type Team = Schema['Team']['type'];

type ScoreEntryProps = {
  team: Team;
  currentQuestion: number | null;
  existingScore: number | null;
  scoreId: string | null;
};

const client = generateClient<Schema>({ authMode: 'userPool' });
const OPTIONS = [0, 1, 2, 3];

export default function ScoreEntry({
  team,
  currentQuestion,
  existingScore,
  scoreId,
}: ScoreEntryProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submittedScore, setSubmittedScore] = useState<number | null>(existingScore);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(points: number) {
    if (currentQuestion === null || submittedScore !== null || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { errors } = await client.models.Score.create({
        teamId: team.id,
        questionNumber: currentQuestion,
        points,
      });
      if (errors && errors.length > 0) {
        setError('Could not submit score. Please try again.');
      } else {
        setSubmittedScore(points);
      }
    } catch {
      setError('Could not submit score. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const locked = scoreId !== null && existingScore !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <h2 className="text-2xl font-bold text-gray-900">{team.name}</h2>
        <GroupPill groupType={team.groupType} />
      </div>

      {currentQuestion === null ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-600">
          Waiting for the game to start…
        </p>
      ) : (
        <>
          <p className="text-center text-lg font-medium text-gray-700">
            Question {currentQuestion}
          </p>

          {locked ? (
            <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-700">
              You scored <span className="font-bold text-indigo-700">{existingScore}</span> for this
              question
            </p>
          ) : submittedScore !== null ? (
            <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
              <p className="text-lg font-semibold text-green-700">Score submitted ✓</p>
              <p className="mt-1 text-gray-700">
                You scored <span className="font-bold">{submittedScore}</span> for Q
                {currentQuestion}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {OPTIONS.map((points) => (
                <button
                  key={points}
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSelect(points)}
                  className="flex aspect-square items-center justify-center rounded-xl border-2 border-gray-300 text-3xl font-bold text-gray-700 transition-colors hover:border-indigo-500 hover:bg-indigo-50 active:bg-indigo-600 active:text-white disabled:opacity-50"
                  style={{ minHeight: 80 }}
                >
                  {points}
                </button>
              ))}
            </div>
          )}

          {error && <p className="text-center text-sm text-red-600">{error}</p>}
        </>
      )}
    </div>
  );
}
