import { createServerRunner } from '@aws-amplify/adapter-nextjs';
import outputs from '@/amplify_outputs.json';

/**
 * Server runner for Next.js App Router.
 * Use `runWithAmplifyServerContext` in Server Components and Route Handlers
 * to make authenticated Amplify API calls with the user's session cookies.
 */
export const { runWithAmplifyServerContext } = createServerRunner({
  config: outputs,
});
