/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import { getServerSession } from '@/app/lib/auth';
import { makeCognitoClient } from '@/app/lib/cognito';
import { makeTeam } from '../support/factories';
import { asAdmin, asAnon, asSuperAdmin } from '../support/session';
import { cognitoError, createFakeCognitoClient } from '../support/cognito-mock';
import type { FakeDataClient } from '../support/amplify-mock';

vi.mock('@/app/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/app/lib/cognito', () => ({
  makeCognitoClient: vi.fn(),
  USER_POOL_ID: 'test-user-pool',
}));
vi.mock('@aws-amplify/adapter-nextjs/data', async () => {
  const { createFakeDataClient } = await import('../support/amplify-mock');
  const client = createFakeDataClient();
  return {
    generateServerClientUsingCookies: () => client,
    generateServerClientUsingReqRes: () => client,
  };
});

const { GET, POST, DELETE } = await import('@/app/api/admin/users/route');

const client = generateServerClientUsingCookies({} as never) as unknown as FakeDataClient;

function req(method: string, body?: unknown): Request {
  return new Request('http://localhost/api/admin/users', {
    method,
    ...(body !== undefined
      ? {
          body: typeof body === 'string' ? body : JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        }
      : {}),
  });
}

describe('GET /api/admin/users', () => {
  let cognito: ReturnType<typeof createFakeCognitoClient>;

  beforeEach(() => {
    client._resetAll();
    vi.mocked(getServerSession).mockReset();
    cognito = createFakeCognitoClient();
    vi.mocked(makeCognitoClient)
      .mockReset()
      .mockReturnValue(cognito as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns 401 for an anonymous caller', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAnon());
    expect((await GET()).status).toBe(401);
  });

  it('returns 401 for a plain Admin (SuperAdmin required)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin());
    expect((await GET()).status).toBe(401);
  });

  it('returns 500 when the Cognito client cannot be constructed', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin());
    vi.mocked(makeCognitoClient).mockImplementation(() => {
      throw new Error('no creds');
    });
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it('paginates through ListUsersCommand until PaginationToken is exhausted', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin());
    let call = 0;
    cognito.on('ListUsersCommand', () => {
      call++;
      if (call === 1) {
        return { Users: [{ Username: 'a@x.com', Attributes: [] }], PaginationToken: 'page2' };
      }
      return { Users: [{ Username: 'b@x.com', Attributes: [] }], PaginationToken: undefined };
    });
    cognito.on('AdminListGroupsForUserCommand', () => ({ Groups: [] }));

    const res = await GET();
    const body = await res.json();
    expect(body.users.map((u: { username: string }) => u.username).sort()).toEqual([
      'a@x.com',
      'b@x.com',
    ]);
    expect(call).toBe(2);
  });

  it("leaves a user's groups as [] (non-fatal) when AdminListGroupsForUser fails for them", async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin());
    cognito.on('ListUsersCommand', () => ({
      Users: [{ Username: 'a@x.com', Attributes: [{ Name: 'sub', Value: 's1' }] }],
      PaginationToken: undefined,
    }));
    cognito.onError('AdminListGroupsForUserCommand', new Error('boom'));

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.users[0].groups).toEqual([]);
  });

  it('maps email/sub/status attributes and groups onto each user', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin());
    cognito.on('ListUsersCommand', () => ({
      Users: [
        {
          Username: 'admin@x.com',
          UserStatus: 'CONFIRMED',
          Attributes: [
            { Name: 'email', Value: 'admin@x.com' },
            { Name: 'sub', Value: 'sub-1' },
          ],
        },
      ],
      PaginationToken: undefined,
    }));
    cognito.on('AdminListGroupsForUserCommand', () => ({ Groups: [{ GroupName: 'Admins' }] }));

    const res = await GET();
    const body = await res.json();
    expect(body.users[0]).toEqual({
      username: 'admin@x.com',
      email: 'admin@x.com',
      sub: 'sub-1',
      status: 'CONFIRMED',
      groups: ['Admins'],
    });
  });
});

describe('POST /api/admin/users', () => {
  let cognito: ReturnType<typeof createFakeCognitoClient>;

  beforeEach(() => {
    client._resetAll();
    vi.mocked(getServerSession).mockReset();
    cognito = createFakeCognitoClient();
    vi.mocked(makeCognitoClient)
      .mockReset()
      .mockReturnValue(cognito as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns 401 for a plain Admin (SuperAdmin required)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin());
    const res = await POST(req('POST', { email: 'new@x.com' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 on malformed JSON', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin());
    const res = await POST(req('POST', '{not json'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is missing', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin());
    const res = await POST(req('POST', {}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'email is required' });
  });

  it('returns 409 when the email/username already exists', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin());
    cognito.onError('AdminCreateUserCommand', cognitoError('UsernameExistsException'));
    const res = await POST(req('POST', { email: 'existing@x.com' }));
    expect(res.status).toBe(409);
  });

  it('returns 500 on an unexpected Cognito failure', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin());
    cognito.onError('AdminCreateUserCommand', new Error('boom'));
    const res = await POST(req('POST', { email: 'new@x.com' }));
    expect(res.status).toBe(500);
  });

  it('creates the user and adds them to the Admins group on success', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin());
    cognito.on('AdminCreateUserCommand', () => ({}));
    cognito.on('AdminAddUserToGroupCommand', () => ({}));

    const res = await POST(req('POST', { email: 'new@x.com' }));
    expect(res.status).toBe(200);
    const addToGroupCall = cognito.calls.find((c) => c.command === 'AdminAddUserToGroupCommand');
    expect(addToGroupCall?.input).toMatchObject({ Username: 'new@x.com', GroupName: 'Admins' });
  });
});

