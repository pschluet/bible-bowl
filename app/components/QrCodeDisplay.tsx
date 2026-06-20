'use client';

/**
 * Full-screen QR code carousel for admins to display per-team onboarding QR
 * codes on their phone or laptop screen so scorekeepers can scan them directly.
 *
 * Shows one large, scannable QR at a time with team name + group type badge,
 * a position counter ("3 / 30"), and Prev / Next navigation.
 */

import { useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import GroupPill from '@/app/components/GroupPill';

export interface QrToken {
  tokenId: string;
  teamId: string;
  teamName: string;
  groupType: string | null;
  status: 'UNUSED' | 'CONSUMED';
}

interface Props {
  tokens: QrToken[];
  initialIndex?: number;
  onClose: () => void;
}

export default function QrCodeDisplay({ tokens, initialIndex = 0, onClose }: Props) {
  const [index, setIndex] = useState(
    Math.min(Math.max(0, initialIndex), tokens.length - 1)
  );

  const token = tokens[index];

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
        setIndex((i) => Math.min(i + 1, tokens.length - 1));
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
        setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, tokens.length]);

  if (!token) return null;

  const deepLink = `${window.location.origin}/scan?token=${token.tokenId}`;

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      {/* Card — stop propagation so clicks inside don't close the overlay */}
      <div
        className="relative flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl bg-white px-6 py-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          ✕
        </button>

        {/* Counter */}
        <p className="text-xs font-medium text-gray-400">
          {index + 1} / {tokens.length}
        </p>

        {/* Team identity */}
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-lg font-bold text-gray-900">{token.teamName}</p>
          <div className="flex items-center gap-1.5">
            {token.groupType && <GroupPill groupType={token.groupType} />}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                token.status === 'UNUSED'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {token.status === 'UNUSED' ? 'Available' : 'Used'}
            </span>
          </div>
        </div>

        {/* QR code */}
        <div className="rounded-xl border border-gray-100 p-3 shadow-inner">
          <QRCodeCanvas
            value={deepLink}
            size={240}
            level="M"
            marginSize={1}
          />
        </div>

        <p className="max-w-[240px] break-all text-center font-mono text-[10px] text-gray-300">
          {deepLink}
        </p>

        {/* Navigation */}
        <div className="flex w-full items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(i - 1, 0))}
            disabled={index === 0}
            className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Prev
          </button>
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(i + 1, tokens.length - 1))}
            disabled={index === tokens.length - 1}
            className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
        </div>

        <p className="text-center text-xs text-gray-400">
          Press arrow keys or swipe to navigate · Tap outside to close
        </p>
      </div>
    </div>
  );
}
