/**
 * @vitest-environment node
 *
 * app/admin/layout.tsx is an async Server Component — RTL can't meaningfully
 * render it (and Next's own docs say async Server Components aren't
 * supported by Vitest; use E2E for those). Since its only real logic is the
 * admin gate, this calls it directly as a function and asserts on
 * `redirect()`, matching how the route module actually behaves: `redirect()`
 * throws to halt rendering, so a mock that also throws lets us assert both
 * "redirected" (via the throw) and the exact target URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { getServerSession } from '@/app/lib/auth';
import { asAdmin, asAnon, asScorekeeper } from '../support/session';

vi.mock('@/app/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
// AdminNav pulls in next/navigation hooks and aws-amplify/auth; stub it out
// since this test only cares about the layout's own redirect gate.
vi.mock('@/app/components/AdminNav', () => ({ default: () => null }));

const AdminLayout = (await import('@/app/admin/layout')).default;

describe('AdminLayout', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockReset();
    vi.mocked(redirect).mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('redirects to /login?redirect=/admin/games when there is no session', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAnon());
    await expect(AdminLayout({ children: null })).rejects.toThrow('NEXT_REDIRECT:');
    expect(redirect).toHaveBeenCalledWith('/login?redirect=/admin/games');
  });

  it('redirects a Scorekeeper (non-admin) the same way', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asScorekeeper());
    await expect(AdminLayout({ children: null })).rejects.toThrow('NEXT_REDIRECT:');
    expect(redirect).toHaveBeenCalledWith('/login?redirect=/admin/games');
  });

  it('does not redirect an Admin session', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin());
    await expect(AdminLayout({ children: null })).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
