'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { POINT_OPTIONS } from '@/app/lib/constants';
import { computePopoverPosition } from '@/app/lib/ui';
import GroupPill from '@/app/components/GroupPill';

interface ScoreEditPopoverProps {
  anchorEl: HTMLElement;
  teamName: string;
  groupType?: string | null;
  questionNumber: number;
  existingPoints: number | null;
  onSelect: (points: number) => void;
  onClear: () => void;
  onClose: () => void;
}

const VIEWPORT_PAD = 8;

export default function ScoreEditPopover({
  anchorEl,
  teamName,
  groupType,
  questionNumber,
  existingPoints,
  onSelect,
  onClear,
  onClose,
}: ScoreEditPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    visibility: 'hidden',
    position: 'fixed',
  });
  const rafRef = useRef<number | null>(null);

  const reposition = useCallback(() => {
    const el = panelRef.current;
    if (!el) return;
    const panelRect = el.getBoundingClientRect();
    const anchor = anchorEl.getBoundingClientRect();
    const { top, left } = computePopoverPosition({
      panel: { width: panelRect.width, height: panelRect.height },
      anchor,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pad: VIEWPORT_PAD,
    });
    setStyle({ position: 'fixed', top, left, visibility: 'visible' });
  }, [anchorEl]);

  // Position on mount, then re-position after one rAF so the measurement runs after any
  // focus-induced scroll that the click triggers (ScoreGrid's selectedTeamId effect scrolls
  // the overflow-x-auto container, moving the anchor cell before we can read its live rect).
  useLayoutEffect(() => {
    reposition();
    rafRef.current = requestAnimationFrame(reposition);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [reposition]);

  // Stay glued to the anchor cell while the grid scrolls — reposition rather than close
  useEffect(() => {
    function onScrollOrResize() {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(reposition);
    }
    window.addEventListener('scroll', onScrollOrResize, true); // capture catches inner scrollers
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [reposition]);

  // Dismiss on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const content = (
    <>
      {/* Backdrop — transparent, full-screen, click to dismiss */}
      <div className="fixed inset-0 z-40" aria-hidden="true" onClick={onClose} />

      {/* Panel — fixed width so overflow math is predictable */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit score for ${teamName}, question ${questionNumber}`}
        style={style}
        className="z-50 flex w-64 flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-2xl"
      >
        {/* Header */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-semibold leading-snug text-gray-900">{teamName}</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 text-lg leading-none text-gray-400 hover:text-gray-700"
            >
              ×
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <GroupPill groupType={groupType} />
            <span className="text-sm text-gray-500">Q{questionNumber}</span>
          </div>
        </div>

        {/* Point buttons */}
        <div className="flex gap-1.5">
          {POINT_OPTIONS.map((pts) => {
            const isActive = pts === existingPoints;
            return (
              <button
                key={pts}
                type="button"
                onClick={() => onSelect(pts)}
                aria-pressed={isActive}
                className={[
                  'h-10 flex-1 rounded-lg text-sm font-bold transition-colors',
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
                    : 'border border-gray-300 bg-white text-gray-700 hover:border-indigo-400 hover:bg-indigo-50',
                ].join(' ')}
              >
                {pts}
              </button>
            );
          })}
        </div>

        {existingPoints !== null && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-gray-200 bg-gray-50 py-1 text-xs font-medium text-gray-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
          >
            Clear score
          </button>
        )}
      </div>
    </>
  );

  return createPortal(content, document.body);
}
