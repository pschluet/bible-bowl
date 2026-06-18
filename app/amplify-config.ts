'use client';

import { Amplify } from 'aws-amplify';
import outputs from '@/amplify_outputs.json';

// Configure runs at module-eval time on both server (SSR) and client so that
// `generateClient()` calls in page modules never see an unconfigured singleton.
// Server-side Amplify operations still use `createServerRunner` (amplify-server.ts)
// independently; this call does not conflict with it.
Amplify.configure(outputs, { ssr: true });

export default function ConfigureAmplify() {
  return null;
}
