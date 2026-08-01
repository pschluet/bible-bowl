/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { isSyntheticScorekeeper, roleLabel } from '@/app/lib/users';

const DOMAIN = 'bible-bowl.internal';

describe('isSyntheticScorekeeper', () => {
  it('is true for a QR-onboarded synthetic email', () => {
    expect(isSyntheticScorekeeper('team-abc123@bible-bowl.internal', DOMAIN)).toBe(true);
  });

  it('is false for a real email address', () => {
    expect(isSyntheticScorekeeper('coach@church.org', DOMAIN)).toBe(false);
  });

  it('is false for an email that merely contains the domain, not ending with it', () => {
    expect(isSyntheticScorekeeper('team-abc@bible-bowl.internal.evil.com', DOMAIN)).toBe(false);
  });
});

describe('roleLabel', () => {
  it('labels a SuperAdmin as "Super Admin", even if also in Admins', () => {
    expect(roleLabel({ groups: ['SuperAdmins', 'Admins'], email: 'x@y.com' }, DOMAIN)).toBe(
      'Super Admin'
    );
  });

  it('labels a plain Admins-group user as "Admin"', () => {
    expect(roleLabel({ groups: ['Admins'], email: 'x@y.com' }, DOMAIN)).toBe('Admin');
  });

  it('labels a synthetic scorekeeper email as "QR Scorekeeper"', () => {
    expect(roleLabel({ groups: [], email: 'team-1@bible-bowl.internal' }, DOMAIN)).toBe(
      'QR Scorekeeper'
    );
  });

  it('labels a non-synthetic, non-admin user as plain "Scorekeeper"', () => {
    expect(roleLabel({ groups: ['Scorekeepers'], email: 'real@church.org' }, DOMAIN)).toBe(
      'Scorekeeper'
    );
  });

  it('labels a user with no groups and a real email as "Scorekeeper" (default)', () => {
    expect(roleLabel({ groups: [], email: 'nobody@example.com' }, DOMAIN)).toBe('Scorekeeper');
  });
});
