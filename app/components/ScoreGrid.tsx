'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function teamTotal(byQuestion: Map<number, Score> | undefined): number {
  if (!byQuestion) return 0;
  let total = 0;
  for (const score of byQuestion.values()) total += score.points;
  return total;
}

/**
 * Value-based equality for a team's score map. Amplify's observeQuery
 * re-delivers the FULL score list on every single write (see
 * app/lib/liveQuery.ts), so the parent page rebuilds a brand-new Map for
 * every team on every delta — even teams whose scores didn't change. A plain
 * reference-equality memo would therefore re-render every row on every
 * write. This walks one team's (small) map of scores instead, so ScoreRow
 * can skip re-rendering when nothing it displays actually changed.
 */
function byQuestionEqual(
  a: Map<number, Score> | undefined,
  b: Map<number, Score> | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  for (const [q, score] of a) {
    const other = b.get(q);
    if (!other || other.id !== score.id || other.points !== score.points) return false;
  }
  return true;
}

type ScoreRowProps = {
  team: Team;
  byQuestion: Map<number, Score> | undefined;
  total: number;
  questionNumbers: number[];
  currentQuestion: number | null;
  isSelected: boolean;
  editingQuestion: number | null;
  isFlashing: boolean;
  flashPoints: number | null;
  onSelect: (id: string) => void;
  onSelectNext: () => void;
  onSelectPrev: () => void;
  onEnterScore: (teamId: string, points: number) => void;
  onScoreDelete?: (existingId: string) => void;
  onEditCell: (teamId: string, q: number, anchorEl: HTMLElement) => void;
  registerRowRef: (teamId: string, el: HTMLTableRowElement | null) => void;
};

/**
 * One team's row in the score grid, memoized so a score change for team A
 * doesn't force React to re-render every other team's row too. Uses a custom
 * `arePropsEqual` (below) that compares `byQuestion` by value instead of by
 * reference, since the parent hands it a new Map object on every delta
 * regardless of whether this team's data changed.
 */
const ScoreRow = memo(function ScoreRow({
  team,
  byQuestion,
  total,
  questionNumbers,
  currentQuestion,
  isSelected,
  editingQuestion,
  isFlashing,
  flashPoints,
  onSelect,
  onSelectNext,
  onSelectPrev,
  onEnterScore,
  onScoreDelete,
  onEditCell,
  registerRowRef,
}: ScoreRowProps) {
  return (
    <tr
      tabIndex={0}
      ref={(el) => registerRowRef(team.id, el)}
      onFocus={() => onSelect(team.id)}
      onKeyDown={(e) => {
        if (currentQuestion !== null && ['0', '1', '2', '3'].includes(e.key)) {
          e.preventDefault();
          onEnterScore(team.id, Number(e.key));
        } else if (currentQuestion !== null && (e.key === 'x' || e.key === 'X') && onScoreDelete) {
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
        const isEditingThis = editingQuestion === q;
        const isCurrent = q === currentQuestion;
        // Selected row: bg-indigo-50; current-question column: bg-indigo-50;
        // intersection of both: bg-indigo-100 (slightly darker to distinguish both)
        const cellBg =
          isSelected && isCurrent ? 'bg-indigo-100' : isSelected || isCurrent ? 'bg-indigo-50' : '';
        return (
          <td key={q} className={`relative border border-gray-200 px-1 py-1 text-center ${cellBg}`}>
            {isFlashing && isCurrent ? (
              // Confirmation flash: show the just-entered value before advancing
              <span className="flex h-7 w-full items-center justify-center rounded bg-green-500 text-xs font-bold text-white">
                {flashPoints}
              </span>
            ) : (
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => onEditCell(team.id, q, e.currentTarget)}
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
        {total}
      </td>
    </tr>
  );
}, arePropsEqual);

function arePropsEqual(prev: ScoreRowProps, next: ScoreRowProps): boolean {
  return (
    prev.team === next.team &&
    prev.total === next.total &&
    prev.questionNumbers === next.questionNumbers &&
    prev.currentQuestion === next.currentQuestion &&
    prev.isSelected === next.isSelected &&
    prev.editingQuestion === next.editingQuestion &&
    prev.isFlashing === next.isFlashing &&
    prev.flashPoints === next.flashPoints &&
    prev.onSelect === next.onSelect &&
    prev.onSelectNext === next.onSelectNext &&
    prev.onSelectPrev === next.onSelectPrev &&
    prev.onEnterScore === next.onEnterScore &&
    prev.onScoreDelete === next.onScoreDelete &&
    prev.onEditCell === next.onEditCell &&
    prev.registerRowRef === next.registerRowRef &&
    byQuestionEqual(prev.byQuestion, next.byQuestion)
  );
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

  // Memoized so an unrelated re-render (e.g. `editing` state changing) doesn't
  // hand ScoreRow a new array reference and defeat its memoization.
  const questionCount = currentQuestion ?? 0;
  const questionNumbers = useMemo(
    () => Array.from({ length: questionCount }, (_, i) => i + 1),
    [questionCount]
  );

  const registerRowRef = useCallback((teamId: string, el: HTMLTableRowElement | null) => {
    if (el) rowRefs.current.set(teamId, el);
    else rowRefs.current.delete(teamId);
  }, []);

  const onEditCell = useCallback((teamId: string, q: number, anchorEl: HTMLElement) => {
    setEditing({ teamId, q, anchorEl });
  }, []);

  function handleSelect(teamId: string, questionNumber: number, points: number) {
    onScoreChange(teamId, questionNumber, points);
    setEditing(null);
  }

  const editingExisting =
    editing !== null ? (scoreMap.get(editing.teamId)?.get(editing.q) ?? null) : null;

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
            const isFlashing = recentEntry?.teamId === team.id;
            return (
              <ScoreRow
                key={team.id}
                team={team}
                byQuestion={byQuestion}
                total={teamTotal(byQuestion)}
                questionNumbers={questionNumbers}
                currentQuestion={currentQuestion}
                isSelected={team.id === selectedTeamId}
                editingQuestion={editing?.teamId === team.id ? editing.q : null}
                isFlashing={isFlashing}
                flashPoints={isFlashing ? (recentEntry?.points ?? null) : null}
                onSelect={onSelect}
                onSelectNext={onSelectNext}
                onSelectPrev={onSelectPrev}
                onEnterScore={onEnterScore}
                onScoreDelete={onScoreDelete}
                onEditCell={onEditCell}
                registerRowRef={registerRowRef}
              />
            );
          })}
        </tbody>
      </table>

      {editing !== null &&
        (() => {
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
