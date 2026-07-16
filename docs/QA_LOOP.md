# Coves Frontend QA Loop

A recurring, self-pacing QA loop that walks the frontend section-by-section,
using Playwright-driven sub-agents to verify each area works end-to-end, fixing
any bugs found, and committing the fixes.

## Environment

| Thing | Value |
|---|---|
| App URL | `http://localhost:8080` (Caddy proxy → Go backend :8081 + Vite :5173) |
| Start stack | `make dev-up` in `~/Code/coves` (run in background if not already up) |
| Health check | `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080` → expect `200` |
| Test account | handle `mari.local.coves.dev`, password `password` |
| Browser | **Firefox only** (Chrome is not installed) — Playwright MCP is configured for it |

## Loop Protocol (every iteration)

1. **Bootstrap**: verify `http://localhost:8080` responds; if not, start the stack
   with `make dev-up` from `~/Code/coves` and wait for it to come up.
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
6. **Record**: update the Status table row (status, date, notes) and commit the
   spec update as `docs: update QA loop status for <section>`.
7. **Schedule**: continue the loop (self-paced; ~20–30 min between iterations,
   sooner if the previous iteration found bugs in an adjacent area).

**Statuses**: `pending` (never tested) · `pass` (clean on last run) ·
`fixed` (bugs found and fixed — worth re-running soon) · `blocked` (needs user input; note why).

## Status

| # | Section | Status | Last run | Notes |
|---|---|---|---|---|
| 1 | Auth & Session | fixed | 2026-07-15 | 3 frontend bugs fixed (stuck logout on expired session, missing `form.handle` i18n key, raw i18n key on error page). **Backend issue flagged**: OAuth callback redirects to the Go backend landing page at `127.0.0.1:8081/` instead of back into the app — session is created but user is dumped outside the frontend; needs a fix in `~/Code/coves` `/oauth/callback`. |
| 2 | Home Feed | fixed | 2026-07-15 | 4 bugs fixed: infinite-scroll dead-stop after fast jumps to the bottom (pre-existing, confirmed by A/B against unmodified code), truncated end-of-feed message, empty rendering of untitled posts (incl. `undefined === undefined` embed-dedup path), nested `<a>` inside post-title anchors. Also silenced feed console noise (ownership warnings, scrollToTop i18n race). Carry-forwards: community slug inconsistency `/c/c-<handle>` vs `/c/<handle>` (check in §3), comment-side ownership + `CommentTree` binding warnings (§4), sidebar "Posts 0" stat looks wrong (backend), vote count transition may announce transient values to screen readers. |
| 3 | Community Pages | fixed | 2026-07-16 | 3 bugs fixed: settings routes blank-crashed on legacy Lemmy data shape (now gated 404 — Coves has no community-update/moderator APIs yet), unknown communities showed a 500 leaking backend errors (now 404), duplicate community URLs `/c/c-<handle>` vs `/c/<handle>` (links now canonical). **Backend issues flagged**: `community.get` never populates `viewer` state despite the lexicon promising it, so subscribe state doesn't survive reload (user can't unsubscribe after refresh); sidebar stats show `subscriberCount` under "Members" and a `postCount: 0` that disagrees with actual posts. Carry-forwards: `displayHandle` from API unused (header shows `!c-science.coves.social`), community page sort dropdown renders no selected value, `binding_property_non_reactive` warnings in community +page.svelte. |
| 4 | Post Detail & Comments | pending | — | |
| 5 | Creation Flows | pending | — | |
| 6 | Profiles & Blocks | pending | — | |
| 7 | Explore & Discovery | pending | — | |
| 8 | Settings, Theme & Shell | pending | — | |

---

## Section 1 — Auth & Session

**Scope**: `src/routes/login/`, `src/routes/accounts/`, `src/routes/api/auth/`

**Scenarios**:
- Load `/login`; form renders with handle + password fields, no console errors.
- Log in as `mari.local.coves.dev` / `password`; lands back in the app with the
  account visible in the nav/profile menu.
- Bad password shows a user-visible error (not a silent failure or blank page).
- Guest login flow at `/login/guest` loads and functions.
- `/accounts` lists the logged-in account; switching/logout works and returns
  the app to a logged-out state without stale user data in the UI.
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
app shell (navbar/sidebar in `src/lib/ui/`), `src/routes/go/`, `src/routes/error/`, `src/routes/legal/`

**Scenarios**:
- Every `/settings/*` page (`app`, `embeds`, `moderation`, `other`) loads without
  console errors; toggling a setting persists across reload.
- `/theme`: switch theme/colors; UI updates live and persists; no unreadable
  contrast in either light or dark mode.
- Shell: navbar/sidebar links all route correctly at desktop and mobile
  (~375px) viewport widths; mobile menu opens/closes.
- `/go/<link>` redirects resolve correctly; `/legal` renders; a garbage URL
  shows the designed error page.
- Keyboard: tab order reaches nav and primary actions; focus is visible.

**Pass when**: all settings persist, theming works both modes, shell navigation
is correct at both viewports.
