'use client';

import { POINT_OPTIONS } from '@/app/lib/constants';

type ScoreButtonGridProps = {
  onSelect: (points: number) => void;
  /** Disable all buttons (e.g. while a submission is in flight). */
  disabled?: boolean;
  /**
   * The point value currently being persisted — this button shows an inline
   * spinner instead of its number and stays indigo-filled. Use when the select
   * triggers an async operation (scorekeeper page).
   */
  pendingValue?: number | null;
  /**
   * The point value to highlight as "just entered" without a spinner — solid
   * indigo fill. Use for optimistic/instant feedback (admin quick entry).
   */
  activeValue?: number | null;
};

export default function ScoreButtonGrid({
  onSelect,
  disabled = false,
  pendingValue = null,
  activeValue = null,
}: ScoreButtonGridProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {POINT_OPTIONS.map((points) => {
        const isPending = points === pendingValue;
        const isActive = !isPending && points === activeValue;
        const isDimmed = disabled && !isPending && !isActive;

        return (
          <button
            key={points}
            type="button"
            aria-disabled={disabled}
            aria-busy={isPending}
            onClick={() => { if (!disabled) onSelect(points); }}
            className={[
              'flex aspect-square items-center justify-center rounded-2xl border-2 font-bold shadow-sm transition-all',
              isPending || isActive
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:border-indigo-500 hover:bg-indigo-50 active:scale-95 active:border-indigo-600 active:bg-indigo-600 active:text-white',
              isDimmed ? 'cursor-not-allowed opacity-40' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ minHeight: 120, fontSize: '3.75rem' }}
          >
            {isPending ? (
              <span
                className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-white"
                aria-hidden="true"
              />
            ) : (
              points
            )}
          </button>
        );
      })}
    </div>
  );
}
