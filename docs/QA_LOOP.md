# Coves Frontend QA Loop

Run the real Firefox OAuth tier and all eight sections against the designated
remote DEVELOPMENT stack using the reviewed QA frontend/backend checkouts.
Host unit tests and `pnpm run ci` do not replace these real scenarios.

## Environment and suite entry

Complete the verified local setup in [ENVIRONMENT.md](ENVIRONMENT.md): actual
host/project/volumes and backend source, local PDS registration PLC, managed
AppView saved WEB mode, and Caddy/Vite/Go checkout alignment. Use Firefox.
The normal browser origin is `http://127.0.0.1:8080` (Caddy → Go :8081 + Vite
:5173). Do not resurrect an unmanaged server or a different source checkout.

```sh
QA_BACKEND_HOST=<dev-host-ssh-alias> \
QA_BACKEND_CHECKOUT='<absolute backend checkout>' \
PDS_URL=http://localhost:3001 \
node scripts/qa-run.mjs
```

Fill in the SSH alias and absolute checkout of the dev backend host. `QA_BACKEND_HOST`, absolute
`QA_BACKEND_CHECKOUT` and explicit verified local `PDS_URL` are required.
`OAUTH_WEB_BASE_URL` optionally overrides `http://127.0.0.1:8080`. Origins must
be local HTTP origins (`localhost`, `127.0.0.1`, `[::1]`), without userinfo,
non-root paths, queries or fragments. The script derives its frontend checkout
from its own location and calls the unchanged `pnpm test:oauth` there.

At suite start it restores exactly once through `make dev-seed-restore` in the
configured remote checkout, then fetches and validates the matching current
manifest and Mari account. Restore may fall back to reseed; record which actually
happened. Local ignored `.dev-seed/manifest.json` and
`.dev-seed/oauth-test-account.json` are regular 0600 files in a 0700 directory,
atomically replaced before OAuth. The account has `{handle,password,did}` matching
`manifest.accounts.mari`; PDS must match the configured local provider. The runner
sets absolute `OAUTH_TEST_ACCOUNT_FILE` and `PLAYWRIGHT_NO_COPY_PROMPT=1`.
Restore/fetch/validation failure stops before OAuth; child failures keep their
actual status and private output is withheld. Old files after failure are not
refreshed success. Never print/source JSON or put credentials in local history.

The direct `pnpm test:oauth` remains available with the freshly fetched private
account; it does not restore. Do not restore between sections: keep the current
suite's new records and state. Each later suite invocation restores baseline.
Read-only targets come from manifest identities; baseline posts have no `title`
field. Known baseline display titles such as “NASA delays”, “Mod seed A/B/C” and
“deep chain fixture” can aid navigation; verify against the manifest URI/CID.

## Loop protocol

1. Run the suite entry and record the actual exit/status privately. Infrastructure
   or required scenario skips are failures, not passes.
2. Walk sections 1–8, logged out/in as each requires. Create section 4 and 6
   fixtures immediately before those sections, using their distinct fresh tokens.
3. Record safe content-only observations after login; check for blank screens,
   error UI and console errors. Never snapshot provider password/consent/callback
   pages or archive their URLs, form values, cookies or raw errors. Keep Firefox
   workers 1, retries 0 and trace/screenshot/video off.
4. Report defects with scenario, expected/actual result and safe error categories.
   Fixes follow separate test-first work and `pnpm check`/`pnpm lint` before commit;
   re-verify actual browser behavior. Do not silently change requirements.
5. Preserve the dated section status in ignored `docs/QA_LOOP.local.md` or private
   external evidence. Store status/date/safe notes only, never account credentials
   or private fixture payloads. Original checkout histories remain untouched.

**Statuses**: `pending` (not tested), `pass` (all required scenarios passed),
`fixed` (fixed and re-verified), `blocked` (record concrete missing prerequisite).

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

