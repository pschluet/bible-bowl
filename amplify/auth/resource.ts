import { defineAuth } from '@aws-amplify/backend';

/**
 * Auth resource: email login with three groups.
 * - SuperAdmins: full CRUD on any game's data; the only role that can create/delete admins.
 * - Admins: own and manage their own games (owner-scoped writes).
 * - Scorekeepers: one per team; onboarded via QR-code scan (passwordless).
 *
 * Self-signup is DISABLED (set in amplify/backend.ts via cfnUserPool override).
 * Scorekeepers are created lazily by the /api/scorekeeper/exchange route when
 * they scan a QR code. Admins are seeded via `npm run seed:admin` or created
 * on the Users page by an existing super admin.
 * Super admins are seeded via `npm run seed:admin -- email --super`.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['SuperAdmins', 'Admins', 'Scorekeepers'],
});
