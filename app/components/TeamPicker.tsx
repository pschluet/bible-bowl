'use client';

import { useState } from 'react';
import type { Schema } from '@/amplify/data/resource';

type Team = Schema['Team']['type'];

type TeamPickerProps = {
  unclaimedTeams: Team[];
  onClaim: (teamId: string) => Promise<void>;
  loading?: boolean;
};

export default function TeamPicker({ unclaimedTeams, onClaim, loading = false }: TeamPickerProps) {
  const [selectedId, setSelectedId] = useState('');

  if (unclaimedTeams.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-600">
        All teams have been claimed. Contact an admin.
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    await onClaim(selectedId);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-gray-200 bg-white p-6">
      <p className="mb-4 text-gray-700">Select your church team below to get started</p>
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="mb-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
      >
        <option value="" disabled>
          Choose a team…
        </option>
        {unclaimedTeams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={loading || !selectedId}
        className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {loading ? 'Claiming…' : 'Claim Team'}
      </button>
    </form>
  );
}
