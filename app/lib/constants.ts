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
export const scoreId = (teamId: string, questionNumber: number) => `${teamId}#${questionNumber}`;

/**
 * Fetch ALL pages of an Amplify list query, working around the 100-item default
 * page limit. Pass limit: 1000 per page to minimise round trips at full scale
 * (40 teams × 100 questions ≈ 4 000 records → ~4 pages).
 */
export async function listAll<T>(
  listFn: (opts: {
    nextToken?: string | null;
    limit?: number;
  }) => Promise<{ data: T[]; nextToken?: string | null }>
): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | null | undefined;
  do {
    const { data, nextToken: nt } = await listFn({ nextToken, limit: 1000 });
    all.push(...data);
    nextToken = nt;
  } while (nextToken);
  return all;
}

/**
 * Formats a team's display label for use in <option> elements.
 * Appends the human-readable group type when available.
 * Example: "Faith Community — Pre-Teen"
 */
export function teamOptionLabel(team: { name: string; groupType?: string | null }): string {
  if (team.groupType && team.groupType in GROUP_LABELS) {
    return `${team.name} — ${GROUP_LABELS[team.groupType as GroupType]}`;
  }
  return team.name;
}

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
