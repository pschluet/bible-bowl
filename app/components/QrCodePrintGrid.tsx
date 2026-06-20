'use client';

/**
 * Printable grid of QR codes — one per team, labeled with team name + group.
 * Clicking "Print" opens the browser print dialog. The print stylesheet hides
 * the button and renders the grid clean on paper.
 */

import { QRCodeCanvas } from 'qrcode.react';
import GroupPill from '@/app/components/GroupPill';
import type { QrToken } from '@/app/components/QrCodeDisplay';

interface Props {
  tokens: QrToken[];
  onClose: () => void;
}

export default function QrCodePrintGrid({ tokens, onClose }: Props) {
  const origin = window.location.origin;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white">
      {/* Print-only button bar */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-4 print:hidden">
        <h2 className="text-base font-semibold text-gray-900">QR Codes — All Teams</h2>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Print
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>

      {/* QR grid */}
      <div className="grid grid-cols-3 gap-6 p-6 print:gap-4 print:p-4 md:grid-cols-4 lg:grid-cols-5">
        {tokens.map((token) => {
          const deepLink = `${origin}/scan?token=${token.tokenId}`;
          return (
            <div
              key={token.tokenId}
              className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 p-3 print:break-inside-avoid print:rounded-none print:border-gray-400"
            >
              <QRCodeCanvas value={deepLink} size={130} level="M" marginSize={1} />
              <p className="text-center text-xs font-semibold text-gray-800 print:text-[10px]">
                {token.teamName}
              </p>
              <GroupPill groupType={token.groupType} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
