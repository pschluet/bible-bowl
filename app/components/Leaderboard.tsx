'use client';

import { useState } from 'react';

export type ScoreHistoryEntry = { questionNumber: number; points: number };

export type LeaderboardTeam = { id: string; name: string; total: number; history: ScoreHistoryEntry[] };

type LeaderboardProps = {
  teams: LeaderboardTeam[];
  favoriteTeamId: string | null;
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

        {/* Expand/collapse button — covers name + total */}
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => onToggle(team.id)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span className="flex-1 truncate font-medium text-gray-900">{team.name}</span>
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
  return (
    <ul className="divide-y divide-gray-100">
      {history.map((entry) => (
        <li key={entry.questionNumber} className="flex justify-between py-1 text-sm">
          <span className="text-gray-500">Q{entry.questionNumber}</span>
          <span className="font-medium text-gray-800">{entry.points}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Leaderboard({
  teams,
  favoriteTeamId,
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
  const [favoriteExpanded, setFavoriteExpanded] = useState(false);

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

  const ranked = teams.map((team, i) => ({ team, rank: i + 1 }));
  const favorite = ranked.find((r) => r.team.id === favoriteTeamId);

  return (
    <div className="mx-auto w-full max-w-lg flex-1 overflow-y-auto">
      {currentQuestion !== null && (
        <div className="flex justify-center px-4 pt-3">
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">
            Now on Q{currentQuestion}
          </span>
        </div>
      )}

      {favorite && (
        <div className="sticky top-0 z-10 px-4 pt-3">
          <div className="rounded-xl border border-amber-300 bg-white shadow-md">
            <button
              type="button"
              aria-expanded={favoriteExpanded}
              onClick={() => setFavoriteExpanded((prev) => !prev)}
              className="flex w-full items-center gap-3 p-4 text-left"
            >
              <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-amber-600 sr-only">
                Your Team
              </div>
              <span className="w-8 shrink-0 text-center text-lg font-semibold text-gray-500">
                {rankLabel(favorite.rank)}
              </span>
              <span className="flex-1 truncate font-semibold text-gray-900">
                {favorite.team.name}
              </span>
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-600 mr-1">
                ★ Your Team
              </span>
              <span className="text-2xl font-bold tabular-nums text-gray-900">
                {favorite.team.total}
              </span>
              <span
                className={`text-amber-400 transition-transform duration-150 ${favoriteExpanded ? 'rotate-90' : ''}`}
                aria-hidden
              >
                ▸
              </span>
            </button>
            {favoriteExpanded && (
              <div className="border-t border-amber-100 bg-amber-50 px-4 pb-3 pt-2">
                <ScoreHistory history={favorite.team.history} />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 divide-y divide-gray-200 bg-white">
        {ranked.map(({ team, rank }) => (
          <TeamRow
            key={team.id}
            team={team}
            rank={rank}
            isFavorite={team.id === favoriteTeamId}
            onFavorite={onFavorite}
            isExpanded={expandedIds.has(team.id)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}
