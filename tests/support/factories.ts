/**
 * Fixture builders for the four Amplify models, matching the field shapes in
 * amplify/data/resource.ts. Each accepts partial overrides.
 */

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function resetFactoryCounter(): void {
  counter = 0;
}

export interface GameFixture {
  slug: string;
  title: string;
  ownerId: string;
  currentQuestion: number | null;
  maxQuestionReached: number | null;
  scoringOpen: boolean | null;
  createdAt: string;
  updatedAt: string;
  // Lets fixtures satisfy the loosely-typed FakeModel<T extends object> store
  // (create/update/delete key lookups are by field name, so the mock can't
  // know each model's exact shape ahead of time).
  [key: string]: unknown;
}

export function makeGame(overrides: Partial<GameFixture> = {}): GameFixture {
  return {
    slug: 'game-one',
    title: 'Game One',
    ownerId: 'admin-sub-1',
    currentQuestion: 1,
    maxQuestionReached: 1,
    scoringOpen: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export interface TeamFixture {
  id: string;
  gameId: string;
  ownerId: string;
  name: string;
  groupType: 'Teen' | 'PreTeen' | 'Adult' | null;
  displayOrder: number | null;
  scorekeeperUserId: string | null;
  scorekeeperEmail: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export function makeTeam(overrides: Partial<TeamFixture> = {}): TeamFixture {
  return {
    id: nextId('team'),
    gameId: 'game-one',
    ownerId: 'admin-sub-1',
    name: 'Team One',
    groupType: 'Teen',
    displayOrder: 0,
    scorekeeperUserId: null,
    scorekeeperEmail: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export interface ScoreFixture {
  id: string;
  gameId: string;
  ownerId: string;
  teamId: string;
  questionNumber: number;
  points: number;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export function makeScore(overrides: Partial<ScoreFixture> = {}): ScoreFixture {
  const teamId = overrides.teamId ?? 'team-1';
  const questionNumber = overrides.questionNumber ?? 1;
  return {
    id: `${teamId}#${questionNumber}`,
    gameId: 'game-one',
    ownerId: 'admin-sub-1',
    teamId,
    questionNumber,
    points: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export interface TokenFixture {
  tokenId: string;
  gameId: string;
  teamId: string;
  ownerId: string;
  status: 'UNUSED' | 'CONSUMED';
  expiresAt: string | null;
  consumedAt: string | null;
  batchId: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export function makeToken(overrides: Partial<TokenFixture> = {}): TokenFixture {
  return {
    tokenId: nextId('token'),
    gameId: 'game-one',
    teamId: 'team-1',
    ownerId: 'admin-sub-1',
    status: 'UNUSED',
    // Far in the future so the default fixture is never expired, regardless
    // of when the test suite runs.
    expiresAt: '2099-01-01T08:00:00.000Z',
    consumedAt: null,
    batchId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
