'use client';

import { useEffect, useRef, useState } from 'react';
import type { Schema } from '@/amplify/data/resource';
import GroupPill from '@/app/components/GroupPill';
import { POINT_OPTIONS } from '@/app/lib/constants';

type Team = Schema['Team']['type'];
type Score = Schema['Score']['type'];

interface ScoreGridProps {
  teams: Team[]; // already sorted
  scoreMap: Map<string, Map<number, Score>>;
  currentQuestion: number | null;
  onScoreChange: (
    teamId: string,
    questionNumber: number,
    points: number,
    existingId: string | null
  ) => void;
  onScoreDelete?: (existingId: string) => void;
  selectedTeamId: string | null;
  onSelect: (id: string) => void;
  onSelectNext: () => void;
  onSelectPrev: () => void;
  onEnterScore: (teamId: string, points: number) => void;
  recentEntry: { teamId: string; points: number } | null;
}

export default function ScoreGrid({
  teams,
  scoreMap,
  currentQuestion,
  onScoreChange,
  onScoreDelete,
  selectedTeamId,
  onSelect,
  onSelectNext,
  onSelectPrev,
  onEnterScore,
  recentEntry,
}: ScoreGridProps) {
  // editing cell key: `${teamId}:${questionNumber}` or null (mouse click-to-edit flow)
  const [editing, setEditing] = useState<string | null>(null);

  // Refs to each <tr> so we can programmatically focus after arrow-key / number-key advances
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  // Focus the selected row when selection changes programmatically (not via Tab/click)
  useEffect(() => {
    if (!selectedTeamId) return;
    const el = rowRefs.current.get(selectedTeamId);
    // Skip if this element is already focused — avoids fighting the browser's natural Tab behavior
    if (el && document.activeElement !== el) {
      el.focus({ preventScroll: false });
    }
  }, [selectedTeamId]);

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

  if (teams.length === 0) {
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
          {teams.map((team) => {
            const byQuestion = scoreMap.get(team.id);
            const isSelected = team.id === selectedTeamId;
            return (
              <tr
                key={team.id}
                tabIndex={0}
                ref={(el) => {
                  if (el) rowRefs.current.set(team.id, el);
                  else rowRefs.current.delete(team.id);
                }}
                onFocus={() => onSelect(team.id)}
                onKeyDown={(e) => {
                  if (currentQuestion !== null && ['0', '1', '2', '3'].includes(e.key)) {
                    e.preventDefault();
                    onEnterScore(team.id, Number(e.key));
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    onSelectNext();
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    onSelectPrev();
                  }
                }}
                // outline-none removes the default browser focus ring on <tr>;
                // selection is communicated via background color + left border accent instead.
                className="outline-none"
              >
                {/* Sticky name cell — left accent bar when selected */}
                <td
                  className={`sticky left-0 z-10 border border-gray-200 px-3 py-2 font-medium text-gray-900 ${
                    isSelected
                      ? 'border-l-4 border-l-indigo-500 bg-indigo-50'
                      : 'bg-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{team.name}</span>
                    <GroupPill groupType={team.groupType} />
                  </div>
                </td>

                {questionNumbers.map((q) => {
                  const existing = byQuestion?.get(q) ?? null;
                  const cellKey = `${team.id}:${q}`;
                  const isEditing = editing === cellKey;
                  const isCurrent = q === currentQuestion;
                  const isFlashing =
                    isCurrent &&
                    recentEntry?.teamId === team.id;
                  // Selected row: bg-indigo-50; current-question column: bg-indigo-50;
                  // intersection of both: bg-indigo-100 (slightly darker to distinguish both)
                  const cellBg =
                    isSelected && isCurrent
                      ? 'bg-indigo-100'
                      : isSelected || isCurrent
                        ? 'bg-indigo-50'
                        : '';
                  return (
                    <td
                      key={q}
                      className={`relative border border-gray-200 px-1 py-1 text-center ${cellBg}`}
                    >
                      {isFlashing ? (
                        // Confirmation flash: show the just-entered value before advancing
                        <span className="flex h-7 w-full items-center justify-center rounded bg-green-500 text-xs font-bold text-white">
                          {recentEntry!.points}
                        </span>
                      ) : isEditing ? (
                        <div className="flex items-center justify-center gap-0.5">
                          {POINT_OPTIONS.map((pts) => (
                            <button
                              key={pts}
                              type="button"
                              tabIndex={-1}
                              onClick={() =>
                                handleSelect(team.id, q, pts, existing ? existing.id : null)
                              }
                              className="h-7 w-7 rounded bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700"
                            >
                              {pts}
                            </button>
                          ))}
                          {existing && onScoreDelete && (
                            <button
                              type="button"
                              tabIndex={-1}
                              onClick={() => {
                                onScoreDelete(existing.id);
                                setEditing(null);
                              }}
                              className="h-7 w-7 rounded bg-gray-300 text-xs font-semibold text-gray-700 hover:bg-red-500 hover:text-white"
                              title="Clear score"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setEditing(cellKey)}
                          className="h-7 w-full rounded text-gray-900 hover:bg-gray-100"
                        >
                          {existing ? existing.points : '–'}
                        </button>
                      )}
                    </td>
                  );
                })}

                <td
                  className={`border border-gray-200 px-3 py-2 text-center font-bold tabular-nums text-gray-900 ${
                    isSelected ? 'bg-indigo-50' : ''
                  }`}
                >
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
