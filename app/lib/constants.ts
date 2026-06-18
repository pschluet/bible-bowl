/**
 * Application-level constants.
 * Kept in a separate file so client components can import them
 * without pulling in `@aws-amplify/backend` (CDK) into the browser bundle.
 */

/** The fixed DynamoDB record ID for the GameState singleton. */
export const GAME_STATE_ID = 'SINGLETON';

/**
 * Comparator for sorting teams by admin-assigned display order.
 * Teams without an explicit order (null/undefined) sort after those with one,
 * with alphabetical name as the tiebreaker.
 */
export function compareTeamOrder<T extends { displayOrder?: number | null; name: string }>(
  a: T,
  b: T
): number {
  const ao = a.displayOrder ?? Number.MAX_SAFE_INTEGER;
  const bo = b.displayOrder ?? Number.MAX_SAFE_INTEGER;
  return ao - bo || a.name.localeCompare(b.name);
}
