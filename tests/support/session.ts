/**
 * `ServerSession` builders for each role, matching `app/lib/auth.ts`'s
 * `getServerSession()` return shape. Use with:
 *
 *   vi.mock('@/app/lib/auth', () => ({ getServerSession: vi.fn() }));
 *   ...
 *   vi.mocked(getServerSession).mockResolvedValue(asAdmin());
 */
import type { ServerSession } from '@/app/lib/auth';

export function asAnon(): null {
  return null;
}

export function asScorekeeper(overrides: Partial<ServerSession> = {}): ServerSession {
  return {
    sub: 'scorekeeper-sub-1',
    email: 'team-team-1@bible-bowl.internal',
    groups: ['Scorekeepers'],
    isSuperAdmin: false,
    isAdmin: false,
    isScorekeeper: true,
    ...overrides,
  };
}

export function asAdmin(overrides: Partial<ServerSession> = {}): ServerSession {
  return {
    sub: 'admin-sub-1',
    email: 'admin@example.com',
    groups: ['Admins'],
    isSuperAdmin: false,
    isAdmin: true,
    isScorekeeper: false,
    ...overrides,
  };
}

export function asSuperAdmin(overrides: Partial<ServerSession> = {}): ServerSession {
  return {
    sub: 'superadmin-sub-1',
    email: 'superadmin@example.com',
    groups: ['SuperAdmins'],
    isSuperAdmin: true,
    isAdmin: true,
    isScorekeeper: false,
    ...overrides,
  };
}