- Load `/login`; the handle form and “Continue to log in” action render without console errors. Handle preflight resolves through the configured local AppView.
- Log in as the local test account; lands back in the app with the
  account visible in the nav/profile menu.
- Provider password failure is user-visible; successful provider consent returns to the saved app path/query/fragment. Denied consent shows one cancellation message, and retry succeeds. Keep provider/callback details private.
- Browse as a guest and follow sidebar, nav/profile and command-palette login links; each preserves the destination. There is no separate guest-login page.
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
- Create a fresh own post through `/create/post` now for voting (section 5 separately
  covers the complete creation flow). Upvote/downvote it: the count updates
  optimistically and persists after reload. Voting logged out prompts login rather than failing silently.
- Image/link/embed posts render their media variants without layout breakage.

**Pass when**: feed loads, paginates, sorts, and votes correctly in both auth states.

## Section 3 — Community Pages

**Scope**: `src/routes/c/[handle=handle]/` (page + settings + team),
`src/lib/feature/community/`

**Scenarios**:

- Navigate to a community from the feed; `/c/<handle>` shows header (name,
  avatar/banner, description, member count) and its post list.
- Record the initial subscription state, normalize the join/leave precondition, then verify both changes and member counts across reload. Restore that section’s chosen final subscription state; do not rely on baseline membership after prior sections.
- Community settings pages load for a community the account moderates
  (or correctly deny access otherwise — no crash).
- Nonexistent community handle shows a graceful not-found, not a crash.
- Community links in post items route correctly (no raw AT-URIs in hrefs).

**Pass when**: community browsing, membership, and settings access all behave.

## Section 4 — Post Detail & Comments

Immediately before this section, create a fresh `postWithComments` in the verified
backend checkout. Pick a unique lowercase base36 token, beginning with a letter,
1–10 characters and not beginning with a baseline account/community key. Replace
each `<fresh-token>` and `<verified-...>` below before use. Run these commands on
the backend host, in the same absolute checkout configured for the suite:

```sh
(
set -e
cd -- '<absolute backend checkout>'
umask 077
mkdir -m 700 -- '.dev-seed/qa-<fresh-token>'
go run ./cmd/dev-seed fixture postWithComments \
  --run '<fresh-token>' --manifest .dev-seed/manifest.json \
  --pds-handle-domain .local.coves.dev \
  --plc-url '<verified-local-PLC>' --pds-container '<verified-dev-PDS>' \
  > '.dev-seed/qa-<fresh-token>/section4.next' \
  2> '.dev-seed/qa-<fresh-token>/section4.log' &&
  mv -- '.dev-seed/qa-<fresh-token>/section4.next' '.dev-seed/qa-<fresh-token>/section4.json'
)
```

Stop on any failed command. The directory must be new (do not reuse a failed run
or continue if `mkdir` fails); umask makes the files 0600. Only a successful exit
publishes the complete JSON by rename. Keep output/log private; do not print or
use command substitution to read fixture JSON. If transporting commands over
SSH, pass the host as a positional argument and one fixed remote command string;
single-quote literal absolute paths, escaping an embedded single quote as
`'\''`. Do not interpolate unquoted configured paths or use `eval`.

Use the returned `post.uri/cid/title/body/authorDid` and `community.did/handle`
to identify this exact post. `comments.firstLive`, `newestLive` and `deleted`
contain only `uri/cid/text/state`; they have no author/root/parent fields. The
backend owns root/parent associations. Match the returned newestLive URI/text
under sort=new and the deleted placeholder's state. Vote a live fixture comment;
create/edit/delete only Mari's own new comment/reply records on this fresh post.

Canonical post routes are `/c/<community>/post/<owner>/<rkey>`; comment routes
append `/comment/<commenter>/<crkey>`. Use UI Share/permalink actions (the existing
`postLink`/`commentLink` helpers): owner/commenter and both RKeys come from the
actual AT-URI authorities/record keys, every segment encoded. A readable handle
is valid only when bound to that same authority; DID fallback works. Never derive
keys from title/run or insert a full AT-URI into a route.

