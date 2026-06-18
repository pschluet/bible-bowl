import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * Data schema for Bible Bowl scoring.
 *
 * Models:
 *  - GameState (singleton, id='SINGLETON'): tracks the current question number
 *  - Team: a church competing in the bowl
 *  - Score: a single question's score (0–3) for one team
 *
 * Auth summary:
 *  - Guests (viewers) and authenticated users can READ everything.
 *  - Admins can CRUD everything.
 *  - Scorekeepers can CREATE their own Score records (via `allow.owner()`);
 *    they cannot UPDATE past scores (owner gets create+read only).
 *  - `allow.publicApiKey()` on Team is used exclusively by Next.js server
 *    routes (claim route, admin user-creation route) after validating the
 *    caller's JWT server-side. The API key is public in amplify_outputs.json
 *    but Team write operations are enforced by route-handler logic.
 */
const schema = a.schema({
  GameState: a
    .model({
      currentQuestion: a.integer().required(),
    })
    .authorization((allow) => [
      allow.guest().to(['read']),
      allow.authenticated().to(['read']),
      allow.groups(['Admins']).to(['create', 'read', 'update', 'delete']),
    ]),

  Team: a
    .model({
      name: a.string().required(),
      scorekeeperUserId: a.string(),
      scorekeeperEmail: a.string(),
      displayOrder: a.integer(),
      groupType: a.enum(['Teen', 'PreTeen', 'Adult']),
    })
    .authorization((allow) => [
      allow.guest().to(['read']),
      allow.authenticated().to(['read']),
      allow.groups(['Admins']).to(['create', 'read', 'update', 'delete']),
      // Server routes (claim + admin user creation) use the API key
      // after validating the caller's Cognito JWT in the route handler.
      allow.publicApiKey().to(['read', 'update']),
    ]),

  Score: a
    .model({
      teamId: a.string().required(),
      questionNumber: a.integer().required(),
      points: a.integer().required(),
    })
    // Secondary index for efficient per-team lookups
    .secondaryIndexes((index) => [index('teamId').sortKeys(['questionNumber']).name('byTeamId')])
    .authorization((allow) => [
      allow.guest().to(['read']),
      allow.authenticated().to(['read']),
      allow.groups(['Admins']).to(['create', 'read', 'update', 'delete']),
      // Scorekeepers can create new scores (owner is auto-set to their Cognito sub).
      // They cannot update past scores: owner only gets create + read.
      allow.owner().to(['create', 'read']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

/** Constant used throughout the app to identify the singleton GameState record. */
export const GAME_STATE_ID = 'SINGLETON';

export const data = defineData({
  schema,
  authorizationModes: {
    // Identity Pool (IAM) is the default — supports guest (unauthenticated) reads
    // for the public leaderboard without requiring a login.
    defaultAuthorizationMode: 'identityPool',
    // API key used by Next.js server routes for Team updates (claim + admin ops).
    apiKeyAuthorizationMode: { expiresInDays: 365 },
  },
});
