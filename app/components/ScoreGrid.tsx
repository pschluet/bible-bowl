'use client';

import { useState } from 'react';
import type { Schema } from '@/amplify/data/resource';

type Team = Schema['Team']['type'];
type Score = Schema['Score']['type'];

interface ScoreGridProps {
  teams: Team[];
  scores: Score[];
  currentQuestion: number | null;
  onScoreChange: (
    teamId: string,
    questionNumber: number,
    points: number,
    existingId: string | null
  ) => void;
}

const POINT_OPTIONS = [0, 1, 2, 3] as const;

export default function ScoreGrid({
  teams,
  scores,
  currentQuestion,
  onScoreChange,
}: ScoreGridProps) {
  // editing cell key: `${teamId}:${questionNumber}` or null
  const [editing, setEditing] = useState<string | null>(null);

  // Build a lookup: teamId -> (questionNumber -> Score)
  const scoreMap = new Map<string, Map<number, Score>>();
  for (const score of scores) {
    let byQuestion = scoreMap.get(score.teamId);
    if (!byQuestion) {
      byQuestion = new Map<number, Score>();
      scoreMap.set(score.teamId, byQuestion);
    }
    byQuestion.set(score.questionNumber, score);
  }

  const sortedTeams = [...teams].sort((a, b) => a.name.localeCompare(b.name));
  const questionCount = currentQuestion ?? 0;
  const questionNumbers = Array.from({ length: questionCount }, (_, i) => i + 1);

  function teamTotal(teamId: string): number {
    const byQuestion = scoreMap.get(teamId);
    if (!byQuestion) return 0;
    let total = 0;
    for (const score of byQuestion.values()) total += score.points;
    return total;
  }

  function handleSelect(
    teamId: string,
    questionNumber: number,
    points: number,
    existingId: string | null
  ) {
    onScoreChange(teamId, questionNumber, points, existingId);
    setEditing(null);
  }

  if (sortedTeams.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
        No teams yet. Add teams to start scoring.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-100 font-semibold">
            <th className="sticky left-0 z-10 border border-gray-200 bg-gray-100 px-3 py-2 text-left">
              Team
            </th>
            {questionNumbers.map((q) => (
              <th
                key={q}
                className={`border border-gray-200 px-3 py-2 text-center ${
                  q === currentQuestion ? 'bg-indigo-100 text-indigo-700' : ''
                }`}
              >
                Q{q}
              </th>
            ))}
            <th className="border border-gray-200 bg-gray-100 px-3 py-2 text-center">Total</th>
          </tr>
        </thead>
        <tbody>
          {sortedTeams.map((team) => {
            const byQuestion = scoreMap.get(team.id);
            return (
              <tr key={team.id}>
                <td className="sticky left-0 z-10 border border-gray-200 bg-white px-3 py-2 font-medium text-gray-900">
                  {team.name}
                </td>
                {questionNumbers.map((q) => {
                  const existing = byQuestion?.get(q) ?? null;
                  const cellKey = `${team.id}:${q}`;
                  const isEditing = editing === cellKey;
                  const isCurrent = q === currentQuestion;
                  return (
                    <td
                      key={q}
                      className={`relative border border-gray-200 px-1 py-1 text-center ${
                        isCurrent ? 'bg-indigo-50' : ''
                      }`}
                    >
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-0.5">
                          {POINT_OPTIONS.map((pts) => (
                            <button
                              key={pts}
                              type="button"
                              onClick={() =>
                                handleSelect(team.id, q, pts, existing ? existing.id : null)
                              }
                              className="h-7 w-7 rounded bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700"
                            >
                              {pts}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditing(cellKey)}
                          className="h-7 w-full rounded text-gray-900 hover:bg-gray-100"
                        >
                          {existing ? existing.points : '–'}
                        </button>
                      )}
                    </td>
                  );
                })}
                <td className="border border-gray-200 px-3 py-2 text-center font-bold tabular-nums text-gray-900">
                  {teamTotal(team.id)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
