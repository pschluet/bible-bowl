'use client';

import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { CookieStorage } from 'aws-amplify/utils';

// The config prop is built server-side in layout.tsx with the `custom` block
// (which contains IAM credentials) stripped out, so secrets never reach the
// client bundle. generateClient() handles being called before configure() by
// listening for the Hub configure event and rebuilding then.
export default function ConfigureAmplify({ config }: { config: Record<string, unknown> }) {
  Amplify.configure(config as never, { ssr: true });
  // Amplify's SSR cookie storage defaults to `secure: true` unconditionally, which
  // browsers silently refuse to write outside a secure context. `localhost` gets a
  // browser exception for this, but a plain-HTTP LAN IP (e.g. testing from a phone)
  // does not, so sign-in would appear to succeed while no session cookie is ever set.
  cognitoUserPoolsTokenProvider.setKeyValueStorage(
    new CookieStorage({
      sameSite: 'lax',
      secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
    })
  );
  return null;
}
