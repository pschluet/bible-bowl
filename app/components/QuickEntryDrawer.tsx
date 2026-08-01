'use client';

import { useEffect, useRef } from 'react';
import type { Schema } from '@/amplify/data/resource';
import { swipeDirection } from '@/app/lib/ui';
import GroupPill from '@/app/components/GroupPill';
import ScoreButtonGrid from '@/app/components/ScoreButtonGrid';

type Team = Schema['Team']['type'];
type Score = Schema['Score']['type'];

interface QuickEntryDrawerProps {
  sortedTeams: Team[];
  scoreMap: Map<string, Map<number, Score>>;
  currentQuestion: number | null;
  selectedTeamId: string | null;
  onSelectNext: () => void;
  onSelectPrev: () => void;
  onEnterScore: (teamId: string, points: number) => void;
  onClose: () => void;
  recentEntry: { teamId: string; points: number } | null;
}

export default function QuickEntryDrawer({
  sortedTeams,
  scoreMap,
  currentQuestion,
  selectedTeamId,
  onSelectNext,
  onSelectPrev,
  onEnterScore,
  onClose,
  recentEntry,
}: QuickEntryDrawerProps) {
  const touchStartX = useRef<number | null>(null);

  // Keyboard navigation while the drawer is open
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onSelectNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onSelectPrev();
      } else if (
        ['0', '1', '2', '3'].includes(e.key) &&
        selectedTeamId &&
        currentQuestion !== null
      ) {
        e.preventDefault();
        onEnterScore(selectedTeamId, Number(e.key));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onSelectNext, onSelectPrev, onEnterScore, selectedTeamId, currentQuestion]);

  const selectedIdx = sortedTeams.findIndex((t) => t.id === selectedTeamId);
  const selectedTeam = selectedIdx >= 0 ? sortedTeams[selectedIdx] : null;
  const prevTeam = selectedIdx > 0 ? sortedTeams[selectedIdx - 1] : null;
  const nextTeam =
    selectedIdx >= 0 && selectedIdx < sortedTeams.length - 1 ? sortedTeams[selectedIdx + 1] : null;

  const existingScore =
    selectedTeam && currentQuestion !== null
      ? (scoreMap.get(selectedTeam.id)?.get(currentQuestion) ?? null)
      : null;

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    const direction = swipeDirection(delta);
    if (direction === 'next')
      onSelectNext(); // swipe left → next church
    else if (direction === 'prev') onSelectPrev(); // swipe right → previous church
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Quick Score Entry"
    >
      {/* Backdrop — click to close */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />

      {/* Drawer panel */}
      <div
        className="relative mx-auto flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl bg-white"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">
            Quick Entry{currentQuestion !== null ? ` — Q${currentQuestion}` : ''}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quick entry"
            className="text-2xl leading-none text-gray-400 hover:text-gray-700"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-8 pt-6">
          {/* Prev / current / next row */}
          <div className="mb-8 flex items-stretch gap-3">
            {/* Previous church */}
            <div className="flex w-1/4 flex-col justify-center">
              {prevTeam ? (
                <button
                  type="button"
                  onClick={onSelectPrev}
                  className="flex flex-col items-center gap-1 rounded-xl p-2 text-center opacity-40 transition-opacity hover:bg-gray-50 hover:opacity-70"
                >
                  <span className="text-xs text-gray-500">← Prev</span>
                  <span className="break-words text-sm font-medium text-gray-700">
                    {prevTeam.name}
                  </span>
                </button>
              ) : (
                <div className="w-full" aria-hidden />
              )}
            </div>

            {/* Current church — prominent center */}
            <div className="flex flex-1 flex-col items-center gap-2 text-center">
              {selectedTeam ? (
                <>
                  <h3 className="break-words text-2xl font-bold text-gray-900">
                    {selectedTeam.name}
                  </h3>
                  <GroupPill groupType={selectedTeam.groupType} />
                  {existingScore !== null && (
                    <span className="rounded-full bg-indigo-100 px-3 py-0.5 text-sm font-semibold text-indigo-700">
                      Scored: {existingScore.points}
                    </span>
                  )}
                </>
              ) : (
                <p className="text-gray-500">No team selected</p>
              )}
            </div>

            {/* Next church */}
            <div className="flex w-1/4 flex-col justify-center">
              {nextTeam ? (
                <button
                  type="button"
                  onClick={onSelectNext}
                  className="flex flex-col items-center gap-1 rounded-xl p-2 text-center opacity-40 transition-opacity hover:bg-gray-50 hover:opacity-70"
                >
                  <span className="text-xs text-gray-500">Next →</span>
                  <span className="break-words text-sm font-medium text-gray-700">
                    {nextTeam.name}
                  </span>
                </button>
              ) : (
                <div className="w-full" aria-hidden />
              )}
            </div>
          </div>

          {/* Big score buttons (0 – 3) */}
          {selectedTeam && currentQuestion !== null ? (
            <ScoreButtonGrid
              onSelect={(pts) => onEnterScore(selectedTeam.id, pts)}
              activeValue={recentEntry?.teamId === selectedTeam.id ? recentEntry.points : null}
            />
          ) : (
            <p className="text-center text-gray-500">
              {currentQuestion === null ? 'Game not started.' : 'No team selected.'}
            </p>
          )}

          {/* Progress indicator */}
          {sortedTeams.length > 0 && selectedIdx >= 0 && (
            <p className="mt-6 text-center text-xs text-gray-400">
              {selectedIdx + 1} / {sortedTeams.length}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
