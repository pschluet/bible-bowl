'use client';

/**
 * Client-side scan handler. Receives the raw token string from the server
 * page (which reads searchParams without the Suspense requirement), then:
 *
 *   1. If there's no token, checks for an existing valid scorekeeper session
 *      → redirect to /scorekeeper (returning-user convenience). A token in
 *      the URL always means a fresh scan, so this check is skipped whenever
 *      a token is present — otherwise re-scanning a different team's QR
 *      while already signed in would just bounce back to the old team.
 *   2. Calls POST /api/scorekeeper/exchange with the token.
 *   3. Signs out any existing session, then calls Amplify signIn() with
 *      USER_PASSWORD_AUTH to create a real session for the scanned team.
 *   4. Redirects to /scorekeeper.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, signOut, fetchAuthSession } from 'aws-amplify/auth';

type Stage =
  | 'checking' // checking for an existing session
  | 'signing-in' // exchanging token and calling signIn
  | 'redirecting' // sign-in succeeded
  | 'no-token' // arrived at /scan with no token query param
  | 'error'; // failure with a user-friendly message

const FRIENDLY: Record<string, string> = {
  INVALID_TOKEN: 'This QR code is not valid. Please ask the event organizer for a new one.',
  TOKEN_ALREADY_USED:
    'This QR code has already been used. Contact the organizer if you need to sign in again.',
  TOKEN_EXPIRED: 'This QR code has expired. Ask the event organizer to regenerate your QR code.',
};

export default function ScanClient({ token }: { token: string | null }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('checking');
  const [errorMessage, setErrorMessage] = useState('');
  // Prevents the double-invoke from React Strict Mode (dev) from firing two
  // concurrent exchange requests with the same single-use token, which would
  // cause a password race where the losing signIn call gets NotAuthorizedException.
  const ranRef = useRef(false);

  // Returns true (and redirects) if the current Cognito session is a Scorekeeper.
  // Used as a recovery path: if signIn appears to fail but a session already
  // exists (because the concurrent twin run succeeded), we redirect instead of
  // showing an error.
  async function redirectIfSignedIn(): Promise<boolean> {
    try {
      const s = await fetchAuthSession({ forceRefresh: true });
      const groups =
        (s.tokens?.accessToken?.payload['cognito:groups'] as string[] | undefined) ?? [];
      if (groups.includes('Scorekeepers')) {
        setStage('redirecting');
        router.replace('/scorekeeper');
        return true;
      }
    } catch {
      // No session
    }
    return false;
  }

  useEffect(() => {
    // Guard: only run once per mount, even under React Strict Mode's
    // double-invoke behaviour in dev.
    if (ranRef.current) return;
    ranRef.current = true;

    async function run() {
      // 1. No token in the URL: this isn't a fresh scan. If a valid
      //    scorekeeper session already exists, skip straight to the score
      //    form; otherwise prompt the user to scan a code. (When a token IS
      //    present, we always treat it as a fresh scan and fall through to
      //    the exchange below — even if a different team's session is
      //    already active — so scanning a new team's QR actually switches
      //    teams instead of bouncing back to the old one.)
      if (!token) {
        try {
          const existing = await fetchAuthSession({ forceRefresh: false });
          if (existing.tokens?.accessToken) {
            const groups =
              (existing.tokens.accessToken.payload['cognito:groups'] as string[] | undefined) ?? [];
            if (groups.includes('Scorekeepers')) {
              setStage('redirecting');
              router.replace('/scorekeeper');
              return;
            }
          }
        } catch {
          // No session
        }

        setStage('no-token');
        return;
      }

      setStage('signing-in');

      // 2. Exchange the token for one-time credentials
      let username: string;
      let password: string;
      try {
        const res = await fetch('/api/scorekeeper/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = (await res.json()) as {
          username?: string;
          password?: string;
          error?: string;
          message?: string;
        };

        if (!res.ok) {
          // Before showing an error, check whether a concurrent run already
          // succeeded and stored a valid session (e.g. TOKEN_ALREADY_USED 409).
          if (await redirectIfSignedIn()) return;
          const code = data.error ?? 'UNKNOWN';
          setErrorMessage(
            FRIENDLY[code] ?? data.message ?? 'Sign-in failed. Contact the event organizer.'
          );
          setStage('error');
          return;
        }

        username = data.username!;
        password = data.password!;
      } catch {
        setErrorMessage('Could not reach the server. Check your connection and try again.');
        setStage('error');
        return;
      }

      // 3. Drop any existing session before signing in as the newly scanned
      //    team — otherwise signIn() below would just no-op against the old
      //    (still-valid) session via UserAlreadyAuthenticatedException,
      //    leaving the scorekeeper stuck on the previous team.
      try {
        await signOut();
      } catch {
        // No prior session (or sign-out failed) — proceed to sign in anyway.
      }

      // 4. Sign in with the one-time credential to create a real Cognito session
      try {
        await signIn({
          username,
          password,
          options: { authFlowType: 'USER_PASSWORD_AUTH' },
        });
      } catch (err) {
        const errName = (err as { name?: string }).name;
        // Already authenticated — another concurrent run beat us to it; treat as success.
        if (errName === 'UserAlreadyAuthenticatedException') {
          setStage('redirecting');
          router.replace('/scorekeeper');
          return;
        }
        // For any other error, do a session re-check before giving up — the concurrent
        // run may have succeeded (leaving a valid session) even if this run's password
        // was overwritten.
        console.error('signIn failed:', err);
        if (await redirectIfSignedIn()) return;
        setErrorMessage('Sign-in failed. Contact the event organizer.');
        setStage('error');
        return;
      }

      // 5. Session is now stored in cookies — redirect to the score form
      setStage('redirecting');
      router.replace('/scorekeeper');
    }

    void run();
  }, [token, router]); // eslint-disable-line react-hooks/exhaustive-deps -- redirectIfSignedIn is stable (defined in render scope, no deps that change)

  // ── Render ────────────────────────────────────────────────────────────────

  if (stage === 'redirecting' || stage === 'checking') {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 py-20">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
        <p className="text-sm text-gray-500">
          {stage === 'redirecting' ? 'Signed in! Redirecting…' : 'Checking your session…'}
        </p>
      </div>
    );
  }

  if (stage === 'signing-in') {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 py-20">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
        <p className="text-sm text-gray-500">Signing you in…</p>
      </div>
    );
  }

  if (stage === 'no-token') {
    return (
      <div className="flex min-h-full items-center justify-center px-4 py-20">
        <div className="max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-3 text-4xl">📷</div>
          <h1 className="mb-2 text-lg font-bold text-gray-900">Scan your QR code</h1>
          <p className="text-sm text-gray-500">
            Use your phone camera to scan the QR code provided by the event organizer.
          </p>
        </div>
      </div>
    );
  }

  // stage === 'error'
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-20">
      <div className="max-w-sm rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-3 text-4xl">⚠️</div>
        <h1 className="mb-2 text-lg font-bold text-gray-900">Sign-in failed</h1>
        <p className="text-sm text-gray-600">{errorMessage}</p>
        <p className="mt-4 text-xs text-gray-400">Contact the event organizer for help.</p>
      </div>
    </div>
  );
}
