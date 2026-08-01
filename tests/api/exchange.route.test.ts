/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import { makeCognitoClient } from '@/app/lib/cognito';
import { makeTeam, makeToken } from '../support/factories';
import { cognitoError, createFakeCognitoClient } from '../support/cognito-mock';
import type { FakeDataClient } from '../support/amplify-mock';

vi.mock('@aws-amplify/adapter-nextjs/data', async () => {
  const { createFakeDataClient } = await import('../support/amplify-mock');
  const client = createFakeDataClient();
  return {
    generateServerClientUsingCookies: () => client,
    generateServerClientUsingReqRes: () => client,
  };
});

vi.mock('@/app/lib/cognito', () => ({
  makeCognitoClient: vi.fn(),
  scorekeeperUsername: (teamId: string) => `team-${teamId}@bible-bowl.internal`,
  USER_POOL_ID: 'test-user-pool',
}));

const { POST } = await import('@/app/api/scorekeeper/exchange/route');

const client = generateServerClientUsingCookies({} as never) as unknown as FakeDataClient;

function req(body: unknown): Request {
  return new Request('http://localhost/api/scorekeeper/exchange', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/scorekeeper/exchange', () => {
  let cognito: ReturnType<typeof createFakeCognitoClient>;

  beforeEach(() => {
    client._resetAll();
    cognito = createFakeCognitoClient();
    vi.mocked(makeCognitoClient)
      .mockReset()
      .mockReturnValue(cognito as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns 400 on malformed JSON', async () => {
    const res = await POST(req('{not json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when token is missing', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'token is required' });
  });

  it('returns 404 INVALID_TOKEN when the token does not exist', async () => {
    const res = await POST(req({ token: 'unknown-token' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('INVALID_TOKEN');
  });

  it('returns 409 TOKEN_ALREADY_USED for a CONSUMED token', async () => {
    await client.models.OnboardingToken.create(makeToken({ tokenId: 'tok-1', status: 'CONSUMED' }));
    const res = await POST(req({ token: 'tok-1' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('TOKEN_ALREADY_USED');
  });

  it('returns 410 TOKEN_EXPIRED for a token past its expiresAt', async () => {
    await client.models.OnboardingToken.create(
      makeToken({ tokenId: 'tok-1', status: 'UNUSED', expiresAt: '2000-01-01T00:00:00.000Z' })
    );
    const res = await POST(req({ token: 'tok-1' }));
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe('TOKEN_EXPIRED');
  });

  it('marks the token CONSUMED before doing any Cognito work, even if a later step fails', async () => {
    // No Team row exists for this token's teamId — the route will 404 at the
    // team-resolution step, which comes AFTER the consume-write.
    await client.models.OnboardingToken.create(
      makeToken({ tokenId: 'tok-1', status: 'UNUSED', teamId: 'ghost-team' })
    );
    const res = await POST(req({ token: 'tok-1' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('TEAM_NOT_FOUND');
    expect(client.models.OnboardingToken._store.get('tok-1')?.status).toBe('CONSUMED');
  });

  it('returns 500 when the Cognito client cannot be constructed', async () => {
    vi.mocked(makeCognitoClient).mockImplementation(() => {
      throw new Error('missing credentials');
    });
    await client.models.OnboardingToken.create(makeToken({ tokenId: 'tok-1' }));
    await client.models.Team.create(makeTeam({ id: 'team-1' }));
    const res = await POST(req({ token: 'tok-1' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Server configuration error');
  });

  async function seedTokenAndTeam() {
    await client.models.OnboardingToken.create(
      makeToken({ tokenId: 'tok-1', teamId: 'team-1', status: 'UNUSED' })
    );
    await client.models.Team.create(makeTeam({ id: 'team-1', name: 'Team One' }));
  }

  it('creates a new Cognito user (MessageAction: SUPPRESS) when none exists yet', async () => {
    await seedTokenAndTeam();
    cognito.onError('AdminGetUserCommand', cognitoError('UserNotFoundException'));
    cognito.on('AdminCreateUserCommand', () => ({
      User: { Attributes: [{ Name: 'sub', Value: 'new-sub-1' }] },
    }));
    cognito.on('AdminAddUserToGroupCommand', () => ({}));
    cognito.on('AdminSetUserPasswordCommand', () => ({}));

    const res = await POST(req({ token: 'tok-1' }));
    expect(res.status).toBe(200);
    const createCall = cognito.calls.find((c) => c.command === 'AdminCreateUserCommand');
    expect(createCall?.input).toMatchObject({
      Username: 'team-team-1@bible-bowl.internal',
      MessageAction: 'SUPPRESS',
    });
  });

  it('reuses an existing Cognito user without calling AdminCreateUserCommand', async () => {
    await seedTokenAndTeam();
    cognito.on('AdminGetUserCommand', () => ({
      UserAttributes: [{ Name: 'sub', Value: 'existing-sub' }],
    }));
    cognito.on('AdminAddUserToGroupCommand', () => ({}));
    cognito.on('AdminSetUserPasswordCommand', () => ({}));

    const res = await POST(req({ token: 'tok-1' }));
    expect(res.status).toBe(200);
    expect(cognito.calls.some((c) => c.command === 'AdminCreateUserCommand')).toBe(false);
  });

  it('returns 500 "Failed to look up user" for a non-UserNotFoundException AdminGetUser error', async () => {
    await seedTokenAndTeam();
    cognito.onError('AdminGetUserCommand', cognitoError('SomeOtherException'));
    const res = await POST(req({ token: 'tok-1' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to look up user');
  });

  it('returns 500 "Failed to create user" when AdminCreateUser fails', async () => {
    await seedTokenAndTeam();
    cognito.onError('AdminGetUserCommand', cognitoError('UserNotFoundException'));
    cognito.onError('AdminCreateUserCommand', new Error('boom'));
    const res = await POST(req({ token: 'tok-1' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to create user');
  });

  it('returns 500 "Failed to assign group" when AdminAddUserToGroup fails', async () => {
    await seedTokenAndTeam();
    cognito.on('AdminGetUserCommand', () => ({ UserAttributes: [{ Name: 'sub', Value: 's1' }] }));
    cognito.onError('AdminAddUserToGroupCommand', new Error('boom'));
    const res = await POST(req({ token: 'tok-1' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to assign group');
  });

  it('returns 500 "Failed to set credentials" when AdminSetUserPassword fails', async () => {
    await seedTokenAndTeam();
    cognito.on('AdminGetUserCommand', () => ({ UserAttributes: [{ Name: 'sub', Value: 's1' }] }));
    cognito.on('AdminAddUserToGroupCommand', () => ({}));
    cognito.onError('AdminSetUserPasswordCommand', new Error('boom'));
    const res = await POST(req({ token: 'tok-1' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to set credentials');
  });

  it('on full success, returns credentials and binds the team to the scorekeeper sub', async () => {
    await seedTokenAndTeam();
    cognito.on('AdminGetUserCommand', () => ({
      UserAttributes: [{ Name: 'sub', Value: 'sub-1' }],
    }));
    cognito.on('AdminAddUserToGroupCommand', () => ({}));
    cognito.on('AdminSetUserPasswordCommand', () => ({}));

    const res = await POST(req({ token: 'tok-1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      username: 'team-team-1@bible-bowl.internal',
      teamId: 'team-1',
      teamName: 'Team One',
    });
    // 32 base64url chars + 1 digit + '!' = 34 chars total.
    expect(body.password).toHaveLength(34);
    expect(body.password.endsWith('!')).toBe(true);

    const team = client.models.Team._store.get('team-1');
    expect(team?.scorekeeperUserId).toBe('sub-1');
    expect(team?.scorekeeperEmail).toBe('team-team-1@bible-bowl.internal');
  });

  it('still returns 200 with credentials when the team-binding update is non-fatal-fails', async () => {
    await seedTokenAndTeam();
    cognito.on('AdminGetUserCommand', () => ({
      UserAttributes: [{ Name: 'sub', Value: 'sub-1' }],
    }));
    cognito.on('AdminAddUserToGroupCommand', () => ({}));
    cognito.on('AdminSetUserPasswordCommand', () => ({}));
    client.models.Team._failNext('update', { message: 'transient failure' });

    const res = await POST(req({ token: 'tok-1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.username).toBe('team-team-1@bible-bowl.internal');
  });

  it('handles independent exchanges for two different tokens/teams with no cross-talk', async () => {
    // The client-side "sign out the old scorekeeper session before signing
    // into the new team" behavior lives in ScanClient.tsx, not this route —
    // this just pins that the route itself is stateless per request and has
    // no hidden single-team assumption.
    await client.models.OnboardingToken.create(
      makeToken({ tokenId: 'tok-a', teamId: 'team-a', status: 'UNUSED' })
    );
    await client.models.Team.create(makeTeam({ id: 'team-a', name: 'Team A' }));
    await client.models.OnboardingToken.create(
      makeToken({ tokenId: 'tok-b', teamId: 'team-b', status: 'UNUSED' })
    );
    await client.models.Team.create(makeTeam({ id: 'team-b', name: 'Team B' }));
    cognito.on('AdminGetUserCommand', () => ({
      UserAttributes: [{ Name: 'sub', Value: 'sub-x' }],
    }));
    cognito.on('AdminAddUserToGroupCommand', () => ({}));
    cognito.on('AdminSetUserPasswordCommand', () => ({}));

    const resA = await POST(req({ token: 'tok-a' }));
    const resB = await POST(req({ token: 'tok-b' }));
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect((await resA.json()).teamName).toBe('Team A');
    expect((await resB.json()).teamName).toBe('Team B');
  });
});