**Scope**: `src/routes/c/[handle=handle]/post/[owner=actor]/[rkey]/`
(incl. `comment/[commenter=actor]/[crkey]/`),
`src/lib/feature/comment/`, `src/lib/feature/post/Post.svelte`, `PostBody.svelte`

**Scenarios**:

- Open the fresh fixture post; exact returned body/meta and comment identities render.
- Post a top-level comment and a nested reply as the test account; both appear
  in the tree immediately and persist after reload.
- Vote on a comment; count updates and persists.
- Read-only deep threads: use `manifest.posts.deepChain` and
  `manifest.comments.deepChainDepth11`/`manifest.comments.deepChainLeaf`; “continue thread” and
  `/c/<community>/post/<owner>/<rkey>/comment/<commenter>/<crkey>` work.
  Baseline titles are constants, not fields in manifest posts.
- Deleted/tombstoned comments render placeholders — no author profile link,
  no crash when author or record is missing (regression: `c66f6dd9`, `e94a51dd`).
- Share action produces a canonical web route, not a raw AT-URI (regression: `c33a28fe`).
- Edit and delete own comment; tree updates correctly.
- Read baseline News moderation fixtures without modifying them: removed post
  tombstone (“Mod seed A”), removed comment and live reply (“Mod seed B”), NSFW
  label/blur (“Mod seed C”). Check safe unavailable/removed states, no stale body
  or unauthorized actions. As the authorized admin, remove/restore the suite’s
  own newly created post/comment and label/retract NSFW on its new post; confirm
  persistence, reason validation, and corresponding public `/modlog` and community
  modlog entries. Logged-out/unauthorized controls remain absent or safely denied.

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

At this section's start create `blockTarget` with a DISTINCT fresh run token,
using the same verified backend checkout/local PLC/PDS flags and new private
0700 directory/0600 output policy as section 4:

```sh
(
set -e
cd -- '<absolute backend checkout>'
umask 077
mkdir -m 700 -- '.dev-seed/qa-<distinct-fresh-token>'
go run ./cmd/dev-seed fixture blockTarget \
  --run '<distinct-fresh-token>' --manifest .dev-seed/manifest.json \
  --pds-handle-domain .local.coves.dev \
  --plc-url '<verified-local-PLC>' --pds-container '<verified-dev-PDS>' \
  > '.dev-seed/qa-<distinct-fresh-token>/section6.next' \
  2> '.dev-seed/qa-<distinct-fresh-token>/section6.log' &&
  mv -- '.dev-seed/qa-<distinct-fresh-token>/section6.next' '.dev-seed/qa-<distinct-fresh-token>/section6.json'
)
```

Stop on failure, including a pre-existing directory, and consume only the current
successful JSON. Use returned `actor.did/handle` and
`post.uri/cid/title/authorDid` for the foreign profile and block/filter/unblock
round-trip. The generator creates the actor/post; it does not block. Never use the
permanent baseline `blocked` actor as the mutable target. Keep credentials private.

**Scope**: `src/routes/profile/`, `src/routes/u/[handle=handle]/`,
`src/lib/feature/user/`

**Scenarios**:

- Own profile (`/profile`) shows the test account's posts/comments; tabs switch content.
- Another user's profile via `/u/<handle>` loads their content; action buttons
  fit a foreign profile (no self-only actions).
- `/profile/voted/<type>` lists voted content matching votes cast in earlier sections.
- Blocks pages (`/profile/blocks/users|communities|instances`) load; block/unblock
  the fresh blockTarget actor; verify its exact returned post is filtered, then
  unblock and verify the same URI/CID is visible again.
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
- Normalize the chosen community’s initial subscription state; join from the
  explore list and verify the community page, then leave/restore the intended
  final state. Do not depend on section 3’s membership state.
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
