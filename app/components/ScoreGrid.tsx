'use client';

import { useEffect, useRef, useState } from 'react';
import type { Schema } from '@/amplify/data/resource';
import GroupPill from '@/app/components/GroupPill';
import ScoreEditPopover from '@/app/components/ScoreEditPopover';

type Team = Schema['Team']['type'];
type Score = Schema['Score']['type'];

interface ScoreGridProps {
  teams: Team[]; // already sorted
  scoreMap: Map<string, Map<number, Score>>;
  currentQuestion: number | null;
  onScoreChange: (teamId: string, questionNumber: number, points: number) => void;
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
  // editing state: the clicked cell plus the anchor element (read live, not frozen DOMRect)
  const [editing, setEditing] = useState<{
    teamId: string;
    q: number;
    anchorEl: HTMLElement;
  } | null>(null);

  // Refs to each <tr> so we can programmatically focus after arrow-key / number-key advances
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  // Tracks whether we've done the one-shot auto-focus on mount; reset when game is inactive
  const didInitialFocusRef = useRef(false);

  // One-shot auto-focus: when the game becomes active, focus the selected (first) team row
  // immediately so the scorekeeper can start pressing 0–3 without clicking or tabbing first.
  // Uses preventScroll:true to avoid jarring page jumps. The ref guard ensures we only steal
  // focus once per active-game session and not again after the user has clicked/tabbed away.
  useEffect(() => {
    if (currentQuestion === null) {
      didInitialFocusRef.current = false; // reset when game is torn down
      return;
    }
    if (didInitialFocusRef.current) return;
    const targetId = selectedTeamId ?? teams[0]?.id;
    if (!targetId) return;
    const el = rowRefs.current.get(targetId);
    if (el) {
      didInitialFocusRef.current = true;
      el.focus({ preventScroll: true });
    }
  }, [currentQuestion, selectedTeamId, teams]);

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

  function handleSelect(teamId: string, questionNumber: number, points: number) {
    onScoreChange(teamId, questionNumber, points);
    setEditing(null);
  }

  const editingExisting =
    editing !== null
      ? (scoreMap.get(editing.teamId)?.get(editing.q) ?? null)
      : null;

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
                  } else if (
                    currentQuestion !== null &&
                    (e.key === 'x' || e.key === 'X') &&
                    onScoreDelete
                  ) {
                    const existing = byQuestion?.get(currentQuestion);
                    if (existing) {
                      e.preventDefault();
                      onScoreDelete(existing.id);
                      onSelectNext();
                    }
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
                    isSelected ? 'border-l-4 border-l-indigo-500 bg-indigo-50' : 'bg-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{team.name}</span>
                    <GroupPill groupType={team.groupType} />
                  </div>
                </td>

                {questionNumbers.map((q) => {
                  const existing = byQuestion?.get(q) ?? null;
                  const isEditingThis = editing?.teamId === team.id && editing?.q === q;
                  const isCurrent = q === currentQuestion;
                  const isFlashing = isCurrent && recentEntry?.teamId === team.id;
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
                      ) : (
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={(e) =>
                            setEditing({ teamId: team.id, q, anchorEl: e.currentTarget })
                          }
                          className={[
                            'h-7 w-full rounded text-gray-900 hover:bg-gray-100',
                            isEditingThis ? 'ring-2 ring-indigo-400 ring-offset-1' : '',
                          ].join(' ')}
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

      {editing !== null && (() => {
        const editTeam = teams.find((t) => t.id === editing.teamId);
        if (!editTeam) return null;
        return (
          <ScoreEditPopover
            anchorEl={editing.anchorEl}
            teamName={editTeam.name}
            groupType={editTeam.groupType}
            questionNumber={editing.q}
            existingPoints={editingExisting?.points ?? null}
            onSelect={(pts) => handleSelect(editing.teamId, editing.q, pts)}
            onClear={() => {
              if (editingExisting && onScoreDelete) onScoreDelete(editingExisting.id);
              setEditing(null);
            }}
            onClose={() => setEditing(null)}
          />
        );
      })()}
    </div>
  );
}
