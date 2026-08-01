# Bible Bowl

A real-time scoring app for Bible Bowl competitions, built with Next.js and AWS Amplify Gen 2.

## Overview

The app serves three audiences:

- **Viewers** — anyone can watch the live leaderboard at `/` without logging in.
- **Scorekeepers** — scan a QR code to sign in automatically (no password), then enter scores question-by-question at `/scorekeeper`.
- **Admins** — manage teams, users, and the game itself at `/admin`.

## Tech Stack

- **Next.js 16** (App Router, React 19)
- **AWS Amplify Gen 2** backend: Cognito (auth + user groups), AppSync + DynamoDB (data)
- **TypeScript**, **Tailwind CSS v4**, **Prettier**, **ESLint**

## Prerequisites

- Node.js 20+
- An AWS account with the [AWS CLI configured](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-quickstart.html) (`aws configure`)
- A GitHub account (for CI and Amplify Console deployment)

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. In one terminal, start the Amplify sandbox. This provisions a personal Cognito user pool, DynamoDB tables, and an AppSync API in your AWS account, then writes `amplify_outputs.json` automatically:

   ```bash
   npm run sandbox
   ```

   > **Node.js v22+ note:** The `sandbox` script passes `--no-experimental-webstorage` to Node to work around a compatibility issue between Node's experimental Web Storage API and the `@typescript/vfs` package used internally by `ampx`. If you're on Node 18 or 20 you can run `npx ampx sandbox` directly instead.

   Leave this running — it watches `amplify/` for changes and redeploys.

3. In another terminal, start the Next.js dev server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

## First-Time Setup

After the sandbox is running (or after your first deploy), create an admin and seed the game:

1. Promote yourself to a SuperAdmin. This creates the Cognito user (if needed) and adds it to the `SuperAdmins` group:

   ```bash
   npm run seed:admin -- your@email.com --super
   ```

   If the user was newly created, a temporary password is printed to the console.

2. Log in at `/login` and set a permanent password.

3. Go to `/admin/games` to create a game (title + game code).

4. Go to `/admin/games/[slug]/teams` to add the competing church teams.

5. Go to `/admin/games/[slug]/scores` to initialize the game.

## User Roles

- **SuperAdmin** — created via `npm run seed:admin -- your@email.com --super`. Can manage all games and create/delete admin users.
- **Admin** — created via the `seed:admin` script (without `--super`) or in-app at `/admin/users`. Has full access under `/admin`.
- **Scorekeeper** — onboarded via QR code, not sign-up. From `/admin/games/[slug]/users`, an admin generates one QR code per team; scanning it at `/scan?token=...` creates (or reuses) a Cognito account bound to that team and signs the scorekeeper in automatically, with no password to remember. Sign-up is disabled on `/login` — there is no self-registration or team-claiming flow.
- **Viewer** — no login required. The live leaderboard is at `/g/[slug]` for a specific game, or `/` for the list of games.

## Deployment (Amplify Console)

1. Create a new app in the [Amplify Console](https://console.aws.amazon.com/amplify/) and connect it to this GitHub repo.
2. Select `main` as the production branch. Amplify uses `amplify.yml` to deploy the backend and build the frontend automatically on every merge to `main`.

The backend CDK stack creates a scoped IAM user for Cognito admin operations and writes its credentials directly into `amplify_outputs.json` via `backend.addOutput()`. The frontend build picks them up from there — no environment variables need to be set manually in the Console.

## CI/CD

- **GitHub Actions** (`.github/workflows/ci.yml`) runs on every push to a non-`main` branch and on PRs targeting `main`. It checks formatting, lints, type-checks, and builds. The build step copies `amplify_outputs.json.example` to `amplify_outputs.json` so `next build` compiles without a live backend.
- **Amplify Console** deploys the backend and frontend on every merge to `main`.

## Scripts

- `npm run sandbox` — start the Amplify sandbox (Node v22+ compatible)
- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript, no emit
- `npm run format` — format with Prettier
- `npm run format:check` — verify formatting
- `npm run seed:admin -- you@example.com --super` — promote an email to the SuperAdmins group

## Load Testing

`scripts/test-scorekeepers.ts` simulates N concurrent scorekeepers entering scores in parallel to verify the app handles simultaneous writes correctly.

**Setup:**

1. Initialize the game and generate QR codes in the admin panel.
2. Open browser DevTools → Network tab → find the `POST /api/scorekeeper/generate` response → save the full JSON body to a file (e.g. `scripts/tokens.json`).

**Run:**

```bash
npx tsx scripts/test-scorekeepers.ts scripts/tokens.json [--local | --prod]
```

Omit the flag to be prompted for local (`localhost:3000`) or production (`bible.pauldev.io`).

**Flow:**

1. All scorekeepers authenticate in parallel (consumes each QR token — generate fresh codes for each test run).
2. You enter the current question number.
3. All scorekeepers submit a random score (0–3) simultaneously.
4. After each round you can press **Enter** to advance to the next question, type a **question number** to jump to a specific one, or **q** to quit.

> **Note:** Each QR token is single-use. You must regenerate QR codes between test runs.
