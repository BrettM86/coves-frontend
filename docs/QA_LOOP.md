# Coves Frontend QA Loop

A recurring, self-pacing QA loop that walks the frontend section-by-section,
using Playwright-driven sub-agents to verify each area works end-to-end, fixing
any bugs found, and committing the fixes.

## Environment

| Thing        | Value                                                                              |
| ------------ | ---------------------------------------------------------------------------------- |
| App URL      | `http://localhost:8080` (Caddy proxy → Go backend :8081 + Vite :5173)              |
| Start stack  | `make dev-up` in your Coves backend checkout (run in background if not already up) |
| Health check | `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080` → expect `200`      |
| Test account | any seeded local dev account on your `*.local.coves.dev` PDS                       |
| Browser      | whichever browser your Playwright MCP is configured for                            |

Machine-specific values (backend checkout path, test-account credentials, and
the dated status log) live in `docs/QA_LOOP.local.md`, which is gitignored —
create it locally from the tables above.

## Loop Protocol (every iteration)

1. **Bootstrap**: verify `http://localhost:8080` responds; if not, start the stack
   with `make dev-up` from the Coves backend checkout and wait for it to come up.
2. **Pick a section**: take the first section in the Status table below whose
   status is `pending`, or if all are `pass`/`fixed`, the one with the oldest
   `Last run` (continuous re-verification).
3. **Test via sub-agent**: spawn a foreground sub-agent whose job is to execute
   that section's test scenarios with the Playwright MCP tools (Firefox), logged
   in as the test account where required. The agent must:
   - Take a `browser_snapshot` after each navigation and check for error UI,
     blank screens, or missing content.
   - Check `browser_console_messages` for errors on every page it visits.
   - Report each bug as: scenario, expected, actual, console errors, suspected file(s).
4. **Fix**: for each confirmed bug, fix it in the frontend following Svelte 5
   runes patterns and TypeScript strict mode. Run `pnpm check` and `pnpm lint`
   before committing. Re-verify the fix in the browser.
5. **Commit**: one commit per logical fix, conventional-commit style matching
   repo history, e.g. `fix(comments): handle tombstones that omit author`.
   Do **not** commit if nothing was fixed.
6. **Record**: update the section's row in the Status table in
   `docs/QA_LOOP.local.md` (status, date, notes). The status log is local-only
   and never committed.
7. **Schedule**: continue the loop (self-paced; ~20–30 min between iterations,
   sooner if the previous iteration found bugs in an adjacent area).

**Statuses**: `pending` (never tested) · `pass` (clean on last run) ·
`fixed` (bugs found and fixed — worth re-running soon) · `blocked` (needs user input; note why).

## Status

The per-section status log (status, last-run date, session notes) is kept in
`docs/QA_LOOP.local.md`, which is gitignored. Seed it with a table like:

| #   | Section                 | Status  | Last run | Notes |
| --- | ----------------------- | ------- | -------- | ----- |
| 1   | Auth & Session          | pending | —        |       |
| 2   | Home Feed               | pending | —        |       |
| 3   | Community Pages         | pending | —        |       |
| 4   | Post Detail & Comments  | pending | —        |       |
| 5   | Creation Flows          | pending | —        |       |
| 6   | Profiles & Blocks       | pending | —        |       |
| 7   | Explore & Discovery     | pending | —        |       |
| 8   | Settings, Theme & Shell | pending | —        |       |
| 9   | Notifications           | pending | —        |       |

---

## Section 1 — Auth & Session

**Scope**: `src/routes/login/`, `src/routes/accounts/` (redirects only), `src/routes/api/auth/`

**Scenarios**:

- Load `/login`; form renders with handle + password fields, no console errors.
- Log in as the local test account; lands back in the app with the
  account visible in the nav/profile menu.
- Bad password shows a user-visible error (not a silent failure or blank page).
- Guest login flow at `/login/guest` loads and functions.
- Log out from the top-right avatar menu (and from the command palette);
  the app returns to a logged-out state without stale user data in the UI.
- `/accounts` and `/accounts/login` redirect to `/login` (legacy links).
- Session persists across a full page reload.

**Pass when**: login, logout, guest, and bad-credential paths all behave, with
zero console errors.

## Section 2 — Home Feed

**Scope**: `src/routes/+page.svelte`, `src/lib/feature/post/feed/`,
`src/lib/feature/post/PostItem.svelte`, `PostVote.svelte`, `src/lib/feature/feeds/`

**Scenarios**:

- `/` renders a feed of posts while logged out and logged in.
- Post items show title, community link, author, timestamp, vote counts;
  timestamps and counts are sane (no `NaN`, `undefined`, `Invalid Date`).
