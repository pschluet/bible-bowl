'use client';

import { useEffect, useMemo, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';
import { compareTeamOrder, GROUP_LABELS, GROUP_TYPES, type GroupType } from '@/app/lib/constants';
import { subscribeLive } from '@/app/lib/liveQuery';

type Team = Schema['Team']['type'];

const client = generateClient<Schema>({ authMode: 'userPool' });

export default function AdminTeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState<GroupType>('Teen');
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Sorted teams derived from the live stream
  const sortedTeams = useMemo(() => [...teams].sort(compareTeamOrder), [teams]);

  useEffect(() => {
    return subscribeLive(
      () => client.models.Team.observeQuery({ authMode: 'userPool' }),
      ({ items, isSynced }) => {
        setTeams(items);
        if (isSynced) setLoading(false);
      },
    );
  }, []);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    setError(null);
    try {
      const displayOrder = teams.reduce((m, t) => Math.max(m, t.displayOrder ?? -1), -1) + 1;
      await client.models.Team.create({ name, groupType: newGroup, displayOrder }, { authMode: 'userPool' });
      setNewName('');
      // Stream delivers the new team — no reload needed
    } catch {
      setError('Failed to add team.');
    } finally {
      setAdding(false);
    }
  }

  async function handleSaveEdit(id: string) {
    const name = editName.trim();
    setEditingId(null);
    if (!name) return;
    setError(null);
    try {
      await client.models.Team.update({ id, name }, { authMode: 'userPool' });
      // Stream delivers the update — no reload needed
    } catch {
      setError('Failed to update team.');
    }
  }

  async function handleGroupChange(id: string, groupType: GroupType) {
    setError(null);
    try {
      await client.models.Team.update({ id, groupType }, { authMode: 'userPool' });
      // Stream delivers the update — no reload needed
    } catch {
      setError('Failed to update group.');
    }
  }

  async function handleDelete(team: Team) {
    if (!confirm(`Delete "${team.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await client.models.Team.delete({ id: team.id }, { authMode: 'userPool' });
      // Stream delivers the delete — no reload needed
    } catch {
      setError('Failed to delete team.');
    }
  }

  async function handleMove(index: number, direction: 'up' | 'down') {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= sortedTeams.length) return;
    setError(null);

    const teamA = sortedTeams[index];
    const teamB = sortedTeams[swapIndex];

    // Optimistic: swap display orders in local state so the UI updates instantly
    setTeams(cur =>
      cur.map(t => {
        if (t.id === teamA.id) return { ...t, displayOrder: swapIndex };
        if (t.id === teamB.id) return { ...t, displayOrder: index };
        return t;
      })
    );

    try {
      await Promise.all([
        client.models.Team.update(
          { id: teamA.id, displayOrder: swapIndex },
          { authMode: 'userPool' }
        ),
        client.models.Team.update(
          { id: teamB.id, displayOrder: index },
          { authMode: 'userPool' }
        ),
      ]);
      // Stream delivers confirmed updates — no reload needed
    } catch {
      setError('Failed to reorder teams.');
      // Revert optimistic state
      setTeams(cur =>
        cur.map(t => {
          if (t.id === teamA.id) return { ...t, displayOrder: index };
          if (t.id === teamB.id) return { ...t, displayOrder: swapIndex };
          return t;
        })
      );
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Teams</h1>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Add team row */}
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-4">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
          placeholder="Church name"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <select
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value as GroupType)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          {GROUP_TYPES.map((g) => (
            <option key={g} value={g}>{GROUP_LABELS[g]}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || !newName.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Add Team
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
        </div>
      ) : sortedTeams.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
          No teams yet.
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {sortedTeams.map((team, index) => (
            <li key={team.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              {/* Up/down reorder buttons */}
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => void handleMove(index, 'up')}
                  disabled={index === 0}
                  className="text-gray-400 hover:text-gray-700 disabled:invisible"
                  aria-label="Move up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => void handleMove(index, 'down')}
                  disabled={index === sortedTeams.length - 1}
                  className="text-gray-400 hover:text-gray-700 disabled:invisible"
                  aria-label="Move down"
                >
                  ▼
                </button>
              </div>

              <div className="min-w-0 flex-1">
                {editingId === team.id ? (
                  <input
                    type="text"
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => handleSaveEdit(team.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(team.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                ) : (
                  <p className="truncate font-medium text-gray-900">{team.name}</p>
                )}
              </div>

              {/* Group selector */}
              <select
                value={team.groupType ?? ''}
                onChange={(e) => {
                  if (e.target.value) void handleGroupChange(team.id, e.target.value as GroupType);
                }}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
                aria-label={`Group for ${team.name}`}
              >
                <option value="">— group —</option>
                {GROUP_TYPES.map((g) => (
                  <option key={g} value={g}>{GROUP_LABELS[g]}</option>
                ))}
              </select>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(team.id);
                    setEditName(team.name);
                  }}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(team)}
                  className="text-sm font-medium text-red-600 hover:text-red-800"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
