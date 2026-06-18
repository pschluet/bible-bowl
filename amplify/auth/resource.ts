import { defineAuth } from '@aws-amplify/backend';

/**
 * Auth resource: email login with two groups.
 * - Admins: full access (CRUD teams, all scores, user management)
 * - Scorekeepers: can claim one team and enter scores for the current question
 *
 * Self-signup is enabled so scorekeepers can register themselves.
 * Admins are promoted via `npm run seed:admin` or the in-app user creation screen.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['Admins', 'Scorekeepers'],
});
