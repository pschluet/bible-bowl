import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';

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

/**
 * CloudFormation outputs — after the first deployment, run:
 *   aws cloudformation describe-stacks \
 *     --stack-name amplify-<appId>-<branch>-BibleBowlAdminStack \
 *     --query 'Stacks[0].Outputs'
 *
 * Then set the values as environment variables in the Amplify Console:
 *   COGNITO_ADMIN_ACCESS_KEY_ID  → CognitoAdminAccessKeyId output value
 *   COGNITO_ADMIN_SECRET_ACCESS_KEY → CognitoAdminSecretKey output value
 *
 * These outputs are only visible to IAM principals with CloudFormation access.
 */
new cdk.CfnOutput(adminStack, 'CognitoAdminAccessKeyId', {
  value: accessKey.ref,
  description:
    'Set as COGNITO_ADMIN_ACCESS_KEY_ID in Amplify Console → Hosting → Environment Variables',
});

new cdk.CfnOutput(adminStack, 'CognitoAdminSecretKey', {
  value: accessKey.attrSecretAccessKey,
  description:
    'Set as COGNITO_ADMIN_SECRET_ACCESS_KEY in Amplify Console → Hosting → Environment Variables',
});
