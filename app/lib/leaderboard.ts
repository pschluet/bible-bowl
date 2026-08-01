/**
 * Pure leaderboard-ranking and favorites-persistence helpers, shared between
 * the Leaderboard component and the public game page.
 */

import { GROUP_TYPES, type GroupType } from './constants';

/** Emoji for the top three positions, plain number otherwise. */
export function rankLabel(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return String(rank);
}

/**
 * Assigns standard competition ranks (1, 1, 3 — ties share a rank and the
 * next distinct value skips ahead) to a list of teams. Assumes `teams` is
 * already sorted descending by `total` (see `sortLeaderboardTeams`).
 */
export function assignCompetitionRanks<T extends { total: number }>(
  teams: T[]
): { team: T; rank: number }[] {
  const result: { team: T; rank: number }[] = [];
  let rank = 0;
  let prevTotal: number | null = null;
  teams.forEach((team, i) => {
    if (prevTotal === null || team.total !== prevTotal) {
      rank = i + 1;
      prevTotal = team.total;
    }
    result.push({ team, rank });
  });
  return result;
}

/** Sorts teams descending by total score, tie-broken alphabetically by name. */
export function sortLeaderboardTeams<T extends { total: number; name: string }>(teams: T[]): T[] {
  return [...teams].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/**
 * Partitions teams into their leaderboard group columns, in the fixed
 * Teen -> Pre-Teen -> Adult order, plus an "Other" bucket for teams with no
 * or unrecognized groupType. Every group key is always present (possibly
 * empty), so callers can filter for non-empty groups themselves.
 */
export function groupTeamsByType<T extends { groupType: string | null }>(
  teams: T[]
): Map<GroupType | 'Other', T[]> {
  const byGroup = new Map<GroupType | 'Other', T[]>();
  for (const g of GROUP_TYPES) byGroup.set(g, []);
  byGroup.set('Other', []);
  for (const team of teams) {
    const key: GroupType | 'Other' =
      team.groupType && (GROUP_TYPES as readonly string[]).includes(team.groupType)
        ? (team.groupType as GroupType)
        : 'Other';
    byGroup.get(key)!.push(team);
  }
  return byGroup;
}

/**
 * Parses the `bb_favorite` localStorage value into a set of favorited team
 * ids. Supports the current JSON-array format and, for backward
 * compatibility, a legacy bare-string single-favorite format (also used as
 * the fallback for any other non-array JSON value).
 */
export function readFavorites(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed as string[]);
  } catch {
    // Not valid JSON — fall through to legacy handling.
  }
  return new Set([raw]);
}

/**
 * Serializes a set of favorited team ids for localStorage. Returns `null`
 * when the set is empty, signaling the caller to remove the key entirely
 * rather than store an empty array.
 */
export function serializeFavorites(ids: Set<string>): string | null {
  return ids.size ? JSON.stringify([...ids]) : null;
}
