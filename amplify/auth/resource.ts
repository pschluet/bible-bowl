import { defineAuth } from '@aws-amplify/backend';

/**
 * Auth resource: email login with two groups.
 * - Admins: full access (CRUD teams, all scores, user management)
 * - Scorekeepers: one per team; onboarded via QR-code scan (passwordless)
 *
 * Self-signup is DISABLED (set in amplify/backend.ts via cfnUserPool override).
 * Scorekeepers are created lazily by the /api/scorekeeper/exchange route when
 * they scan a QR code. Admins are seeded via `npm run seed:admin` or created
 * on the Users page by an existing admin.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['Admins', 'Scorekeepers'],
});