describe('DELETE /api/admin/users', () => {
  let cognito: ReturnType<typeof createFakeCognitoClient>;

  beforeEach(() => {
    client._resetAll();
    vi.mocked(getServerSession).mockReset();
    cognito = createFakeCognitoClient();
    cognito.on('AdminUserGlobalSignOutCommand', () => ({}));
    cognito.on('AdminDeleteUserCommand', () => ({}));
    vi.mocked(makeCognitoClient)
      .mockReset()
      .mockReturnValue(cognito as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns 401 for a plain Admin (SuperAdmin required)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asAdmin());
    const res = await DELETE(req('DELETE', { username: 'x@y.com' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 on malformed JSON', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin());
    const res = await DELETE(req('DELETE', '{not json'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when username is missing', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin());
    const res = await DELETE(req('DELETE', {}));
    expect(res.status).toBe(400);
  });

  it("blocks self-delete when sub matches the caller's session sub", async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin({ sub: 'my-sub' }));
    const res = await DELETE(req('DELETE', { username: 'me@x.com', sub: 'my-sub' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('You cannot delete your own account.');
  });

  it('blocks self-delete via username/email even when sub is omitted from the request', async () => {
    // Regression test: the guard used to check `sub` alone, which a caller
    // could bypass simply by not sending `sub` in the request body.
    vi.mocked(getServerSession).mockResolvedValue(
      asSuperAdmin({ sub: 'my-sub', email: 'me@x.com' })
    );
    const res = await DELETE(req('DELETE', { username: 'me@x.com' })); // no sub
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('You cannot delete your own account.');
  });

  it('allows deleting a different user with a different sub and username', async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      asSuperAdmin({ sub: 'my-sub', email: 'me@x.com' })
    );
    const res = await DELETE(req('DELETE', { username: 'other@x.com', sub: 'other-sub' }));
    expect(res.status).toBe(200);
  });

  it('returns 500 when the Cognito client cannot be constructed', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin({ sub: 'my-sub' }));
    vi.mocked(makeCognitoClient).mockImplementation(() => {
      throw new Error('no creds');
    });
    const res = await DELETE(req('DELETE', { username: 'other@x.com', sub: 'other-sub' }));
    expect(res.status).toBe(500);
  });

  it('clears the scorekeeperUserId/Email binding on the team assigned to this sub (best-effort)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin({ sub: 'my-sub' }));
    await client.models.Team.create(
      makeTeam({ id: 't1', scorekeeperUserId: 'other-sub', scorekeeperEmail: 'other@x.com' })
    );
    const res = await DELETE(req('DELETE', { username: 'other@x.com', sub: 'other-sub' }));
    expect(res.status).toBe(200);
    const team = client.models.Team._store.get('t1');
    expect(team?.scorekeeperUserId).toBeNull();
    expect(team?.scorekeeperEmail).toBeNull();
  });

  it('still deletes the user even if team-binding cleanup fails (non-fatal)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin({ sub: 'my-sub' }));
    await client.models.Team.create(
      makeTeam({ id: 't1', scorekeeperUserId: 'other-sub', scorekeeperEmail: 'other@x.com' })
    );
    client.models.Team._failNext('update', { message: 'boom' });
    const res = await DELETE(req('DELETE', { username: 'other@x.com', sub: 'other-sub' }));
    expect(res.status).toBe(200);
  });

  it('still deletes the user even if AdminUserGlobalSignOut fails (non-fatal)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin({ sub: 'my-sub' }));
    cognito.onError('AdminUserGlobalSignOutCommand', new Error('already signed out'));
    const res = await DELETE(req('DELETE', { username: 'other@x.com', sub: 'other-sub' }));
    expect(res.status).toBe(200);
  });

  it('returns 500 "Failed to delete user" when AdminDeleteUser fails (fatal)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(asSuperAdmin({ sub: 'my-sub' }));
    cognito.onError('AdminDeleteUserCommand', new Error('boom'));
    const res = await DELETE(req('DELETE', { username: 'other@x.com', sub: 'other-sub' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to delete user');
  });
});
