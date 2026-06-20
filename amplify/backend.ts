import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import * as iam from 'aws-cdk-lib/aws-iam';

const backend = defineBackend({ auth, data });

/**
 * Custom stack: scoped IAM user for server-side Cognito admin operations.
 *
 * The Next.js SSR compute role (Amplify Hosting) cannot be directly modified
 * from this CDK stack. Instead, we create a minimal-permission IAM user whose
 * credentials are set as Amplify Hosting environment variables (one-time step
 * documented in README.md).
 *
 * The server routes (app/api/admin/users and app/api/teams/claim) read
 * COGNITO_ADMIN_ACCESS_KEY_ID and COGNITO_ADMIN_SECRET_ACCESS_KEY from env.
 *
 * Permissions are scoped to THIS user pool only.
 */
const adminStack = backend.createStack('BibleBowlAdminStack');

// No explicit userName — CDK generates one from the stack name (which includes
// the Amplify app ID and branch), so sandbox and production don't collide.
const cognitoAdminUser = new iam.User(adminStack, 'CognitoAdminUser');

cognitoAdminUser.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'CognitoAdminOperations',
    effect: iam.Effect.ALLOW,
    actions: [
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:AdminRemoveUserFromGroup',
      'cognito-idp:AdminListGroupsForUser',
      'cognito-idp:AdminSetUserPassword',
      'cognito-idp:AdminGetUser',
      'cognito-idp:ListUsers',
    ],
    resources: [backend.auth.resources.userPool.userPoolArn],
  })
);

const accessKey = new iam.CfnAccessKey(adminStack, 'CognitoAdminAccessKey', {
  userName: cognitoAdminUser.userName,
  status: 'Active',
});

// Bake credentials into amplify_outputs.json so the SSR Lambda can read them
// at runtime. The serverOnly block is stripped before the config reaches
// the browser (see app/layout.tsx), so these never appear in client bundles.
backend.addOutput({
  custom: {
    serverOnly: { // not exposed to the browser
      cognitoAdminAccessKeyId: accessKey.ref,
      cognitoAdminSecretAccessKey: accessKey.attrSecretAccessKey,
    },
  },
});
