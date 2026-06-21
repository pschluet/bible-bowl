/**
 * Shared Cognito admin client and helpers used by QR-onboarding server routes.
 *
 * These utilities are server-only — never import this from a client component.
 */

import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import outputs from '@/amplify_outputs.json';

/**
 * Synthetic email domain used for QR-onboarded scorekeeper Cognito users.
 * The user pool uses email as the login attribute, so team users need an
 * email-format username. We use a non-routable internal domain so no real
 * email is ever sent or expected.
 */
export const SCOREKEEPER_EMAIL_DOMAIN = 'bible-bowl.internal';

/**
 * Returns the Cognito username (synthetic email) for a given team.
 * Pattern: team-<teamId>@bible-bowl.internal
 */
export function scorekeeperUsername(teamId: string): string {
  return `team-${teamId}@${SCOREKEEPER_EMAIL_DOMAIN}`;
}

/** The Cognito user pool ID, read from Amplify outputs. */
export const USER_POOL_ID: string = outputs.auth.user_pool_id;

/**
 * Creates a Cognito admin client using the scoped IAM credentials baked into
 * amplify_outputs.json at deploy time. Throws if the credentials are missing.
 */
export function makeCognitoClient(): CognitoIdentityProviderClient {
  const serverOnly = (outputs as { custom?: { serverOnly?: Record<string, string> } }).custom
    ?.serverOnly;
  const accessKeyId = serverOnly?.cognitoAdminAccessKeyId;
  const secretAccessKey = serverOnly?.cognitoAdminSecretAccessKey;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing serverOnly.cognitoAdminAccessKeyId or cognitoAdminSecretAccessKey in amplify_outputs.json'
    );
  }
  return new CognitoIdentityProviderClient({
    region: outputs.auth.aws_region,
    credentials: { accessKeyId, secretAccessKey },
  });
}
