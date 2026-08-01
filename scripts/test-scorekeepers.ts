#!/usr/bin/env tsx
/**
 * Bible Bowl Scorekeeper Load Test
 *
 * Simulates N concurrent scorekeepers entering scores — one per QR token —
 * to verify the app handles parallel writes correctly.
 *
 * Usage:
 *   npx tsx scripts/test-scorekeepers.ts <tokens-file> [--local | --prod]
 *
 * tokens-file: the full JSON response body from POST /api/scorekeeper/generate,
 *   saved as a .json file. Also accepts plain text (one token ID or scan URL per line).
 *
 * How to get the tokens JSON:
 *   1. Open the admin panel → Teams → Generate QR Codes
 *   2. Open browser DevTools → Network tab
 *   3. Find the POST to /api/scorekeeper/generate
 *   4. Copy the full response body and paste it into a .json file
 */

import * as fs from 'node:fs';
import * as https from 'node:https';
import * as http from 'node:http';
import * as readline from 'node:readline';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { jsCookieEncodeName } from '../app/lib/cookie-names';

// ── Environment config ────────────────────────────────────────────────────────

const ENVS = {
  local: {
    label: 'localhost:3000',
    baseUrl: 'http://localhost:3000',
    userPoolId: 'us-east-2_gilzf0dHQ',
    clientId: '6g6o3lik6pa7qtq09ev9620pbl',
    region: 'us-east-2',
  },
  prod: {
    label: 'bible.pauldev.io',
    baseUrl: 'https://bible.pauldev.io',
    userPoolId: 'us-east-2_YAmo3d85g',
    clientId: '58g678dgk53c5o91pihv9j41me',
    region: 'us-east-2',
  },
} as const;

type Env = (typeof ENVS)[keyof typeof ENVS];

// ── Types ─────────────────────────────────────────────────────────────────────

interface Session {
  tokenId: string;
  username: string;
  teamId: string;
  teamName: string;
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

// ── HTTP helper (uses Node.js http/https — full Cookie header control) ────────

function httpRequest(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;
    const bodyStr = JSON.stringify(body);

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr).toString(),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk: string) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data: raw });
          }
        });
      }
    );

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── Amplify cookie builder ────────────────────────────────────────────────────
// The Amplify Next.js adapter looks up cookie names via ensureEncodedForJSCookie,
// which mirrors how js-cookie encodes names on the client. Characters like `@`
// in the username become `%40` in the cookie name on the wire. The LastAuthUser
// value is stored and read as the raw username (@ stays literal in values).
// Sources:
//   node_modules/@aws-amplify/adapter-nextjs/dist/cjs/utils/cookie/ensureEncodedForJSCookie.js
//   node_modules/@aws-amplify/adapter-nextjs/dist/cjs/utils/createCookieStorageAdapterFromNextServerContext.js
//   node_modules/js-cookie/dist/js.cookie.js

function buildCookieHeader(
  clientId: string,
  username: string,
  accessToken: string,
  idToken: string,
  refreshToken: string
): string {
  const p = `CognitoIdentityServiceProvider.${clientId}`;
  // LastAuthUser has no special chars in the key — value is the raw username (@ not encoded)
  // Token keys contain the username which has @, so the key name must be encoded
  return [
    `${p}.LastAuthUser=${username}`,
    `${jsCookieEncodeName(`${p}.${username}.accessToken`)}=${accessToken}`,
    `${jsCookieEncodeName(`${p}.${username}.idToken`)}=${idToken}`,
    `${jsCookieEncodeName(`${p}.${username}.refreshToken`)}=${refreshToken}`,
  ].join('; ');
}

// ── readline helpers ──────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

// ── Token file parser ─────────────────────────────────────────────────────────
// Accepts either:
//   • The full JSON response from POST /api/scorekeeper/generate
//     { "tokens": [{ "tokenId": "...", "teamName": "...", ... }] }
//   • Plain text — one token ID or /scan?token=<uuid> URL per line

