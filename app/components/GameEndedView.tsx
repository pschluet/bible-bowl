/**
 * Shown to scorekeepers who arrive at /scorekeeper without a valid session.
 * This covers two cases:
 *   1. After the admin presses "End Game" — all scorekeeper sessions are
 *      revoked and the next page load shows this screen instead of an error.
 *   2. A fresh device that hasn't scanned a QR code yet.
 */
export default function GameEndedView() {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-20">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-4 text-5xl">🏆</div>
        <h1 className="mb-2 text-xl font-bold text-gray-900">Scoring is closed</h1>
        <p className="text-sm text-gray-500">
          The Bible Bowl has ended. Thank you for participating!
        </p>
        <p className="mt-4 text-xs text-gray-400">
          If you need to submit scores, contact the event organizer.
        </p>
      </div>
    </div>
  );
}
