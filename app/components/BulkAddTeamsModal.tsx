'use client';

import { useEffect, useMemo, useState } from 'react';
import { parseBulkTeams, type GroupType } from '@/app/lib/constants';
import GroupPill from '@/app/components/GroupPill';
import Spinner from '@/app/components/Spinner';

interface BulkAddTeamsModalProps {
  onSubmit: (teams: { name: string; groupType: GroupType }[]) => Promise<void>;
  onClose: () => void;
}

export default function BulkAddTeamsModal({ onSubmit, onClose }: BulkAddTeamsModalProps) {
  const [names, setNames] = useState('');
  const [types, setTypes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseBulkTeams(names, types), [names, types]);
  const validRows = useMemo(() => parsed.filter((p) => p.error === null), [parsed]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit() {
    if (validRows.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(validRows.map((p) => ({ name: p.name, groupType: p.groupType as GroupType })));
    } catch {
      setError('Failed to add some teams. Please try again.');
      setSubmitting(false);
    }
  }

  const submitLabel =
    parsed.length === 0
      ? 'Add teams'
      : validRows.length === parsed.length
        ? `Add ${validRows.length} team${validRows.length === 1 ? '' : 's'}`
        : `Add ${validRows.length} of ${parsed.length} teams`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-add-teams-heading"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white p-6 shadow-xl">
        <h2 id="bulk-add-teams-heading" className="text-lg font-bold text-gray-900">
          Bulk add teams
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Paste team names and types, one per line. A single type applies to all teams.
        </p>

        <div className="mt-3 grid flex-none grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="bulk-add-names"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Team names
            </label>
            <textarea
              id="bulk-add-names"
              value={names}
              onChange={(e) => setNames(e.target.value)}
              placeholder={'First Baptist\nGrace Chapel'}
              rows={8}
              className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="bulk-add-types"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Team types
            </label>
            <textarea
              id="bulk-add-types"
              value={types}
              onChange={(e) => setTypes(e.target.value)}
              placeholder={'Teen\nPre-Teen'}
              rows={8}
              className="w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}

        {parsed.length > 0 && (
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md border border-gray-200">
            <ul className="divide-y divide-gray-100">
              {parsed.map((row) => (
                <li key={row.lineNumber} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  {row.error ? (
                    <>
                      <span className="text-red-600" aria-hidden="true">
                        ✗
                      </span>
                      <span className="min-w-0 flex-1 truncate text-gray-700">
                        {row.name || '(blank)'}
                      </span>
                      <span className="flex-none text-xs text-red-600">{row.error}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-emerald-600" aria-hidden="true">
                        ✓
                      </span>
                      <span className="min-w-0 flex-1 truncate text-gray-900">{row.name}</span>
                      <GroupPill groupType={row.groupType} />
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex flex-none items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-sm font-medium text-gray-600 hover:text-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || validRows.length === 0}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting && (
              <Spinner className="h-3.5 w-3.5 border-2 border-indigo-200 border-t-white" />
            )}
            {submitting ? 'Adding…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
