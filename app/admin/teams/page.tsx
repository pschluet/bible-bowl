'use client';

import { useCallback, useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';

type Team = Schema['Team']['type'];

const client = generateClient<Schema>({ authMode: 'userPool' });

export default function AdminTeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await client.models.Team.list();
      setTeams([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
      setError(null);
    } catch {
      setError('Failed to load teams.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const interval = setInterval(() => void load(), 10000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    setError(null);
    try {
      await client.models.Team.create({ name }, { authMode: 'userPool' });
      setNewName('');
      await load();
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
      await load();
    } catch {
      setError('Failed to update team.');
    }
  }

  async function handleDelete(team: Team) {
    if (!confirm(`Delete "${team.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await client.models.Team.delete({ id: team.id }, { authMode: 'userPool' });
      await load();
    } catch {
      setError('Failed to delete team.');
    }
  }

  async function handleRemoveScorekeeper(id: string) {
    setError(null);
    try {
      await client.models.Team.update(
        { id, scorekeeperUserId: null, scorekeeperEmail: null },
        { authMode: 'userPool' }
      );
      await load();
    } catch {
      setError('Failed to remove scorekeeper.');
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Teams</h1>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

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
      ) : teams.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
          No teams yet.
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {teams.map((team) => (
            <li key={team.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
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
                <p className="truncate text-xs text-gray-400">{team.scorekeeperEmail ?? '—'}</p>
              </div>
              <div className="flex items-center gap-2">
                {team.scorekeeperUserId && (
                  <button
                    type="button"
                    onClick={() => handleRemoveScorekeeper(team.id)}
                    className="text-sm font-medium text-amber-600 hover:text-amber-800"
                  >
                    Remove Scorekeeper
                  </button>
                )}
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