interface TokenEntry {
  tokenId: string;
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTokensFile(raw: string): string[] {
  // Try JSON first
  try {
    const parsed = JSON.parse(raw) as { tokens?: TokenEntry[] };
    if (Array.isArray(parsed.tokens)) {
      return parsed.tokens.map((t) => t.tokenId).filter(Boolean);
    }
  } catch {
    // Not JSON — fall through to plain-text parsing
  }

  // Plain text: one UUID or scan URL per line
  return raw
    .split('\n')
    .map((line) => {
      const s = line.trim();
      if (!s) return '';
      if (s.includes('token=')) {
        try {
          return new URL(s).searchParams.get('token') ?? s;
        } catch {
          // return as-is
        }
      }
      return s;
    })
    .filter(Boolean);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const tokensFile = args.find((a) => !a.startsWith('--'));
  const forceLocal = args.includes('--local');
  const forceProd = args.includes('--prod');

  if (!tokensFile) {
    console.error('Usage: npx tsx scripts/test-scorekeepers.ts <tokens-file> [--local | --prod]');
    process.exit(1);
  }

  // Read token file
  let raw: string;
  try {
    raw = fs.readFileSync(tokensFile, 'utf-8');
  } catch {
    console.error(`Could not read file: ${tokensFile}`);
    process.exit(1);
  }

  const tokenIds = parseTokensFile(raw);
  if (tokenIds.length === 0) {
    console.error('No tokens found in file.');
    process.exit(1);
  }

  // Choose environment
  let env: Env;
  if (forceLocal) {
    env = ENVS.local;
  } else if (forceProd) {
    env = ENVS.prod;
  } else {
    const choice = await ask(
      'Test local (localhost:3000) or production (bible.pauldev.io)? [local/prod]: '
    );
    env = choice.toLowerCase().startsWith('p') ? ENVS.prod : ENVS.local;
  }

  console.log('');
  console.log('Bible Bowl Load Test');
  console.log('====================');
  console.log('Before we start, make sure:');
  console.log('  1. The game has been initialized  (admin panel → Scores → "Initialize Game")');
  console.log('  2. QR codes have been generated   (admin panel → Teams → "Generate QR Codes")');
  console.log("  3. You've noted the current question number");
  console.log('');
  console.log(`Target : ${env.baseUrl}`);
  console.log(`Tokens : ${tokenIds.length} loaded from ${tokensFile}`);
  console.log('');

  // ── Phase 1: Authenticate all scorekeepers ───────────────────────────────

  console.log(`Authenticating ${tokenIds.length} scorekeepers…`);
  console.log('');

  const cognitoClient = new CognitoIdentityProviderClient({ region: env.region });

  // Real scorekeepers scan their QR codes as they arrive and sit down — over
  // roughly a minute, not all in the same instant. Firing every exchange
  // request in the same tick is an artificial burst that can overrun a local
  // dev server's TCP accept backlog (unrelated to app correctness), so spread
  // exchange requests across a window instead. Score submissions in Phase 3
  // are NOT staggered — those intentionally simulate a true simultaneous burst.
  const AUTH_STAGGER_WINDOW_MS = 4000;

  const authResults = await Promise.allSettled(
    tokenIds.map(async (tokenId): Promise<Session> => {
      await sleep(Math.random() * AUTH_STAGGER_WINDOW_MS);

      // Exchange QR token for one-time Cognito credentials
      const exchangeRes = await httpRequest(`${env.baseUrl}/api/scorekeeper/exchange`, 'POST', {
        token: tokenId,
      });

      if (exchangeRes.status !== 200) {
        const d = exchangeRes.data as { error?: string; message?: string };
        throw new Error(d.message ?? d.error ?? `exchange failed (HTTP ${exchangeRes.status})`);
      }

      const { username, password, teamId, teamName } = exchangeRes.data as {
        username: string;
        password: string;
        teamId: string;
        teamName: string;
      };

      // Sign in with Cognito USER_PASSWORD_AUTH to get JWT tokens
      const authRes = await cognitoClient.send(
        new InitiateAuthCommand({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: env.clientId,
          AuthParameters: { USERNAME: username, PASSWORD: password },
        })
      );

      const tokens = authRes.AuthenticationResult;
      if (!tokens?.AccessToken || !tokens.IdToken || !tokens.RefreshToken) {
        throw new Error('Cognito returned incomplete tokens');
      }

      return {
        tokenId,
        username,
        teamId,
        teamName,
        accessToken: tokens.AccessToken,
        idToken: tokens.IdToken,
        refreshToken: tokens.RefreshToken,
      };
    })
  );

  const sessions: Session[] = [];

  for (let i = 0; i < authResults.length; i++) {
    const r = authResults[i];
    if (r.status === 'fulfilled') {
      sessions.push(r.value);
      console.log(`  ✓ ${r.value.teamName}`);
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.log(`  ✗ token ${tokenIds[i].slice(0, 8)}… — ${msg}`);
    }
  }

  console.log('');
  console.log(`${sessions.length} / ${tokenIds.length} scorekeepers authenticated.`);

  if (sessions.length === 0) {
    console.log('');
    console.log('No sessions established. Common causes:');
    console.log('  • Tokens already used  — generate fresh QR codes and try again');
    console.log('  • Tokens expired       — generate fresh QR codes and try again');
    console.log('  • App not reachable    — check the target URL above');
    rl.close();
    process.exit(1);
  }

  // ── Phase 2: Get starting question ──────────────────────────────────────

  console.log('');
  console.log('Authentication complete.');
  console.log('');
  console.log('Go to the admin panel and confirm the game is on the question you want to test.');

  const qInput = await ask('Enter the current question number: ');
  let currentQuestion = parseInt(qInput, 10);
  if (isNaN(currentQuestion) || currentQuestion < 1) {
    currentQuestion = 1;
    console.log('Invalid input — defaulting to question 1.');
  }

  // ── Phase 3: Scoring loop ────────────────────────────────────────────────

  let round = 1;

  while (true) {
    console.log('');
    console.log(
      `─── Round ${round}  ·  Question ${currentQuestion}  ·  ${sessions.length} scorekeepers ───`
    );
    console.log('');

    const scoreResults = await Promise.allSettled(
      sessions.map(async (session) => {
        const points = Math.floor(Math.random() * 4) as 0 | 1 | 2 | 3;
        const cookie = buildCookieHeader(
          env.clientId,
          session.username,
          session.accessToken,
          session.idToken,
          session.refreshToken
        );

        const res = await httpRequest(
          `${env.baseUrl}/api/scorekeeper/score`,
          'POST',
          { teamId: session.teamId, questionNumber: currentQuestion, points },
          { Cookie: cookie }
        );

        if (res.status === 200) {
          return { session, points };
        }

        const d = res.data as { error?: string; message?: string };
        const label = d.message ?? d.error ?? `HTTP ${res.status}`;
        throw Object.assign(new Error(label), { session });
      })
    );

    let succeeded = 0;
    let failed = 0;

    for (const r of scoreResults) {
      if (r.status === 'fulfilled') {
        succeeded++;
        console.log(`  ✓ ${r.value.session.teamName.padEnd(30)} scored ${r.value.points} pts`);
      } else {
        failed++;
        const err = r.reason as Error & { session?: Session };
        const name = (err.session?.teamName ?? '?').padEnd(30);
        console.log(`  ✗ ${name} ${err.message}`);
      }
    }

    console.log('');
    console.log(`  Result: ${succeeded} succeeded, ${failed} failed`);
    console.log('');
    const input = await ask(
      `Next question [Enter = Q${currentQuestion + 1}, or enter a number, or 'q' to quit]: `
    );

    if (input.toLowerCase() === 'q' || input.toLowerCase() === 'quit') {
      break;
    }

    const parsed = parseInt(input, 10);
    currentQuestion = !isNaN(parsed) && parsed >= 1 ? parsed : currentQuestion + 1;
    round++;
  }

  console.log('');
  console.log('Load test complete. Goodbye!');
  rl.close();
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
