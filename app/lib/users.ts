/**
 * Pure Cognito-user display helpers for the SuperAdmin users page.
 *
 * These deliberately take `scorekeeperEmailDomain` as a parameter rather
 * than importing it from `app/lib/cognito.ts`, since that module pulls in
 * the AWS Cognito SDK and is documented as server-only — importing it here
 * would drag AWS SDK code into this otherwise dependency-free module (and
 * into any test of it).
 */

export type RoleLabel = 'Super Admin' | 'Admin' | 'QR Scorekeeper' | 'Scorekeeper';

/** True for QR-onboarded scorekeeper users (synthetic username pattern). */
export function isSyntheticScorekeeper(email: string, scorekeeperEmailDomain: string): boolean {
  return email.endsWith(`@${scorekeeperEmailDomain}`);
}

/**
 * Precedence: Super Admin > Admin > QR Scorekeeper (synthetic email) >
 * Scorekeeper.
 */
export function roleLabel(
  user: { groups: string[]; email: string },
  scorekeeperEmailDomain: string
): RoleLabel {
  const isSuperAdmin = user.groups.includes('SuperAdmins');
  if (isSuperAdmin) return 'Super Admin';
  if (user.groups.includes('Admins')) return 'Admin';
  if (isSyntheticScorekeeper(user.email, scorekeeperEmailDomain)) return 'QR Scorekeeper';
  return 'Scorekeeper';
}