- Sort/listing-type controls change the feed content and survive reload.
- Scroll pagination loads more posts without duplicates or jumps.
- Upvote/downvote as logged-in user: count updates optimistically and persists
  after reload. Voting logged out prompts login rather than failing silently.
- Image/link/embed posts render their media variants without layout breakage.

**Pass when**: feed loads, paginates, sorts, and votes correctly in both auth states.

## Section 3 — Community Pages

**Scope**: `src/routes/c/[handle=handle]/` (page + settings + team),
`src/lib/feature/community/`

**Scenarios**:

- Navigate to a community from the feed; `/c/<handle>` shows header (name,
  avatar/banner, description, member count) and its post list.
- Join/leave toggles state, updates membership count, persists on reload.
- Community settings pages load for a community the account moderates
  (or correctly deny access otherwise — no crash).
- Nonexistent community handle shows a graceful not-found, not a crash.
- Community links in post items route correctly (no raw AT-URIs in hrefs).

**Pass when**: community browsing, membership, and settings access all behave.

## Section 4 — Post Detail & Comments

**Scope**: `src/routes/c/[handle=handle]/post/[rkey]/` (incl. `comment/[crkey]/`),
`src/lib/feature/comment/`, `src/lib/feature/post/Post.svelte`, `PostBody.svelte`

**Scenarios**:

- Open a post from the feed; body, meta, and comment tree render.
- Post a top-level comment and a nested reply as the test account; both appear
  in the tree immediately and persist after reload.
- Vote on a comment; count updates and persists.
- Deep threads: "continue thread" navigation works and the comment permalink
  route `/c/<handle>/post/<rkey>/comment/<crkey>` loads standalone.
- Deleted/tombstoned comments render placeholders — no author profile link,
  no crash when author or record is missing (regression: `c66f6dd9`, `e94a51dd`).
- Share action produces a canonical web route, not a raw AT-URI (regression: `c33a28fe`).
- Edit and delete own comment; tree updates correctly.

**Pass when**: full comment lifecycle (create, reply, vote, edit, delete,
permalink, tombstone rendering) works with no console errors.

## Section 5 — Creation Flows

**Scope**: `src/routes/create/post/`, `src/routes/create/community/`,
`src/lib/feature/post/form/`, `src/lib/feature/community/CommunityForm.svelte`

**Scenarios**:

- `/create/post`: create a text post in a community; redirected to the new post,
  and it appears in the community feed.
- Create a link post; URL is validated and the link renders on the post page.
- Required-field validation shows inline errors; submit is blocked, not crashed.
- `/create/community`: form loads; create a community (or verify validation and
  preview if creation should be limited) — no silent failures.
- Draft/typed content is not lost on a validation error.

**Pass when**: post creation round-trips end-to-end and validation is user-visible.

## Section 6 — Profiles & Blocks

**Scope**: `src/routes/profile/`, `src/routes/u/[handle=handle]/`,
`src/lib/feature/user/`

**Scenarios**:

- Own profile (`/profile`) shows the test account's posts/comments; tabs switch content.
- Another user's profile via `/u/<handle>` loads their content; action buttons
  fit a foreign profile (no self-only actions).
- `/profile/voted/<type>` lists voted content matching votes cast in earlier sections.
- Blocks pages (`/profile/blocks/users|communities|instances`) load; block/unblock
  a user and verify their content is filtered from feeds.
- Nonexistent user handle shows graceful not-found.

**Pass when**: both self and foreign profile views, votes listing, and block
round-trip behave.

## Section 7 — Explore & Discovery

**Scope**: `src/routes/explore/`, `src/routes/communities/`,
`src/lib/feature/community/CommunityItem*.svelte`

**Scenarios**:

- `/explore/communities` lists communities with names, avatars, member counts.
- Search/filter narrows the list; empty query restores it; no-results state is
  a designed empty state, not a blank page.
- Join from the explore list works and reflects on the community page.
- Pagination/infinite scroll of the community list works without duplicates.
- Each listed community links to a working `/c/<handle>` page.

**Pass when**: discovery, search, and join-from-list all behave.

## Section 8 — Settings, Theme & Shell

**Scope**: `src/routes/settings/`, `src/routes/theme/`, `src/lib/settings/`,
app shell (navbar/sidebar in `src/lib/ui/`), `src/routes/error/`, `src/routes/legal/`

**Scenarios**:

- Every `/settings/*` page (`app`, `embeds`, `moderation`, `other`) loads without
  console errors; toggling a setting persists across reload.
- `/theme`: switch theme/colors; UI updates live and persists; no unreadable
  contrast in either light or dark mode.
- Shell: navbar/sidebar links all route correctly at desktop and mobile
  (~375px) viewport widths; mobile menu opens/closes.
- `/legal` renders; a garbage URL shows the designed error page.
- Keyboard: tab order reaches nav and primary actions; focus is visible.

