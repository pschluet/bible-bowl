/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cookies } from 'next/headers';

// `app/lib/auth.ts` calls `CognitoJwtVerifier.create()` at MODULE SCOPE (once
// for the access token, once for the id token), so this mock must be in
// place before the module is ever imported. The factory can't reference
// outer-scope variables (Vitest hoists `vi.mock` above imports), so the
// per-tokenUse verifier registry is declared *inside* the factory and
// exposed as an extra `__verifiers` export the test body can reach back into.
vi.mock('aws-jwt-verify', () => {
  const verifiers: Record<string, { verify: ReturnType<typeof vi.fn> }> = {};
  return {
    CognitoJwtVerifier: {
      create: vi.fn((opts: { tokenUse: string }) => {
        const verifier = { verify: vi.fn() };
        verifiers[opts.tokenUse] = verifier;
        return verifier;
      }),
    },
    __verifiers: verifiers,
  };
});

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

const { getServerSession } = await import('@/app/lib/auth');
const { __verifiers: verifiers } = (await import('aws-jwt-verify')) as unknown as {
  __verifiers: Record<string, { verify: ReturnType<typeof vi.fn> }>;
};

// Matches amplify_outputs.json.example's auth.user_pool_client_id.
const CLIENT_ID = 'exampleclientid000000000';
const PREFIX = `CognitoIdentityServiceProvider.${CLIENT_ID}`;

function makeCookieStore(entries: Record<string, string>) {
  return { get: (name: string) => (name in entries ? { value: entries[name] } : undefined) };
}

function withCookies(username: string, accessToken?: string, idToken?: string) {
  const entries: Record<string, string> = { [`${PREFIX}.LastAuthUser`]: username };
  if (accessToken !== undefined) {
    entries[encodeURIComponent(`${PREFIX}.${username}.accessToken`)] = accessToken;
  }
  if (idToken !== undefined) {
    entries[encodeURIComponent(`${PREFIX}.${username}.idToken`)] = idToken;
  }
  vi.mocked(cookies).mockResolvedValue(makeCookieStore(entries) as never);
}

describe('getServerSession', () => {
  beforeEach(() => {
    verifiers.access.verify.mockReset();
    verifiers.id.verify.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns null when there is no LastAuthUser cookie at all', async () => {
    vi.mocked(cookies).mockResolvedValue(makeCookieStore({}) as never);
    expect(await getServerSession()).toBeNull();
  });

  it('returns null when the access token cookie is missing', async () => {
    withCookies('user@example.com'); // no accessToken
    expect(await getServerSession()).toBeNull();
  });

  it('returns null when the access token fails verification (expired/invalid)', async () => {
    withCookies('user@example.com', 'bad-token');
    verifiers.access.verify.mockRejectedValue(new Error('expired'));
    expect(await getServerSession()).toBeNull();
  });

  it('returns null when a present id token fails verification, even if the access token is valid', async () => {
    withCookies('user@example.com', 'good-access', 'bad-id');
    verifiers.access.verify.mockResolvedValue({ sub: 'u1', 'cognito:groups': ['Admins'] });
    verifiers.id.verify.mockRejectedValue(new Error('bad id token'));
    expect(await getServerSession()).toBeNull();
  });

  it('resolves a SuperAdmin session, with isAdmin also true', async () => {
    withCookies('super@example.com', 'good-access', 'good-id');
    verifiers.access.verify.mockResolvedValue({ sub: 'u1', 'cognito:groups': ['SuperAdmins'] });
    verifiers.id.verify.mockResolvedValue({ email: 'super@example.com' });

    const session = await getServerSession();
    expect(session).toEqual({
      sub: 'u1',
      email: 'super@example.com',
      groups: ['SuperAdmins'],
      isSuperAdmin: true,
      isAdmin: true,
      isScorekeeper: false,
    });
  });

  it('resolves a plain Admin session (isSuperAdmin false, isAdmin true)', async () => {
    withCookies('admin@example.com', 'good-access', 'good-id');
    verifiers.access.verify.mockResolvedValue({ sub: 'u2', 'cognito:groups': ['Admins'] });
    verifiers.id.verify.mockResolvedValue({ email: 'admin@example.com' });

    const session = await getServerSession();
    expect(session?.isSuperAdmin).toBe(false);
    expect(session?.isAdmin).toBe(true);
    expect(session?.isScorekeeper).toBe(false);
  });

  it('resolves a Scorekeeper session', async () => {
    withCookies('team-1@bible-bowl.internal', 'good-access', 'good-id');
    verifiers.access.verify.mockResolvedValue({ sub: 'u3', 'cognito:groups': ['Scorekeepers'] });
    verifiers.id.verify.mockResolvedValue({ email: 'team-1@bible-bowl.internal' });

    const session = await getServerSession();
    expect(session).toMatchObject({ isSuperAdmin: false, isAdmin: false, isScorekeeper: true });
  });

  it('treats no cognito:groups claim as no roles at all', async () => {
    withCookies('nobody@example.com', 'good-access', 'good-id');
    verifiers.access.verify.mockResolvedValue({ sub: 'u4' });
    verifiers.id.verify.mockResolvedValue({ email: 'nobody@example.com' });

    const session = await getServerSession();
    expect(session).toMatchObject({
      groups: [],
      isSuperAdmin: false,
      isAdmin: false,
      isScorekeeper: false,
    });
  });

  it('defaults email to "" when there is no id token at all', async () => {
    withCookies('admin@example.com', 'good-access'); // no idToken
    verifiers.access.verify.mockResolvedValue({ sub: 'u5', 'cognito:groups': ['Admins'] });

    const session = await getServerSession();
    expect(session?.email).toBe('');
    expect(session?.isAdmin).toBe(true);
  });

  it('percent-encodes the @ in the username when looking up the token cookies', async () => {
    // Regression check for jsCookieEncodeName integration: a username with an
    // `@` (every synthetic scorekeeper username) must resolve to a cookie
    // name with a literal `%40`, not a raw `@`.
    const username = 'team-42@bible-bowl.internal';
    vi.mocked(cookies).mockResolvedValue(
      makeCookieStore({
        [`${PREFIX}.LastAuthUser`]: username,
        [`${PREFIX}.team-42%40bible-bowl.internal.accessToken`]: 'good-access',
      }) as never
    );
    verifiers.access.verify.mockResolvedValue({ sub: 'u6', 'cognito:groups': ['Scorekeepers'] });

    const session = await getServerSession();
    expect(session?.isScorekeeper).toBe(true);
  });
});
