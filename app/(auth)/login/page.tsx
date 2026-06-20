'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { fetchAuthSession } from 'aws-amplify/auth';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';

const formFields = {
  signUp: {
    email: {
      order: 1,
      isRequired: true,
    },
    password: {
      order: 2,
    },
    confirm_password: {
      order: 3,
    },
  },
};

function RedirectOnAuth() {
  const { authStatus } = useAuthenticator((ctx) => [ctx.authStatus]);
  const router = useRouter();

  useEffect(() => {
    if (authStatus !== 'authenticated') return;

    let cancelled = false;
    (async () => {
      const session = await fetchAuthSession();
      const groups =
        (session.tokens?.accessToken?.payload['cognito:groups'] as string[] | undefined) ?? [];
      if (cancelled) return;
      if (groups.includes('Admins')) {
        router.push('/admin/scores');
      } else {
        router.push('/scorekeeper');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authStatus, router]);

  return null;
}

export default function LoginPage() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-indigo-700">🏆 Bible Bowl</h1>
        <p className="mt-1 text-sm text-gray-500">Scorekeeper &amp; Admin Login</p>
      </div>

      {/* hideSignUp: scorekeepers onboard via QR scan, not self-signup */}
      <Authenticator formFields={formFields} hideSignUp>{() => <RedirectOnAuth />}</Authenticator>

      <p className="mt-6 max-w-xs text-center text-sm text-gray-500">
        Scorekeepers: scan your QR code to sign in.
        Viewers don&apos;t need to log in — go to the{' '}
        <Link href="/" className="text-indigo-600 underline">homepage</Link>.
      </p>
    </main>
  );
}
