#!/usr/bin/env tsx
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomBytes } from 'crypto';

function generateTempPassword(): string {
  // Must satisfy: 8+ chars, uppercase, lowercase, digit, symbol
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => set[randomBytes(1)[0] % set.length];
  const base = Array.from({ length: 8 }, (_, i) =>
    i < 4 ? pick([upper, lower, digits, symbols][i]) : pick(all)
  );
  // Shuffle
  for (let i = base.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base.join('');
}

// Load amplify_outputs.json (must exist — run ampx sandbox first)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outputs = require('../amplify_outputs.json');

// Usage: npm run seed:admin -- user@example.com [--super]
const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'));
const isSuperAdmin = args.includes('--super');

if (!email) {
  console.error('Usage: npm run seed:admin -- user@example.com [--super]');
  console.error('  --super  Add to SuperAdmins group instead of Admins');
  process.exit(1);
}

const client = new CognitoIdentityProviderClient({
  region: outputs.auth.aws_region,
  // Uses default AWS credential chain (AWS profile / env vars)
});

const userPoolId = outputs.auth.user_pool_id;
const groupName = isSuperAdmin ? 'SuperAdmins' : 'Admins';

async function main() {
  console.log(`Promoting ${email} to ${groupName} group in pool ${userPoolId}...`);

  let tempPassword: string | undefined;

  try {
    // Try to create the user first (idempotent if they already exist)
    tempPassword = generateTempPassword();
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
        TemporaryPassword: tempPassword,
        MessageAction: 'SUPPRESS', // Don't send welcome email — temp password is printed below
      })
    );
    console.log('User created.');
  } catch (err: unknown) {
    const errName = (err as { name?: string }).name;
    if (errName === 'UsernameExistsException') {
      console.log('User already exists, skipping creation.');
      tempPassword = undefined;
    } else {
      throw err;
    }
  }

  await client.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: email,
      GroupName: groupName,
    })
  );

  console.log(`✓ ${email} is now in the ${groupName} group.`);
  if (isSuperAdmin) {
    console.log('Super admins can manage all games and create/delete admin users.');
  }
  if (tempPassword) {
    console.log(`\nTemporary password: ${tempPassword}`);
    console.log('Sign in at /login with this password — you will be prompted to set a new one.');
  } else {
    console.log(
      'User already existed; use Forgot Password at /login to set a new password if needed.'
    );
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
