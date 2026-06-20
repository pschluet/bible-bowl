'use client';

import { Amplify } from 'aws-amplify';

// The config prop is built server-side in layout.tsx with the `custom` block
// (which contains IAM credentials) stripped out, so secrets never reach the
// client bundle. generateClient() handles being called before configure() by
// listening for the Hub configure event and rebuilding then.
export default function ConfigureAmplify({ config }: { config: Record<string, unknown> }) {
  Amplify.configure(config as never, { ssr: true });
  return null;
}