**Pass when**: all settings persist, theming works both modes, shell navigation
is correct at both viewports.

## Section 9 — Notifications

**Scope**: `src/routes/notifications/`, `src/routes/settings/notifications/`,
the navbar bell, `tests/oauth/notifications.spec.ts`

This section is an automated two-account run, not a Playwright MCP walk.

**Scenario** (B is the recipient, A the actor; one browser context each):

- Both sign in once through the local PLC/PDS; each is confirmed by a
  `putPreferences` with its current value returning 200.
- B opens `/settings/notifications` and turns on any of the four reasons that
  is off, waiting for each save.
- Baseline: B opens `/notifications`. If page one is empty, A comments on a
  post B creates and B reloads until the row shows. B waits for `updateSeen`
  to return 200 and the bell to show no badge, then navigates to `/`.
- In the community, B creates post P and comment C on it, and P shows in the
  community feed. A, through the web app, comments on P, replies to C, creates
  post M mentioning `@B` (M's URI taken from the page the app opens after
  create), and upvotes P and C. M shows in the community feed (60 s bound).
- Asserted: within 90 s B's bell shows `5` with accessible name
  "Notifications, 5 unread". On `/notifications` B finds five rows by their
  targets: a `postReply` for A's comment on P, a `commentReply` for A's reply
  to C, a `mention` for M, and upvote rows for P and C. Each row's href opens
  that post or comment. After `updateSeen` returns 200 on that visit, the
  badge is gone. Back from an opened row restores the list and sends no
  `updateSeen`.

**Baseline rule**: while B's `seen_at` is NULL the backend counts only the
newest row as unread, so B must reach a real marked-seen baseline before A
acts. B must not sit on `/notifications` while A acts; the open list marks
new rows seen.

**Account setup**:

- `SEED` is the coves checkout that has `cmd/dev-seed`: today branch
  `qa/16a-backend` at `~/Code/qa-dev-seed-16a-20261015/coves`, until the
  dev-seed PRD merges into `~/Code/coves`. `~/Code/coves` main has no
  `cmd/dev-seed` or `make dev-seed` targets.
- The stack comes from the coves dev seed: `make dev-seed` or
  `make dev-seed-restore` in `$SEED`.
- B is the seed's `mari`, from `$SEED/.dev-seed/oauth-test-account.json`.
- A is a fresh actor, created before every run with a new run token. From
  `$SEED`, redirect the success JSON into `.dev-seed/fixtures/<token>.json`
  (file 0600, `.dev-seed/fixtures/` 0700):

  ```bash
  (umask 077
   mkdir -p .dev-seed/fixtures
   chmod 700 .dev-seed .dev-seed/fixtures
   go run ./cmd/dev-seed fixture post --run <token> \
     --manifest .dev-seed/manifest.json \
     --pds-handle-domain .local.coves.dev \
     --plc-url http://localhost:3002 \
     --pds-container coves-dev-pds \
     > .dev-seed/fixtures/<token>.json)
  ```

  The command prints A's password in that JSON on stdout, so never run it
  without the redirect. Token rules: 1–10 lowercase base36 characters, starts
  with a letter, does not start with a manifest key. Never print the passwords
  in either file.

- Community: `c-science.coves.social` (the seed's `science`).

**Command**: needs the `:8090`/`:5190` live pair, started under lease
`coves-frontend-live` per the repo profile's Live check. OAuth returns via
`:8080`; the spec then goes back to `:8090`.

```bash
OAUTH_WEB_BASE_URL=http://127.0.0.1:8090 \
OAUTH_TEST_ACCOUNT_FILE=$SEED/.dev-seed/oauth-test-account.json \
OAUTH_SECOND_ACCOUNT_FILE=$SEED/.dev-seed/fixtures/<token>.json \
OAUTH_NOTIFICATIONS_COMMUNITY=c-science.coves.social \
pnpm test:oauth tests/oauth/notifications.spec.ts --reporter=line
```

A missing account file, missing community or unreachable infrastructure fails
the run; a skip is a failure.

Use only `--reporter=line`, or the default list reporter without
`PLAYWRIGHT_LIST_PRINT_STEPS`. Playwright records `fill` values in step titles
(`Fill "{value}"`), so the html, json and blob reporters, or
`PLAYWRIGHT_LIST_PRINT_STEPS=1`, would record the passwords.

**Known environment limits**:

- The backend's global rate limit is 100 requests/min per IP. Both browsers
  and SSR come from 127.0.0.1 and share it, so a row navigation can get a 429.
- `createPost` is capped at 10 posts per author per community per rolling
  hour. Each run posts as `mari`, so repeated runs within an hour can fail at
  `createPost`. `make dev-seed-restore` resets the run's writes as `mari`.

**Pass when**: the command passes against a fresh fixture actor.
