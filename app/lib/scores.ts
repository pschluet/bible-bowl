/**
 * Pure score-reconciliation helpers shared by the leaderboard, the admin
 * score grid, and the duplicate-healing pass.
 *
 * These were previously hand-duplicated in three places with an
 * inconsistent fallback (`(a.updatedAt ?? '') > (b.updatedAt ?? '')`, which
 * silently favors whichever record `observeQuery` happened to deliver first
 * when both records lack `updatedAt`, e.g. a brand-new optimistic write that
 * hasn't round-tripped yet). Consolidated here so the tie-break rule only
 * needs to be decided once: compare `updatedAt ?? createdAt ?? ''`, and keep
 * the incumbent (first argument) on an exact tie.
 */

import { POINT_OPTIONS, scoreId } from './constants';

export interface ScoreLike {
  updatedAt?: string | null;
  createdAt?: string | null;
}

function scoreSortKey(s: ScoreLike): string {
  return s.updatedAt ?? s.createdAt ?? '';
}

/** Returns whichever of the two records is more recent; ties favor `incumbent`. */
export function pickLatestScore<T extends ScoreLike>(incumbent: T, candidate: T): T {
  return scoreSortKey(candidate) > scoreSortKey(incumbent) ? candidate : incumbent;
}

/** True for a valid scorekeeper-submitted point value (0, 1, 2, or 3). */
export function isValidPoints(points: unknown): points is (typeof POINT_OPTIONS)[number] {
  return typeof points === 'number' && (POINT_OPTIONS as readonly number[]).includes(points);
}

/**
 * Merges an overlay (e.g. optimistic local writes) onto a base list (e.g. the
 * live subscription), keyed by `id`. For ids present in both, the more
 * recent record wins. Returns `base` unchanged (same reference) when there's
 * nothing to merge, so callers that gate other memoization on reference
 * identity aren't defeated by a no-op merge.
 */
export function mergeLatestById<T extends { id: string } & ScoreLike>(
  base: T[],
  overlay: T[]
): T[] {
  if (overlay.length === 0) return base;
  const map = new Map(base.map((s) => [s.id, s]));
  for (const item of overlay) {
    const existing = map.get(item.id);
    map.set(item.id, existing ? pickLatestScore(existing, item) : item);
  }
  return [...map.values()];
}

/**
 * Filters an optimistic overlay down to entries that still "win" against the
 * corresponding streamed record — i.e. the live subscription hasn't caught
 * up yet. Once a streamed record is as-new-or-newer, its optimistic
 * counterpart is dropped.
 */
export function pruneStaleOptimistic<T extends { id: string } & ScoreLike>(
  optimistic: T[],
  streamed: T[]
): T[] {
  const streamMap = new Map(streamed.map((s) => [s.id, s]));
  return optimistic.filter((opt) => {
    const s = streamMap.get(opt.id);
    return !s || pickLatestScore(s, opt) === opt;
  });
}

/**
 * Groups scores into a nested `teamId -> questionNumber -> Score` map,
 * keeping only the most recent record per (teamId, questionNumber) cell.
 * Used by the admin score grid, which needs O(1) cell lookup.
 */
export function buildScoreMap<T extends { teamId: string; questionNumber: number } & ScoreLike>(
  scores: T[]
): Map<string, Map<number, T>> {
  const map = new Map<string, Map<number, T>>();
  for (const score of scores) {
    let byQuestion = map.get(score.teamId);
    if (!byQuestion) {
      byQuestion = new Map<number, T>();
      map.set(score.teamId, byQuestion);
    }
    const existing = byQuestion.get(score.questionNumber);
    if (!existing || pickLatestScore(existing, score) === score) {
      byQuestion.set(score.questionNumber, score);
    }
  }
  return map;
}

/**
 * Flattens scores to one record per (teamId, questionNumber) cell, keeping
 * the most recent. Used by the public leaderboard, which needs a flat list
 * to compute per-team totals and history.
 */
export function dedupeScoresByCell<
  T extends { teamId: string; questionNumber: number } & ScoreLike,
>(scores: T[]): T[] {
  const byCell = new Map<string, T>();
  for (const s of scores) {
    const key = scoreId(s.teamId, s.questionNumber);
    const existing = byCell.get(key);
    if (!existing || pickLatestScore(existing, s) === s) byCell.set(key, s);
  }
  return [...byCell.values()];
}

/**
 * Finds the ids of duplicate Score rows for the same (teamId, questionNumber)
 * cell — legacy/race-created duplicates — keeping the most recently updated
 * row per cell and returning the rest for deletion.
 */
export function findDuplicateScoreIds<
  T extends { id: string; teamId: string; questionNumber: number } & ScoreLike,
>(scores: T[]): string[] {
  const byKey = new Map<string, T[]>();
  for (const s of scores) {
    const key = scoreId(s.teamId, s.questionNumber);
    const arr = byKey.get(key);
    if (arr) arr.push(s);
    else byKey.set(key, [s]);
  }

  const idsToDelete: string[] = [];
  for (const recs of byKey.values()) {
    if (recs.length < 2) continue;
    let keep = recs[0];
    for (let i = 1; i < recs.length; i++) keep = pickLatestScore(keep, recs[i]);
    for (const r of recs) {
      if (r.id !== keep.id) idsToDelete.push(r.id);
    }
  }
  return idsToDelete;
}

/** Sums a team's points across all of its scored questions. */
export function teamTotal(byQuestion: Map<number, { points: number }> | undefined): number {
  if (!byQuestion) return 0;
  let total = 0;
  for (const score of byQuestion.values()) total += score.points;
  return total;
}
