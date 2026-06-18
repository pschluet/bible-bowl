import { fetchAuthSession } from 'aws-amplify/auth/server';
import { cookies } from 'next/headers';
import { runWithAmplifyServerContext } from './amplify-server';

export interface ServerSession {
  sub: string;
  email: string;
  groups: string[];
  isAdmin: boolean;
  isScorekeeper: boolean;
}

/**
 * Retrieves the authenticated user's session from cookies in a server context.
 * Returns `null` if the user is not authenticated or the session is expired.
 *
 * Usage in Server Components and Route Handlers:
 *   const session = await getServerSession();
 *   if (!session?.isAdmin) redirect('/login');
 */
export async function getServerSession(): Promise<ServerSession | null> {
  try {
    return await runWithAmplifyServerContext({
      nextServerContext: { cookies },
      async operation(contextSpec) {
        const session = await fetchAuthSession(contextSpec);

        if (!session.tokens?.accessToken) return null;

        const payload = session.tokens.accessToken.payload;
        const sub = payload.sub as string;
        const email = (session.tokens.idToken?.payload.email as string) ?? '';
        const groups = (payload['cognito:groups'] as string[]) ?? [];

        return {
          sub,
          email,
          groups,
          isAdmin: groups.includes('Admins'),
          isScorekeeper: groups.includes('Scorekeepers'),
        };
      },
    });
  } catch {
    return null;
  }
}
