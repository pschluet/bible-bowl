# Bible Bowl — Requirements & User Stories

This document describes how the Bible Bowl app **actually behaves today**,
derived directly from the source code (not from aspirational specs). It is
meant as the basis for a comprehensive automated test suite. The app
currently has **zero automated tests** — no Jest/Vitest/Playwright
dependency and no `*.test.*`/`*.spec.*` files exist anywhere in the repo.

A companion **[Known Bugs / Issues](#known-bugs--issues-to-fix)** section at
the end lists behavior that looks unintentional. Do not encode those as
"correct" when writing tests — see that section for what to do instead.

> Note: `README.md` says scorekeepers "self-register at `/login` (sign up),
> then claim an unclaimed team." This is **stale documentation** — the
> `Authenticator` on `/login` is rendered with `hideSignUp` (`app/(auth)/login/page.tsx:61`),
> and the only way a scorekeeper account is created is via the QR onboarding
> flow described below. Treat the QR flow as ground truth; see [Bug #10](#known-bugs--issues-to-fix).

---

## 1. Overview

Bible Bowl is a real-time scoring app for church Bible Bowl competitions
(a Scripture-knowledge quiz event). Built with Next.js 16 (App Router,
React 19) and AWS Amplify Gen 2 (Cognito for auth, AppSync + DynamoDB for
data with GraphQL subscriptions for live updates).

## 2. Actors & Roles

| Role | How obtained | Capabilities |
|---|---|---|
| **Viewer** | No login | View the public leaderboard at `/g/[slug]`, view the games list at `/` |
| **Scorekeeper** | Scans a QR code onboarding link (`/scan?token=...`); synthetic Cognito account created automatically, bound to one Team | Submit scores question-by-question for their bound team at `/scorekeeper` |
| **Admin** | Created by a SuperAdmin at `/admin/users`, or via `npm run seed:admin` | Full CRUD on games they own: teams, scores, QR onboarding, scoring on/off, end game, delete game |
| **SuperAdmin** | Created via `npm run seed:admin -- email --super` | Everything an Admin can do, on **any** game (ownership check bypassed); manage all Admin users at `/admin/users` |

Role is derived purely from the `cognito:groups` claim on the verified JWT
access token (`app/lib/auth.ts`) — `isAdmin = SuperAdmins ∪ Admins`,
`isScorekeeper = Scorekeepers`. There is no Next.js middleware; the only
route-level gate is `app/admin/layout.tsx`, which server-redirects
non-admins to `/login`.

## 3. Data Model

### Game
- PK: `slug` (immutable, lowercase alphanumeric + hyphens, 2–64 chars, not a reserved word)
- `title`, `ownerId` (creating admin's Cognito sub)
- `currentQuestion` (int) — the question scorekeepers may currently score
- `maxQuestionReached` (int) — high-water mark; **only ever increases**, even when `currentQuestion` is moved backward
- `scoringOpen` (bool) — `false` = closed; `null`/absent is treated as **open**

### Team
- `gameId` (FK → `Game.slug`), `ownerId` (denormalized), `name`, `groupType` (`Teen` | `PreTeen` | `Adult`, optional), `displayOrder` (int, optional)
- `scorekeeperUserId` / `scorekeeperEmail` — set when a scorekeeper claims the team via QR exchange; cleared on End Game

### Score
- One row per `(teamId, questionNumber)`, enforced by a **deterministic id**: `` `${teamId}#${questionNumber}` `` (`scoreId()` in `app/lib/constants.ts:26`)
- `points` — intended range `{0, 1, 2, 3}`
- A resubmission for the same team+question is an `update`, never a second row

### OnboardingToken
- PK: `tokenId` (UUID v4), `gameId`, `teamId`, `ownerId`, `status` (`UNUSED` | `CONSUMED`), `expiresAt`, `consumedAt`, `batchId`
- One token grants sign-in for exactly one team, once

---

## 4. Functional Requirements & User Stories

### 4.1 Game Creation & Management (`/admin/games`)

**US-1**: As an Admin, I want to create a new game with a title and a
game code (slug), so that I have a dedicated event to manage.
- Slug is auto-derived from the title but editable.
- On submit, the raw slug is normalized (`normalizeSlug`: lowercased, spaces→hyphens, non-`[a-z0-9-]` stripped, hyphens collapsed/trimmed) then validated (`validateSlug`):
  - Required, 2–64 characters
  - Must match `^[a-z0-9][a-z0-9-]*[a-z0-9]$` (or be a single alphanumeric char)
  - Must not be one of the reserved words: `login`, `scan`, `scorekeeper`, `admin`, `api`, `g`
- A duplicate slug returns **409** ("Game code ... is already taken").
- On success the game is created with `currentQuestion: 1`, `scoringOpen: true`, and `ownerId` = the creating admin's sub.

**US-2**: As an Admin, I want to see only the games I own (SuperAdmins see
all games, with the owning admin's email shown), so I can find and manage
my events.

**US-3**: As an Admin, I want to delete a game and have all of its data
cleaned up, so no orphaned data remains.
- Requires confirmation.
- Only the owning Admin or a SuperAdmin may delete (**403** otherwise); **404** if the game doesn't exist.
- Cascade order (`DELETE /api/admin/games`, `maxDuration = 60`): (1) sign out + delete all scorekeeper Cognito accounts bound to the game's teams (best-effort), (2) delete all Score rows, (3) delete all OnboardingToken rows (best-effort, non-fatal), (4) delete all Team rows, (5) delete the Game.
- If step 2 or 4 has any failures, the whole delete returns **500** with a failure count and does **not** proceed to delete the Game — this is intentionally not fully atomic; a partial failure can leave scores/teams behind with the Game still present. Token-delete failures never block progress.

### 4.2 Public Leaderboard (`/g/[slug]`)

**US-4**: As a Viewer, I want to see a live-updating leaderboard for a
game without logging in, so I can follow scores in real time.
- Teams are sorted **descending by total score**, tie-broken alphabetically by name (`app/g/[slug]/page.tsx:198`).
- Grouped into columns by `groupType` in the fixed order Teen → Pre-Teen → Adult, plus an "Other" section (teams with no/unrecognized groupType) always rendered full-width below. Only groups with ≥1 team get a column.
- Within each group, rank badges are 🥇/🥈/🥉 for the first three positions, then a plain number, computed purely from position in the (already-sorted) list (`rankLabel`, `Leaderboard.tsx:24-29`) — see [Bug #1](#known-bugs--issues-to-fix) regarding ties.
- Each team row is expandable to show full question-by-question score history (most recent first); a "latest score" badge shows the most recently answered question.
- A group with more than 3 teams shows only the top 3 rows on mobile / top 5 on desktop until "Show all" is tapped; expanding shows all rows in that group with independent scroll on desktop.
- The header shows "Waiting to start" until the game is initialized, then "Question N" with a pulsing live indicator, tracked via a live Game subscription.
- Visiting a slug with no matching Game renders a **404** (Next.js `notFound()`), triggered only after the Game subscription has completed its initial sync and found zero rows (so a fast 404 doesn't fire before the first live-query snapshot arrives).
- A hamburger menu offers: All Games, Admin (if signed in as Admin/SuperAdmin), Scorekeeper (if signed in as Scorekeeper), Admin Login (if unauthenticated), and Show QR (renders a full-screen QR code encoding the current page URL, for attendees to scan).

**US-5**: As a Viewer, I want to mark a team as my favorite, so I can find
it quickly without scrolling.
- Tapping the star toggles favorite status; favorited team IDs persist in `localStorage` under key `bb_favorite` (as a JSON array; a bare string is also read for backward compatibility with an older single-favorite format).
- Every favorited team gets its own sticky card pinned to the top of the page (above all groups), showing its rank within its own group, independent of how many teams are favorited.
- Score totals update live without a page refresh via GraphQL subscriptions on Team/Score/Game.

### 4.3 Scorekeeper QR Onboarding (`/scan?token=<uuid>`)

**US-6**: As an event organizer, I want to generate one QR code per team,
so that scorekeepers can sign themselves in without a password.
- `POST /api/scorekeeper/generate` (Admin only, owner or SuperAdmin; **403** otherwise): bulk (all teams in the game) or single-team (`teamId` supplied) regeneration.
- Before creating new tokens, all currently-`UNUSED` tokens in the affected scope are marked `CONSUMED` (old QR printouts stop working once new ones are generated).
- New tokens expire **8 hours** from generation time.
- Regenerating for a specific team requires that team belong to the specified game (**400** otherwise); unknown team → **404**.

**US-7**: As a Scorekeeper, I want to scan my team's QR code and be
signed in automatically, so I don't need to remember a password.
- `POST /api/scorekeeper/exchange` (unauthenticated):
  - Unknown `tokenId` → **404** `INVALID_TOKEN`
  - Already `CONSUMED` → **409** `TOKEN_ALREADY_USED`
  - Past `expiresAt` → **410** `TOKEN_EXPIRED`
  - Otherwise: token is immediately marked `CONSUMED` (before any Cognito work, to shrink the race window for a near-simultaneous double-scan), a Cognito user is created if one doesn't already exist for that team (username pattern `team-<teamId>@bible-bowl.internal`), added to the `Scorekeepers` group, given a freshly-generated random permanent password, and the team's `scorekeeperUserId`/`scorekeeperEmail` are bound to that user (non-fatal if this last step fails).
  - Response includes one-time `{ username, password }`, which the client immediately uses to call Amplify `signIn()`.
- If a device already has an active scorekeeper session and scans a **different** team's QR code, the flow explicitly signs out the old session first, so the new team's session replaces it (does not silently keep the old team bound).
- Visiting `/scan` with no `token` param: if a valid Scorekeeper session already exists, redirect straight to `/scorekeeper`; otherwise show a "scan your QR code" prompt.
- Invalid/expired/used-token errors are surfaced with the user-friendly messages defined in `ScanClient.tsx`'s `FRIENDLY` map.

### 4.4 Scorekeeper Score Entry (`/scorekeeper`)

**US-8**: As a Scorekeeper, I want to submit a 0–3 score for the current
question for my team, so the leaderboard updates.
- All scorekeeper score writes go through `POST /api/scorekeeper/score` (never a direct client write) and are validated **in this order**:
  1. Caller must have a valid Scorekeeper session (**401** otherwise).
  2. Body validation: `teamId` required non-empty string, `questionNumber` a positive integer, `points ∈ {0,1,2,3}` (**400** on any violation).
  3. The requested `teamId` must be bound to the caller's Cognito sub (**403** `TEAM_MISMATCH` otherwise) — one scorekeeper session cannot score another team.
  4. `Game.scoringOpen` must not be `false` (**403** `SCORING_CLOSED` if the admin has ended the game).
  5. `questionNumber` must equal `Game.currentQuestion` exactly (**409** `WRONG_QUESTION` — rejects a stale browser tab still showing an old question).
  6. The deterministic Score id makes a second submission for the same team+question **idempotent**: it returns **409** `ALREADY_SCORED` rather than creating a duplicate or overwriting silently.
- Once a score is submitted for the current question, the entry screen shows a confirmation card (the submitted value, "Score submitted ✓") and the button grid is hidden — a scorekeeper cannot change their own submission.
- If an admin deletes that score directly, the scorekeeper's screen returns to the entry buttons automatically (detected via the live `existingScore` prop transitioning to `null`).
- If `Game.currentQuestion` is `null` (game not yet initialized), the screen shows "Waiting for the game to start…" instead of score buttons.

**US-9**: As a Scorekeeper, I want to see a clear "game has ended" screen
if scoring is closed or my session was revoked, so I know not to try to
submit further scores. (`GameEndedView.tsx` — shown when there's no valid
session, e.g. after an admin's "End Game" globally signs the scorekeeper out.)

### 4.5 Admin Score Grid (`/admin/games/[slug]/scores`)

**US-10**: As an Admin, I want to initialize a game, so scoring can begin.
- "Initialize Game" sets `currentQuestion: 1, maxQuestionReached: 1, scoringOpen: true`. Only shown while `currentQuestion` is unset.

**US-11**: As an Admin, I want to move to the next or previous question, so
I control pacing.
- "Next Question": `currentQuestion += 1`; `maxQuestionReached = max(currentQuestion, maxQuestionReached)` — ratchets up only.
- "Previous Question": `currentQuestion -= 1`, disabled/no-op when `currentQuestion <= 1`. Does **not** decrease `maxQuestionReached`, so later columns and their scores remain visible in the grid and CSV export even after navigating back.

**US-12**: As an Admin, I want to enter scores directly in a spreadsheet-style
grid (teams × questions) using mouse or keyboard, so I can score quickly.
- Admin writes go straight to AppSync (not through `/api/scorekeeper/score`) using the same deterministic `scoreId`.
- Keyboard shortcuts: `0`–`3` to score the selected cell, `x` to clear it, arrow keys/Tab to navigate.
- A "Quick Entry" drawer offers a mobile-friendly one-team-at-a-time swipeable flow with the same scoring semantics.
- Optimistic local updates are shown immediately and reconciled against the live subscription by comparing `updatedAt` (latest wins).
- On first sync of the score stream each session, a duplicate-healing pass finds any `(teamId, questionNumber)` with more than one Score row and deletes all but the most-recently-updated one — a defensive cleanup for legacy/race-created duplicates.

**US-13**: As an Admin, I want to export all scores to CSV, so I can archive
or share results outside the app.
- Columns: Team, Type, Q1..Q`maxQuestionReached`, Total. Blank cells for unscored questions. Filename includes a local timestamp.

**US-14**: As an Admin, I want to reset a game's scores and question
progress (keeping teams), so I can rerun or fix a botched event.
- Requires a confirmation dialog.
- Deletes all Score rows for the game (bounded concurrency 20 + retry); if any deletions fail, the whole reset aborts with an error and the game state is **not** reset (partial-failure protection against orphaned scores).
- On full success, resets `currentQuestion: 1, maxQuestionReached: 1, scoringOpen: true`. Teams are preserved.

### 4.6 Team Management (`/admin/games/[slug]/teams`)

**US-15**: As an Admin, I want to add a team with a name and division, so
it appears in the game.
- Name is required (trimmed, non-blank); `displayOrder` is computed client-side as `(max existing displayOrder) + 1`.

**US-16**: As an Admin, I want to bulk-add teams by pasting a roster, so I
don't have to add dozens of teams one at a time.
- Two parallel textareas: names (one per line) and types (one per line).
- **Single-type shortcut**: if the types textarea has exactly one non-blank line, that type applies to every name row.
- Rows where both name and type are blank are silently skipped (not reported as errors).
- Per-row validation errors: `missing team name` (blank name, non-blank type), `missing type` (non-blank name, blank type), `unknown type "X"` (type text doesn't normalize to Teen/PreTeen/Adult, case/space/dash-insensitively — e.g. "Pre Teen", "pre-teen", "PRETEEN" all resolve to `PreTeen`).
- Valid rows are created with bounded concurrency (5) and retry.

**US-17**: As an Admin, I want to rename a team or change its division
inline, so I can fix data entry mistakes.

**US-18**: As an Admin, I want to drag-and-drop reorder teams, so the
display order matches my roster sheet.
- Reordering recomputes `displayOrder` for the affected teams and persists via parallel updates; on failure, the local reorder is rolled back to the previous state.

**US-19**: As an Admin, I want to delete a single team, so I can remove a
no-show.
- Requires confirmation. **Does not delete that team's Score rows** — see [Bug #11](#known-bugs--issues-to-fix).

**US-20**: As an Admin, I want to delete all teams (and their scores) for a
game at once, so I can start over.
- Requires confirmation. Deletes all Score rows for the game first, then all Team rows (explicitly to avoid orphaning scores — the comment in the code notes Team deletion does not auto-cascade Score rows). Reports partial failures without silently succeeding.

### 4.7 Scorekeeper/QR Administration & Game Controls (`/admin/games/[slug]/users`)

**US-21**: As an Admin, I want to view and toggle whether scorekeeper score
entry is open, independent of ending the whole game.
- Toggle flips `Game.scoringOpen`. `scoringOpen !== false` is treated as "enabled" (so `null`/undefined defaults to enabled).

**US-22**: As an Admin, I want to view each team's QR code (individually or
in a full-screen carousel with arrow-key/swipe navigation) and print all
codes in a grid layout, so I can distribute them before the event.

**US-23**: As an Admin, I want to see which scorekeeper accounts are
currently bound to which teams, so I can verify onboarding worked.

**US-24**: As an Admin, I want to "End Game," so scoring is definitively
closed and all scorekeeper accounts for this game are cleaned up.
- `POST /api/scorekeeper/end-game` (owner or SuperAdmin only): (1) sets `scoringOpen: false` **first**, guaranteeing scoring is closed even if the rest of the teardown partially fails; (2) globally signs out and deletes every scorekeeper Cognito account bound to this game's teams (`UserNotFoundException` treated as success, bounded concurrency 20); (3) clears `scorekeeperUserId`/`scorekeeperEmail` on those teams; (4) marks all remaining `UNUSED` tokens for the game `CONSUMED`. **Scores and Teams are preserved.**
- The client UI automatically retries the request up to 3 times with backoff (500ms × attempt) since the operation is idempotent/convergent — each retry only touches what's still left to clean up.

### 4.8 SuperAdmin User Management (`/admin/users`)

**US-25**: As a SuperAdmin, I want to create a new Admin by email, so they
can manage their own games.
- Creates a Cognito user in the `Admins` group with the invitation email suppressed (relies on Cognito's default temp-password flow); **409** if the email/username already exists.

**US-26**: As a SuperAdmin, I want to see every user in the system with
their role badge (Super Admin / Admin / QR Scorekeeper / Scorekeeper) and
status, so I can audit access.

**US-27**: As a SuperAdmin, I want to delete any user except myself.
- Self-deletion is blocked (**400**) by comparing the target `sub` to the caller's session `sub`.
- If a `sub` is supplied, any Team bound to that user has its `scorekeeperUserId`/`scorekeeperEmail` cleared (best-effort) before the Cognito account is globally signed out and deleted.
- No group-based restriction otherwise — a SuperAdmin can delete another Admin or SuperAdmin this way, not just scorekeepers.

### 4.9 Authentication & Authorization Boundaries

**US-28**: As any user, signing in at `/login` redirects me based on my
role: Admins/SuperAdmins → `/admin/games`; everyone else → `/scorekeeper`.
Sign-up is disabled on this form (`hideSignUp`) — see the stale-README note above.

**US-29**: As the system, every privileged API route must independently
verify the caller's role and, where applicable, game ownership, since there
is no global middleware:

| Route | Method | Required role | Ownership check |
|---|---|---|---|
| `/api/admin/games` | POST | Admin | n/a (creates as caller) |
| `/api/admin/games` | DELETE | Admin | owner or SuperAdmin |
| `/api/admin/users` | GET | SuperAdmin | n/a |
| `/api/admin/users` | POST | SuperAdmin | n/a |
| `/api/admin/users` | DELETE | SuperAdmin | n/a (self-delete blocked) |
| `/api/scorekeeper/generate` | POST | Admin | owner or SuperAdmin |
| `/api/scorekeeper/exchange` | POST | **none** (public) | token-scoped |
| `/api/scorekeeper/score` | POST | Scorekeeper | team-binding match |
| `/api/scorekeeper/end-game` | POST | Admin | owner or SuperAdmin |

Unauthenticated/wrong-role access should return **401**; wrong-owner access
on an existing resource should return **403**; a missing game/team/token
should return **404** (or the token-specific 404/409/410 codes above).

---

## 5. Non-Functional / Cross-Cutting Requirements

- **Real-time sync**: All list views (leaderboard, admin score grid, teams,
  scorekeeper admin) subscribe to Amplify `observeQuery` live queries rather
  than polling; a write from any client should be visible to all other open
  clients without a manual refresh.
- **Bulk-operation resilience**: Any operation touching many rows (game
  delete, team delete-all, score reset, end-game teardown, bulk team add)
  uses bounded concurrency (typically 5–20 in flight) plus retry-with-backoff
  (`app/lib/concurrency.ts`: `withRetry` retries up to 5 times on
  throttling-shaped errors only — `TooManyRequests`, `Rate exceeded`,
  `Throttl`, `NoSignedUser`, `ProvisionedThroughputExceeded`) to avoid
  tripping AWS rate limits at event scale (~40 teams × 100+ questions,
  ~150 concurrent scorekeepers). Partial failures during a destructive bulk
  op (game delete, reset, delete-all) must be surfaced, not swallowed, and
  should generally block completion of that operation's state transition.
- **Optimistic UI**: The admin score grid applies a local optimistic update
  before the server confirms, then reconciles against the live subscription
  using `updatedAt` recency.

---

## 6. Known Bugs / Issues to Fix

These are existing behaviors in the code that look unintentional. Do **not**
write tests asserting these as correct; each is flagged with whether it
needs a product decision first or is a straightforward code fix.

1. **Tied scores get distinct medal ranks instead of a shared rank.**
   `app/components/Leaderboard.tsx:250` assigns `rank={i + 1}` purely from
   array position within a group. Two teams tied at the same total (a very
   plausible scenario in a 0–3-point-per-question quiz) get 🥇 and 🥈
   instead of both showing 🥇 (or some other explicit tie convention).
   *Needs a product decision*: standard competition ranking (1,1,3) vs.
   dense ranking (1,1,2) vs. current behavior.

2. **Silent write failure in the admin score-save fallback path.**
   `app/admin/games/[slug]/scores/page.tsx:356-374`: when `Score.create`
   fails (e.g. because the row already exists), the code falls back to
   `Score.update`, but never checks that update's own `errors` return value.
   If both calls fail for a non-collision reason, nothing is thrown, no
   error is shown, and the optimistic UI keeps displaying the score as
   saved even though the database write never succeeded.
   *Straightforward fix*: check `errors` on the fallback update too, and
   surface/rollback on failure like the `catch` block already does.

3. **Fire-and-forget duplicate-score cleanup has no error handling.**
   `app/admin/games/[slug]/scores/page.tsx:34-52` (`healDuplicates`) fires
   `client.models.Score.delete(...)` with `void` and no `.catch()`. A failed
   cleanup delete (permission error, throttling) leaves a stale duplicate
   Score row indefinitely with zero visibility to the admin.
   *Straightforward fix*: catch and surface/report failures, or route
   through the existing `withRetry` helper used elsewhere in this file.

4. **Confusingly-named `entryDisabled` variable feeds a field meaning "open."**
   `app/admin/games/[slug]/users/page.tsx:172-176`:
   ```js
   const entryDisabled = game.scoringOpen === false;
   await client.models.Game.update({ slug, scoringOpen: entryDisabled }, ...);
   ```
   This is correct today only via an unintuitive double-negation
   (`entryDisabled` = "was it currently disabled" = the *new* `scoringOpen`
   value). A future refactor renaming this to `!entryDisabled` "for
   clarity" would silently invert the toggle.
   *Straightforward fix*: rename to something like `nextScoringOpen` and
   assign directly, or compute it as `!currentlyEnabled` without the
   confusing name. Pin the exact enabled↔disabled transitions (including
   `scoringOpen` starting `null`/`undefined`) with a test either way.

5. **Dead/misleading fallback in the token-dedup comparator.**
   `app/admin/games/[slug]/users/page.tsx:100-102`:
   ```js
   const itemDate = item.expiresAt ?? item.consumedAt ?? '';
   ```
   `expiresAt` is always set at token creation and never cleared, so
   `?? item.consumedAt` is unreachable — despite the code visually implying
   consumption time tie-breaks two `CONSUMED` tokens. Not currently harmful
   since expiry ordering happens to track creation ordering, but misleading
   and would silently misbehave if `expiresAt` ever became nullable
   independent of creation.
   *Straightforward fix*: remove the dead fallback or make the intent explicit.

6. **Duplicated, inconsistent-fallback "latest wins" tie-break logic across three files.**
   The pattern `(s.updatedAt ?? '') > (prev.updatedAt ?? '')` for
   deduplicating same-cell Score records by recency is copy-pasted in
   `app/g/[slug]/page.tsx:176`, `app/admin/games/[slug]/scores/page.tsx:95,109,141`.
   When two records both lack `updatedAt` (e.g. a brand-new optimistic
   record that hasn't round-tripped yet), `'' > ''` is `false`, so the
   *first-encountered* record wins — which depends on Amplify
   `observeQuery`'s array order, not actual recency. Because the comparator
   is duplicated three times, a future fix to the tie-break rule in one
   file is unlikely to be mirrored in the others.
   *Needs a product decision* on the correct tie-break rule, then a
   straightforward fix to extract one shared helper.

7. **Concurrent team-add can produce duplicate `displayOrder` values.**
   `app/admin/games/[slug]/teams/page.tsx:246,260`:
   `teams.reduce((m, t) => Math.max(m, t.displayOrder ?? -1), -1) + 1`
   is computed from client-side React state, not an atomic server-side
   counter. Two admins (or one admin double-clicking before the
   subscription echoes back) adding teams at nearly the same time can
   compute the same `displayOrder`. `compareTeamOrder` tie-breaks by name
   so nothing crashes, but the resulting order silently diverges from
   insertion order — notable because the rest of this codebase is
   unusually careful about exactly this class of race (see the extensive
   concurrency-safety comments in the same file).
   *Straightforward fix* (or accept and test the current tie-break
   behavior explicitly): move `displayOrder` assignment to a server-side
   atomic sequence, or at minimum document/test the name-tiebreak fallback.

8. **Scorekeeper's score button grid stays interactive after a 409 "already scored" response.**
   `app/components/ScoreEntry.tsx:44-48`: on `409`, only an error message is
   set — `submittedScore` stays `null`, so `ScoreButtonGrid` remains
   enabled and the scorekeeper can tap again, generating repeated 409s
   until the live `existingScore` subscription prop eventually updates and
   syncs `submittedScore` at render time. There is a window where the
   "already scored" error and an active button grid are shown together.
   *Straightforward fix*: disable the button grid (or show the confirmation
   state) immediately on a 409/`ALREADY_SCORED` response instead of waiting
   for the subscription to catch up.

9. **No server/schema-level range validation on `Score.points` for admin writes.**
   `amplify/data/resource.ts:123` declares `points: a.integer().required()`
   with no min/max, and the admin score grid / Quick Entry writes directly
   to AppSync (bypassing `/api/scorekeeper/score`, which *does* validate
   `points ∈ {0,1,2,3}`). The UI only offers `POINT_OPTIONS` buttons, but
   nothing stops a malformed/malicious direct Amplify SDK call from writing
   an out-of-range or negative `points` value for an admin-authored score.
   *Needs a product decision*: add schema-level validation (if Amplify Gen2
   supports it) or explicit server-side range checks on all write paths,
   not just the scorekeeper route.

10. **README documents a self-registration/team-claiming flow that doesn't exist in code.**
    `README.md:73` says scorekeepers "can self-register at `/login` (sign
    up), then claim an unclaimed team at `/scorekeeper`... first-come-first-served,"
    and `README.md:65` references `/admin/teams` (missing the `/games/[slug]/`
    segment used everywhere in the actual routing). The real, only
    onboarding path is the QR-token exchange described in section 4.3;
    sign-up is explicitly hidden (`hideSignUp` in `app/(auth)/login/page.tsx:61`).
    *Straightforward fix*: update `README.md` to match the QR-based flow so
    it isn't mistaken for intended-but-unbuilt behavior when writing tests.

11. **Deleting a single team does not delete its Score rows (orphaning).**
    `app/admin/games/[slug]/teams/page.tsx:299-310` (`handleDelete`) deletes
    only the `Team` row. By contrast, "Delete all teams" and the game-level
    `DELETE /api/admin/games` route both explicitly delete a game's Score
    rows before/alongside its Teams specifically *because* Team deletion
    doesn't cascade (the code comments elsewhere say so directly). A
    single-team delete leaves that team's Score rows behind, referencing a
    now-nonexistent `teamId` — these are invisible in the UI (which always
    joins through the current Team list) but persist in the database and
    would appear as orphaned rows in a full-table CSV/audit.
    *Needs a product decision*: is this an accepted trade-off (users rarely
    delete a team mid-event) or should single delete also cascade its
    scores? Either way, write a test that pins the chosen behavior
    explicitly rather than leaving it accidental.

---

## 7. Appendix — API Route Reference

| Endpoint | Method | Auth | Body | Success | Key errors |
|---|---|---|---|---|---|
| `/api/admin/games` | POST | Admin | `{ slug, title }` | `200 { slug }` | `400` invalid title/slug, `401` unauthenticated, `409` slug taken |
| `/api/admin/games` | DELETE | Admin, owner/SuperAdmin | `{ gameId }` | `200 { success: true }` | `400` missing gameId, `401`, `403` not owner, `404` game missing, `500` partial cascade failure |
| `/api/admin/users` | GET | SuperAdmin | — | `200` list of `{ user, groups }` | `401`/`403` non-SuperAdmin |
| `/api/admin/users` | POST | SuperAdmin | `{ email }` | `200` created user | `400` missing email, `409` `UsernameExistsException` |
| `/api/admin/users` | DELETE | SuperAdmin | `{ username, sub? }` | `200` | `400` self-delete attempt |
| `/api/scorekeeper/generate` | POST | Admin, owner/SuperAdmin | `{ gameId, teamId? }` | `200 { tokens: [...] }` | `400` missing gameId / team-game mismatch, `403` not owner, `404` game/team missing |
| `/api/scorekeeper/exchange` | POST | none (public) | `{ token }` | `200 { username, password, teamId, teamName }` | `400` missing token, `404` `INVALID_TOKEN`/`TEAM_NOT_FOUND`, `409` `TOKEN_ALREADY_USED`, `410` `TOKEN_EXPIRED` |
| `/api/scorekeeper/score` | POST | Scorekeeper | `{ teamId, questionNumber, points }` | `200 { success: true }` | `400` invalid body, `401` unauthenticated, `403` `TEAM_MISMATCH`/`SCORING_CLOSED`, `409` `WRONG_QUESTION`/`ALREADY_SCORED` |
| `/api/scorekeeper/end-game` | POST | Admin, owner/SuperAdmin | `{ gameId }` | `200 { success, deleted, failures }` | `400` missing gameId, `403` not owner, `404` game missing, `500` scoring-close failure |

These routes, and specifically the ordered validation checks inside
`/api/scorekeeper/score` and the state transitions inside `/api/scorekeeper/exchange`
and `/api/scorekeeper/end-game`, are the highest-value targets for
integration-style tests since they encode the app's core game-integrity and
concurrency-safety guarantees.
