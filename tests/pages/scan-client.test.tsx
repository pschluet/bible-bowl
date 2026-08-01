import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { fetchAuthSession, signIn, signOut } from 'aws-amplify/auth';
import { useRouter } from 'next/navigation';

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: vi.fn() }));

const ScanClient = (await import('@/app/scan/ScanClient')).default;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

function sessionWithGroups(groups: string[]) {
  return { tokens: { accessToken: { payload: { 'cognito:groups': groups } } } };
}

describe('ScanClient', () => {
  const router = { replace: vi.fn(), push: vi.fn() };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(useRouter).mockReturnValue(router as never);
    router.replace.mockClear();
    vi.mocked(fetchAuthSession).mockReset();
    vi.mocked(signIn).mockReset();
    vi.mocked(signOut).mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('with no token and no existing session, shows the "scan your QR code" prompt', async () => {
    vi.mocked(fetchAuthSession).mockRejectedValue(new Error('no session'));
    render(<ScanClient token={null} />);
    expect(await screen.findByText('Scan your QR code')).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('with no token but a valid scorekeeper session, redirects straight to /scorekeeper', async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue(sessionWithGroups(['Scorekeepers']) as never);
    render(<ScanClient token={null} />);
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith('/scorekeeper'));
  });

  it.each([
    ['INVALID_TOKEN', 'This QR code is not valid. Please ask the event organizer for a new one.'],
    [
      'TOKEN_ALREADY_USED',
      'This QR code has already been used. Contact the organizer if you need to sign in again.',
    ],
    [
      'TOKEN_EXPIRED',
      'This QR code has expired. Ask the event organizer to regenerate your QR code.',
    ],
  ])('maps exchange error code %s to its friendly message', async (code, friendly) => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(404, { error: code }));
    vi.mocked(fetchAuthSession).mockRejectedValue(new Error('no session')); // redirectIfSignedIn check
    render(<ScanClient token="tok-1" />);
    expect(await screen.findByText(friendly)).toBeInTheDocument();
  });

  it('falls back to the server message for an unrecognized error code', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(500, { error: 'WEIRD', message: 'Something odd.' })
    );
    vi.mocked(fetchAuthSession).mockRejectedValue(new Error('no session'));
    render(<ScanClient token="tok-1" />);
    expect(await screen.findByText('Something odd.')).toBeInTheDocument();
  });

  it('signs out any existing session before signing in as the newly scanned team', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        username: 'team-1@bible-bowl.internal',
        password: 'p',
        teamId: 't1',
        teamName: 'T1',
      })
    );
    vi.mocked(signOut).mockResolvedValue(undefined as never);
    vi.mocked(signIn).mockResolvedValue({} as never);

    render(<ScanClient token="tok-1" />);
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith('/scorekeeper'));

    expect(signOut).toHaveBeenCalled();
    expect(signIn).toHaveBeenCalledWith({
      username: 'team-1@bible-bowl.internal',
      password: 'p',
      options: { authFlowType: 'USER_PASSWORD_AUTH' },
    });
    // signOut must complete before signIn is attempted.
    const signOutOrder = vi.mocked(signOut).mock.invocationCallOrder[0];
    const signInOrder = vi.mocked(signIn).mock.invocationCallOrder[0];
    expect(signOutOrder).toBeLessThan(signInOrder);
  });

  it('treats UserAlreadyAuthenticatedException from signIn as success', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        username: 'team-1@bible-bowl.internal',
        password: 'p',
        teamId: 't1',
        teamName: 'T1',
      })
    );
    vi.mocked(signOut).mockResolvedValue(undefined as never);
    const err = Object.assign(new Error('already authed'), {
      name: 'UserAlreadyAuthenticatedException',
    });
    vi.mocked(signIn).mockRejectedValue(err);

    render(<ScanClient token="tok-1" />);
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith('/scorekeeper'));
  });

  it("runs the exchange only once even under React StrictMode's double-invoke", async () => {
    vi.mocked(fetchAuthSession).mockRejectedValue(new Error('no session'));
    render(
      <StrictMode>
        <ScanClient token={null} />
      </StrictMode>
    );
    await screen.findByText('Scan your QR code');
    // fetchAuthSession is called once per run of the effect body; the ranRef
    // guard should prevent a second full run under StrictMode's double-invoke.
    expect(fetchAuthSession).toHaveBeenCalledTimes(1);
  });
});
