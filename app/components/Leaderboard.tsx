'use client';

import { useState } from 'react';
import GroupPill from '@/app/components/GroupPill';
import { GROUP_TYPES, GROUP_LABELS } from '@/app/lib/constants';

export type ScoreHistoryEntry = { questionNumber: number; points: number };

export type LeaderboardTeam = {
  id: string;
  name: string;
  total: number;
  groupType: string | null;
  history: ScoreHistoryEntry[];
};

type LeaderboardProps = {
  teams: LeaderboardTeam[];
  favoriteTeamIds: Set<string>;
  onFavorite: (id: string) => void;
  currentQuestion: number | null;
  loading: boolean;
};

function rankLabel(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return String(rank);
}

/** Returns the most recent scored entry, or null if the team has no scores. */
function latestEntry(history: ScoreHistoryEntry[]): ScoreHistoryEntry | null {
  if (history.length === 0) return null;
  return history[history.length - 1];
}

function LatestBadge({ history }: { history: ScoreHistoryEntry[] }) {
  const latest = latestEntry(history);
  if (!latest) return null;
  return (
    <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600">
      Q{latest.questionNumber}: {latest.points}
    </span>
  );
}

function TeamRow({
  team,
  rank,
  isFavorite,
  onFavorite,
  isExpanded,
  onToggle,
}: {
  team: LeaderboardTeam;
  rank: number;
  isFavorite: boolean;
  onFavorite: (id: string) => void;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-4">
        <span className="w-8 shrink-0 text-center text-lg font-semibold text-gray-500">
          {rankLabel(rank)}
        </span>

        {/* Expand/collapse button — covers name + scores */}
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => onToggle(team.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1 break-words line-clamp-2 font-medium text-gray-900">{team.name}</span>
          <LatestBadge history={team.history} />
          <span className="text-2xl font-bold tabular-nums text-gray-900">{team.total}</span>
          <span
            className={`text-gray-400 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
            aria-hidden
          >
            ▸
          </span>
        </button>

        {/* Favorite star — separate so tapping it doesn't expand */}
        <button
          type="button"
          aria-label={isFavorite ? 'Remove favorite' : 'Set as favorite'}
          onClick={() => onFavorite(team.id)}
          className={`shrink-0 text-2xl leading-none transition-colors ${
            isFavorite ? 'text-amber-400' : 'text-gray-300 hover:text-amber-300'
          }`}
        >
          ★
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 pb-3 pt-2">
          <ScoreHistory history={team.history} />
        </div>
      )}
    </div>
  );
}

function ScoreHistory({ history }: { history: ScoreHistoryEntry[] }) {
  if (history.length === 0) return <p className="text-sm text-gray-400">No scores yet</p>;
  const descending = [...history].reverse();
  return (
    <ul className="divide-y divide-gray-100">
      {descending.map((entry) => (
        <li key={entry.questionNumber} className="flex justify-between py-1 text-sm">
          <span className="text-gray-500">Q{entry.questionNumber}</span>
          <span className="font-medium text-gray-800">{entry.points}</span>
        </li>
      ))}
    </ul>
  );
}

/** One group's ranked leaderboard section. */
function GroupSection({
  label,
  groupType,
  teams,
  favoriteTeamIds,
  onFavorite,
  expandedIds,
  onToggle,
}: {
  label: string;
  groupType: string | null;
  teams: LeaderboardTeam[];
  favoriteTeamIds: Set<string>;
  onFavorite: (id: string) => void;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (teams.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 px-4 pb-1 pt-2">
        <GroupPill groupType={groupType} />
        {!groupType && <span className="text-sm font-semibold text-gray-500">{label}</span>}
      </div>
      <div className="divide-y divide-gray-200 bg-white">
        {teams.map((team, i) => (
          <TeamRow
            key={team.id}
            team={team}
            rank={i + 1}
            isFavorite={favoriteTeamIds.has(team.id)}
            onFavorite={onFavorite}
            isExpanded={expandedIds.has(team.id)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

export default function Leaderboard({
  teams,
  favoriteTeamIds,
  onFavorite,
  currentQuestion,
  loading,
}: LeaderboardProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const onToggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const [favExpandedIds, setFavExpandedIds] = useState<Set<string>>(new Set());
  const onFavToggle = (id: string) =>
    setFavExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-gray-500">
        No teams yet
      </div>
    );
  }

  // Partition teams into groups (already sorted by total desc from page.tsx)
  const byGroup = new Map<string, LeaderboardTeam[]>();
  for (const g of GROUP_TYPES) byGroup.set(g, []);
  byGroup.set('Other', []);
  for (const team of teams) {
    const key = team.groupType && GROUP_TYPES.includes(team.groupType as (typeof GROUP_TYPES)[number])
      ? team.groupType
      : 'Other';
    byGroup.get(key)!.push(team);
  }

  // Find all favorited teams across all groups with their within-group ranks, in group display order
  const favorites: { team: LeaderboardTeam; rank: number }[] = [];
  if (favoriteTeamIds.size) {
    for (const g of [...GROUP_TYPES, 'Other']) {
      const groupTeams = byGroup.get(g) ?? [];
      groupTeams.forEach((t, idx) => {
        if (favoriteTeamIds.has(t.id)) favorites.push({ team: t, rank: idx + 1 });
      });
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg flex-1 overflow-y-auto">
      {currentQuestion !== null && (
        <div className="flex justify-center px-4 pt-3">
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">
            Now on Q{currentQuestion}
          </span>
        </div>
      )}

      {/* Favorite sticky cards — one per favorited team, stacked in a single sticky container */}
      {favorites.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-col gap-2 px-4 pt-3">
          {favorites.map(({ team, rank }) => {
            const isExpanded = favExpandedIds.has(team.id);
            return (
              <div key={team.id} className="rounded-xl border border-amber-300 bg-white shadow-md">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => onFavToggle(team.id)}
                  className="flex w-full items-center gap-3 p-4 text-left"
                >
                  <span className="w-8 shrink-0 text-center text-lg font-semibold text-gray-500">
                    {rankLabel(rank)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words line-clamp-2 font-semibold text-gray-900">
                      {team.name}
                    </span>
                    <span className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                        ★ Your Team
                      </span>
                      <GroupPill groupType={team.groupType} />
                    </span>
                  </span>
                  <LatestBadge history={team.history} />
                  <span className="text-2xl font-bold tabular-nums text-gray-900">
                    {team.total}
                  </span>
                  <span
                    className={`text-amber-400 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                    aria-hidden
                  >
                    ▸
                  </span>
                </button>
                {isExpanded && (
                  <div className="border-t border-amber-100 bg-amber-50 px-4 pb-3 pt-2">
                    <ScoreHistory history={team.history} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* One section per group in defined order, then Other */}
      {GROUP_TYPES.map((g) => (
        <GroupSection
          key={g}
          groupType={g}
          label={GROUP_LABELS[g]}
          teams={byGroup.get(g) ?? []}
          favoriteTeamIds={favoriteTeamIds}
          onFavorite={onFavorite}
          expandedIds={expandedIds}
          onToggle={onToggle}
        />
      ))}
      <GroupSection
        groupType={null}
        label="Other"
        teams={byGroup.get('Other') ?? []}
        favoriteTeamIds={favoriteTeamIds}
        onFavorite={onFavorite}
        expandedIds={expandedIds}
        onToggle={onToggle}
      />
    </div>
  );
}
