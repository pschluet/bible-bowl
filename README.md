# Bible Bowl

A real-time scoring app for Bible Bowl competitions, built with Next.js and AWS Amplify Gen 2.

## Overview

The app serves three audiences:

- **Viewers** — anyone can watch the live leaderboard at `/` without logging in.
- **Scorekeepers** — sign in, claim a team, and enter scores question-by-question at `/scorekeeper`.
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
   npx ampx sandbox
   ```

   Leave this running — it watches `amplify/` for changes and redeploys.

3. In another terminal, start the Next.js dev server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

## First-Time Setup

After the sandbox is running (or after your first deploy), create an admin and seed the game:

1. Promote yourself to an admin. This creates the Cognito user (if needed) and adds it to the `Admins` group:

   ```bash
   npm run seed:admin -- your@email.com
   ```

   If the user was newly created, check your email for a temporary password.

2. Log in at `/login` and set a permanent password.

3. Go to `/admin/teams` to add the competing church teams.

4. Go to `/admin/scores` to initialize the game.

## User Roles

- **Admin** — created via the `seed:admin` script or in-app at `/admin/users`. Has full access under `/admin`.
- **Scorekeeper** — can self-register at `/login` (sign up), then claim an unclaimed team at `/scorekeeper`. Claiming is first-come-first-served. Admins can also pre-create scorekeepers via `/admin/users` and assign them a team.
- **Viewer** — no login required. The live leaderboard is at `/`.

## Deployment (Amplify Console)

1. Create a new app in the [Amplify Console](https://console.aws.amazon.com/amplify/) and connect it to this GitHub repo.
2. Select `main` as the production branch. Amplify uses `amplify.yml` to deploy the backend and build the frontend automatically on every merge to `main`.
3. After the first deploy, retrieve the Cognito admin IAM credentials that the backend stack outputs. These are used by the in-app admin user-creation route:

   ```bash
   aws cloudformation describe-stacks \
     --stack-name amplify-<APP_ID>-main-BibleBowlAdminStack \
     --query 'Stacks[0].Outputs' \
     --output table
   ```

4. In **Amplify Console → Hosting → Environment Variables**, add:
   - `COGNITO_ADMIN_ACCESS_KEY_ID` = the `CognitoAdminAccessKeyId` output value
   - `COGNITO_ADMIN_SECRET_ACCESS_KEY` = the `CognitoAdminSecretKey` output value

5. Redeploy. These variables are required for creating users through the app at `/admin/users`.

## CI/CD

- **GitHub Actions** (`.github/workflows/ci.yml`) runs on every push to a non-`main` branch and on PRs targeting `main`. It checks formatting, lints, type-checks, and builds. The build step copies `amplify_outputs.json.example` to `amplify_outputs.json` so `next build` compiles without a live backend.
- **Amplify Console** deploys the backend and frontend on every merge to `main`.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript, no emit
- `npm run format` — format with Prettier
- `npm run format:check` — verify formatting
- `npm run seed:admin -- you@example.com` — promote an email to the Admins group
