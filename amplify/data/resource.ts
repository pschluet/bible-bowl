import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * Data schema for Bible Bowl scoring — multi-tenant edition.
 *
 * Models:
 *  - Game: one event owned by an admin (slug is the PK / public address)
 *  - Team: a church competing; belongs to one Game
 *  - Score: a single question's score (0–3) for one team in one Game
 *  - OnboardingToken: single-use QR-code token; belongs to one Game/Team
 *
 * Authorization summary:
 *  - Guests (public viewers) can READ Game, Team, Score (leaderboard).
 *  - Any authenticated user (admins, scorekeepers) can READ all models.
 *  - SuperAdmins can CRUD everything (bypasses ownership boundary).
 *  - Admins own their own rows: ownerDefinedIn('ownerId') gates all writes.
 *    ownerId must be set EXPLICITLY on every create (both userPool admin
 *    client writes and apiKey server route writes) — ownerDefinedIn does
 *    NOT auto-populate on apiKey creates.
 *  - Scorekeepers create Score records via /api/scorekeeper/score, which
 *    validates the session and stamps ownerId from the team's game owner.
 *  - publicApiKey() is used exclusively by Next.js server routes after
 *    validating the caller's identity in the handler.
 *
 * Owner-auth note:
 *  identityClaim('sub') pins the comparison to the raw Cognito sub so that
 *  manually-stamped ownerId values (from apiKey routes) match the userPool
 *  owner's JWT claim exactly.
 */
const schema = a.schema({
  /**
   * One event/competition owned by an admin.
   * slug is the PK — gives atomic uniqueness + O(1) /g/[slug] lookup.
   * Slugs are immutable; use title for display / rename.
   */
  Game: a
    .model({
      title: a.string().required(),
      // Human-friendly public code, e.g. "faith-2026". Lowercase alnum + hyphen.
      // Immutable after creation (it's the PK). Use title for renamable display.
      slug: a.string().required(),
      // Cognito sub of the admin who owns this game. Denormalized here AND on
      // child models so each row is independently owner-auth-enforceable.
      ownerId: a.string().required(),
      // Game state (folded in from the old GameState singleton)
      currentQuestion: a.integer().required(),
      // true = scoring open; false = closed (e.g. end game pressed).
      // Null/absent treated as open by clients for backward compat.
      scoringOpen: a.boolean(),
    })
    // slug is the PK — enforces uniqueness at the DynamoDB level.
    .identifier(['slug'])
    .secondaryIndexes((index) => [
      // Efficient "list my games" for a given admin.
      index('ownerId').name('byOwner'),
    ])
    .authorization((allow) => [
      allow.guest().to(['read']),
      allow.authenticated().to(['read']),
      // Super admins bypass ownership — can manage any game.
      allow.groups(['SuperAdmins']).to(['create', 'read', 'update', 'delete']),
      // Regular admins own their own games.
      allow
        .ownerDefinedIn('ownerId')
        .identityClaim('sub')
        .to(['create', 'read', 'update', 'delete']),
      // Server routes (end-game scoringOpen flip, etc.) use the API key after
      // validating the caller's identity in the handler.
      allow.publicApiKey().to(['create', 'read', 'update']),
    ]),

  /**
   * A church/team competing in one Game.
   * gameId references Game.slug (the PK).
   * ownerId is denormalized from Game.ownerId — required because AppSync
   * owner rules evaluate a field on THIS row, not a joined Game row.
   */
  Team: a
    .model({
      gameId: a.string().required(), // FK → Game.slug
      ownerId: a.string().required(), // denormalized game owner sub
      name: a.string().required(),
      scorekeeperUserId: a.string(),
      scorekeeperEmail: a.string(),
      displayOrder: a.integer(),
      groupType: a.enum(['Teen', 'PreTeen', 'Adult']),
    })
    .secondaryIndexes((index) => [
      // Efficient per-game team list, sorted by displayOrder.
      index('gameId').sortKeys(['displayOrder']).name('byGame'),
      // Keep the original per-team score lookup.
    ])
    .authorization((allow) => [
      allow.guest().to(['read']),
      allow.authenticated().to(['read']),
      allow.groups(['SuperAdmins']).to(['create', 'read', 'update', 'delete']),
      allow
        .ownerDefinedIn('ownerId')
        .identityClaim('sub')
        .to(['create', 'read', 'update', 'delete']),
      // Server routes (QR exchange: bind scorekeeperUserId) use the API key.
      allow.publicApiKey().to(['read', 'update']),
    ]),

  /**
   * A single question's score (0–3) for one team in one game.
   * gameId + ownerId are denormalized for scoping + ownership.
   */
  Score: a
    .model({
      gameId: a.string().required(), // FK → Game.slug
      ownerId: a.string().required(), // denormalized game owner sub
      teamId: a.string().required(),
      questionNumber: a.integer().required(),
      points: a.integer().required(),
    })
    .secondaryIndexes((index) => [
      // Efficient per-team score lookup (used by scorekeeper page).
      index('teamId').sortKeys(['questionNumber']).name('byTeamId'),
      // Efficient per-game score list (used by admin score grid, leaderboard).
      index('gameId').sortKeys(['questionNumber']).name('byGame'),
    ])
    .authorization((allow) => [
      allow.guest().to(['read']),
      allow.authenticated().to(['read']),
      allow.groups(['SuperAdmins']).to(['create', 'read', 'update', 'delete']),
      allow
        .ownerDefinedIn('ownerId')
        .identityClaim('sub')
        .to(['create', 'read', 'update', 'delete']),
      // Scorekeepers create scores via /api/scorekeeper/score, which validates
      // session + game state and stamps ownerId before writing.
      allow.publicApiKey().to(['create', 'read']),
    ]),

  /**
   * QR-code onboarding tokens. One token per team per game, generated by the
   * admin before the event. tokenId is the UUID encoded in the QR deep link.
   */
  OnboardingToken: a
    .model({
      tokenId: a.string().required(),
      gameId: a.string().required(), // FK → Game.slug
      teamId: a.string().required(),
      ownerId: a.string().required(), // denormalized game owner sub
      status: a.enum(['UNUSED', 'CONSUMED']),
      consumedAt: a.string(),
      expiresAt: a.string(),
      batchId: a.string(),
    })
    .identifier(['tokenId'])
    .secondaryIndexes((index) => [
      // Efficient per-game token list (used by generate/end-game routes).
      index('gameId').name('byGame'),
    ])
    .authorization((allow) => [
      allow.groups(['SuperAdmins']).to(['create', 'read', 'update', 'delete']),
      allow
        .ownerDefinedIn('ownerId')
        .identityClaim('sub')
        .to(['create', 'read', 'update', 'delete']),
      // Server routes (generate, exchange, end-game) use the API key after
      // enforcing admin/token validation themselves in the handler.
      allow.publicApiKey().to(['create', 'read', 'update', 'delete']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // Identity Pool (IAM) is the default — supports guest (unauthenticated) reads
    // for the public leaderboard without requiring a login.
    defaultAuthorizationMode: 'identityPool',
    // API key used by Next.js server routes for privileged operations.
    apiKeyAuthorizationMode: { expiresInDays: 365 },
  },
});
