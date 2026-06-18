'use client';

import { useCallback, useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';

type Team = Schema['Team']['type'];
type Role = 'Admins' | 'Scorekeepers';

const client = generateClient<Schema>({ authMode: 'userPool' });

export default function AdminUsersPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('Scorekeepers');
  const [teamId, setTeamId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    try {
      const res = await client.models.Team.list();
      setTeams([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      setError('Failed to load teams.');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTeams();
  }, [loadTeams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSuccess(null);
    setError(null);
    try {
      const body: { email: string; role: Role; teamId?: string } = {
        email: email.trim(),
        role,
      };
      if (role === 'Scorekeepers' && teamId) body.teamId = teamId;

      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? 'Failed to create user.');
      }

      setSuccess("User created! They'll receive a temporary password by email.");
      setEmail('');
      setTeamId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Users</h1>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-6"
      >
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="role" className="mb-1 block text-sm font-medium text-gray-700">
            Role
          </label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="Admins">Admin</option>
            <option value="Scorekeepers">Scorekeeper</option>
          </select>
        </div>

        {role === 'Scorekeepers' && (
          <div>
            <label htmlFor="team" className="mb-1 block text-sm font-medium text-gray-700">
              Team
            </label>
            <select
              id="team"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">— no team yet —</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Create User
        </button>

        {success && (
          <div className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{success}</div>
        )}
        {error && (
          <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}

        <p className="text-xs text-gray-400">
          Created users must sign in with the temporary password sent to their email and set a new
          password on first login.
        </p>
      </form>
    </div>
  );
}
