'use client';

import { Amplify } from 'aws-amplify';
import outputs from '@/amplify_outputs.json';

// `Amplify.configure()` must run in browser context only.
// Server-side Amplify operations use `createServerRunner` (app/lib/amplify-server.ts)
// independently — they do NOT depend on this call.
// Guarding here prevents the configure from running during Next.js
// static pre-render (which uses Node.js, not a browser) and avoids
// "Cannot convert undefined or null to object" errors from the Amplify
// SDK when initialized with stub/example outputs during CI builds.
if (typeof window !== 'undefined') {
  Amplify.configure(outputs, { ssr: true });
}

export default function ConfigureAmplify() {
  return null;
}
