/**
 * Pure helpers for team display-order management.
 *
 * `displayOrder` allocation here is still client-computed from local React
 * state (not an atomic server-side counter), so two near-simultaneous adds
 * can still compute the same value — see REQUIREMENTS.md known-bug #7.
 * `compareTeamOrder` (app/lib/constants.ts) tie-breaks by name so a
 * collision doesn't crash anything; it's documented and tested rather than
 * eliminated.
 */

/** Returns the next `displayOrder` value, one past the current maximum. */
export function nextDisplayOrder(teams: { displayOrder?: number | null }[]): number {
  return teams.reduce((m, t) => Math.max(m, t.displayOrder ?? -1), -1) + 1;
}

/**
 * Given a list of teams in their new order, returns only the updates needed
 * to persist that order — i.e. teams whose index actually changed — so a
 * drag that only moves one team doesn't rewrite every row.
 */
export function computeReorderUpdates<T extends { id: string; displayOrder?: number | null }>(
  reordered: T[]
): { id: string; displayOrder: number }[] {
  return reordered.flatMap((t, i) => (t.displayOrder !== i ? [{ id: t.id, displayOrder: i }] : []));
}
