/**
 * Application-level constants.
 * Kept in a separate file so client components can import them
 * without pulling in `@aws-amplify/backend` (CDK) into the browser bundle.
 */

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
 * Reserved URL segments that must not be used as game slugs, since they
 * correspond to top-level app routes.
 */
export const RESERVED_SLUGS = new Set(['login', 'scan', 'scorekeeper', 'admin', 'api', 'g']);

/**
 * Normalize a raw slug input: lowercase, replace spaces with hyphens,
 * strip characters that aren't alphanumeric or hyphens.
 */
export function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Returns an error message if the slug is invalid or reserved, or null if valid.
 */
export function validateSlug(slug: string): string | null {
  if (!slug) return 'Game code is required.';
  if (slug.length < 2) return 'Game code must be at least 2 characters.';
  if (slug.length > 64) return 'Game code must be 64 characters or fewer.';
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && !/^[a-z0-9]$/.test(slug)) {
    return 'Game code must start and end with a letter or number, and contain only letters, numbers, and hyphens.';
  }
  if (RESERVED_SLUGS.has(slug))
    return `"${slug}" is a reserved word and cannot be used as a game code.`;
  return null;
}

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

/**
 * Normalize free-text into a GroupType enum value, or null if unrecognized.
 * Case-insensitive; ignores spaces/dashes so "Pre-Teen", "pre teen", "PRETEEN"
 * all resolve to "PreTeen". Used by the bulk-add-teams paste parser.
 */
export function normalizeGroupType(raw: string): GroupType | null {
  const key = raw.toLowerCase().replace(/[\s-]+/g, '');
  const map: Record<string, GroupType> = { teen: 'Teen', preteen: 'PreTeen', adult: 'Adult' };
  return map[key] ?? null;
}

/** One parsed row from a bulk-add-teams paste, with validation result. */
export interface ParsedTeamLine {
  lineNumber: number;
  name: string;
  groupType: GroupType | null;
  error: string | null;
}

/**
 * Pair pasted team names (one per line) with team types (one per line) by row
 * index. Two separate inputs are used instead of a single "name,type" line
 * because church/team names commonly contain commas.
 *
 * Single-type shortcut: if `typesInput` has exactly one non-blank line, that
 * type is applied to every name row (the common case of pasting a roster that's
 * all one division). Rows where both the name and type are blank are skipped
 * entirely — they aren't reported as errors.
 */
export function parseBulkTeams(namesInput: string, typesInput: string): ParsedTeamLine[] {
  const nameLines = namesInput.split('\n');
  const typeLines = typesInput.split('\n');
  const nonBlankTypes = typeLines.map((t) => t.trim()).filter(Boolean);
  const shortcutType = nonBlankTypes.length === 1 ? nonBlankTypes[0] : null;

  const rowCount = Math.max(nameLines.length, typeLines.length);
  const result: ParsedTeamLine[] = [];

  for (let i = 0; i < rowCount; i++) {
    const name = (nameLines[i] ?? '').trim();
    const typeRaw = shortcutType ?? (typeLines[i] ?? '').trim();
    if (!name && !typeRaw) continue; // fully blank row — skip silently

    const lineNumber = i + 1;

    if (!name) {
      result.push({ lineNumber, name, groupType: null, error: 'missing team name' });
      continue;
    }
    if (!typeRaw) {
      result.push({ lineNumber, name, groupType: null, error: 'missing type' });
      continue;
    }

    const groupType = normalizeGroupType(typeRaw);
    if (!groupType) {
      result.push({ lineNumber, name, groupType: null, error: `unknown type "${typeRaw}"` });
      continue;
    }

    result.push({ lineNumber, name, groupType, error: null });
  }

  return result;
}
