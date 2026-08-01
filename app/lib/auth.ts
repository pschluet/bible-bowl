import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { cookies } from 'next/headers';
import outputs from '@/amplify_outputs.json';
import { jsCookieEncodeName } from '@/app/lib/cookie-names';

export interface ServerSession {
  sub: string;
  email: string;
  groups: string[];
  isSuperAdmin: boolean;
  isAdmin: boolean; // true for both Admins and SuperAdmins
  isScorekeeper: boolean;
}

// Module-level singletons — JWKS is fetched once on first verify() call and
// cached for the process lifetime, so concurrent requests share the same keys.
const accessVerifier = CognitoJwtVerifier.create({
  userPoolId: outputs.auth.user_pool_id,
  tokenUse: 'access',
  clientId: outputs.auth.user_pool_client_id,
});

const idVerifier = CognitoJwtVerifier.create({
  userPoolId: outputs.auth.user_pool_id,
  tokenUse: 'id',
  clientId: outputs.auth.user_pool_client_id,
});

/**
 * Validates the Cognito session from cookies using local JWT verification.
 * Makes zero Cognito API calls — safe under any level of concurrent load.
 * Returns null if not authenticated or if the token is invalid/expired.
 *
 * Roles:
 *  - isSuperAdmin: in the SuperAdmins Cognito group
 *  - isAdmin: in Admins OR SuperAdmins (super admins have all admin abilities)
 *  - isScorekeeper: in the Scorekeepers group
 */
export async function getServerSession(): Promise<ServerSession | null> {
  try {
    const cookieStore = await cookies();
    const clientId = outputs.auth.user_pool_client_id;
    const prefix = `CognitoIdentityServiceProvider.${clientId}`;

    const username = cookieStore.get(`${prefix}.LastAuthUser`)?.value;
    if (!username) return null;

    const accessTokenStr = cookieStore.get(
      jsCookieEncodeName(`${prefix}.${username}.accessToken`)
    )?.value;
    if (!accessTokenStr) return null;

    const idTokenStr = cookieStore.get(jsCookieEncodeName(`${prefix}.${username}.idToken`))?.value;

    const [accessPayload, idPayload] = await Promise.all([
      accessVerifier.verify(accessTokenStr),
      idTokenStr ? idVerifier.verify(idTokenStr) : Promise.resolve(null),
    ]);

    const sub = accessPayload.sub as string;
    const groups = (accessPayload['cognito:groups'] as string[]) ?? [];
    const email = (idPayload?.email as string) ?? '';

    const isSuperAdmin = groups.includes('SuperAdmins');

    return {
      sub,
      email,
      groups,
      isSuperAdmin,
      // Super admins inherit all admin abilities
      isAdmin: isSuperAdmin || groups.includes('Admins'),
      isScorekeeper: groups.includes('Scorekeepers'),
    };
  } catch {
    return null;
  }
}
