/**
 * Application-level constants.
 * Kept in a separate file so client components can import them
 * without pulling in `@aws-amplify/backend` (CDK) into the browser bundle.
 */

/** The fixed DynamoDB record ID for the GameState singleton. */
export const GAME_STATE_ID = 'SINGLETON';

/** Valid point values a team can receive for a single question. */
export const POINT_OPTIONS = [0, 1, 2, 3] as const;

/** Ordered list of team group types — order defines leaderboard stacking. */
export const GROUP_TYPES = ['Teen', 'PreTeen', 'Adult'] as const;
export type GroupType = (typeof GROUP_TYPES)[number];

/** Human-readable labels for each group type. */
export const GROUP_LABELS: Record<GroupType, string> = {
  Teen: 'Teen',
  PreTeen: 'Pre-Teen',
  Adult: 'Adult',
};

/**
 * Deterministic primary-key helper for Score records.
 * Using a content-derived id makes concurrent creates for the same
 * (teamId, questionNumber) fail atomically — no duplicate records possible.
 */
export const scoreId = (teamId: string, questionNumber: number) =>
  `${teamId}#${questionNumber}`;

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
