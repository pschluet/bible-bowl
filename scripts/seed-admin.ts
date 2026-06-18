#!/usr/bin/env tsx
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// Load amplify_outputs.json (must exist — run ampx sandbox first)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outputs = require('../amplify_outputs.json');

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run seed:admin -- user@example.com');
  process.exit(1);
}

const client = new CognitoIdentityProviderClient({
  region: outputs.auth.aws_region,
  // Uses default AWS credential chain (AWS profile / env vars)
});

const userPoolId = outputs.auth.user_pool_id;

async function main() {
  console.log(`Promoting ${email} to Admins group in pool ${userPoolId}...`);

  try {
    // Try to create the user first (idempotent if they already exist)
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
        MessageAction: 'SUPPRESS', // Don't send welcome email from seed script
      })
    );
    console.log('User created (or already existed).');
  } catch (err: unknown) {
    const errName = (err as { name?: string }).name;
    if (errName === 'UsernameExistsException') {
      console.log('User already exists, skipping creation.');
    } else {
      throw err;
    }
  }

  await client.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: email,
      GroupName: 'Admins',
    })
  );

  console.log(`✓ ${email} is now in the Admins group.`);
  console.log(
    'They can sign in at /login (they will need to set a password first via Forgot Password if not yet done).'
  );
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
