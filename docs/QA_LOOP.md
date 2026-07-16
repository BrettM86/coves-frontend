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
| 1 | Auth & Session | pass | 2026-07-16 | Re-verified: all 3 fixes hold (idempotent logout confirmed via 200 on sessionless logout; "Handle" label; clean error copy), full logout/login round-trip clean, zero console errors or warnings. **Backend issue still open**: OAuth callback redirects to the Go backend landing page at `127.0.0.1:8081/` instead of back into the app — needs a fix in `~/Code/coves` `/oauth/callback`. Cosmetic: logout confirm dialog shows the raw backend URL instead of the instance domain. |
| 2 | Home Feed | pass | 2026-07-16 | Re-verified: all 5 fixes hold (scroll-to-end through ~50 posts with no dead-stop, full end message, untitled fallback, zero nested anchors, zero console warnings on the feed). Sort + vote round-trips clean. Carry-forwards: post detail page still logs 6 dev warnings/load (1 ownership via SvelteKit data prop, 4 CommentTree virtualizer bindings, 1 isAdmin stub — all catalogued in §4); sidebar "Posts 0" stat (backend); vote count transition may announce transient values to screen readers. |
| 3 | Community Pages | pass | 2026-07-16 | Re-verified (2nd pass): settings gates, 404 for unknown communities, canonical links (zero `/c/c-` hrefs anywhere), and DID-fallback links all hold; pagination + subscribe round-trip clean. **Backend issues still open**: `community.get` omits `viewer` state (subscribe resets on reload — `community.list` has the correct pattern to copy); stats counters disagree with reality. Carry-forwards: feed loader logs a console error on community-404 pages before the 404 renders; `displayHandle` unused (header shows `!c-science.coves.social`); community sort dropdown renders no selected value; catalogued dev-only binding warnings on /c pages. |
| 4 | Post Detail & Comments | pass | 2026-07-16 | Re-verified (2nd pass): delete-confirmation modal works end-to-end (cancel preserves, confirm tombstones), zero CommentActions/CommentVote ownership warnings, full lifecycle (create/nest/vote/edit/delete), tombstones link-free, share URLs canonical, permalinks render standalone. Carry-forwards unchanged: CommentTree.svelte:114 virtualizer binding warnings (needs refactor, dev-only), single ownership warning via SvelteKit `data` prop, deleted comments count in totals (backend), `[image-proxy] withPreset non-proxy URL` warning on PDS getBlob avatars. Note: older QA test comments from previous sessions remain on the science post as content/tombstones. |
| 5 | Creation Flows | pass | 2026-07-16 | Re-verified (2nd pass): community form correct (fields, DNS-name auto-transform, pattern validation blocks bad names with NO network call, zero legacy /api/v3 requests), fresh-post redirect lands on the rendered post (markdown body correct, feed listing, clean delete via confirm modal). +1 new fix: required markdown fields (community description) failed silently — `TextArea` never applied `required` to the DOM; now shows native validation + label asterisks. Carry-forwards: drafts not preserved when navigating away; post delete doesn't navigate/update in place; validation is native-browser only. |
| 6 | Profiles & Blocks | pass | 2026-07-16 | Re-verified (2nd pass): own profile clean of foreign actions, "Block user" label translated, all 4 gated routes show clean 404s, nav cleanup holds, blocks pages + not-found graceful, zero new console noise. +1 new fix: deep-linked `?type=` filter now honored on hard loads (state seeded from URL). **Backend issues still open**: block records never indexed (jetstream consumer) — blocking untestable end-to-end (block deliberately not clicked to avoid stranding PDS records); blocks-users page migration to `getBlockedUsers` blocked on that. Carry-forward: feed fetch console error on 404 pages. |
| 7 | Explore & Discovery | pass | 2026-07-16 | Re-verified (2nd pass): subscribe round-trip with zero mutation warnings and exact state restoration, DID-fallback link loads a working community view, search/sort/empty states/canonical links all hold, explore page fully console-clean. Backend diagnostic stands: `community.list` populates `viewer.subscribed`; `community.get` omits it (§3). Carry-forwards: card subtitles show raw `c-` handle text (display only); always-split "Top/Other results"; top cards omit member counts; "Popular" sort non-deterministic; no user/post search; instance stats aggregation (backend). |
| 8 | Settings, Theme & Shell | fixed | 2026-07-16 | PASSED — all settings pages load clean and persist toggles, theming (scheme + presets) applies live and persists, shell nav has zero dead links at desktop and 375px mobile (no overflow), keyboard nav + skip-link + command palette all work, /go redirects correct. 2 fixes: mailto links were rewritten into dead /profile/ links (Lemmy-era implicit-mention rewrite removed), free-text error messages triggered i18n missing-translation warnings on every error page. Minor carry-forwards: theme color hex inputs report #000000 in a11y snapshot despite correct swatches; theme preset cards use lorem-ipsum sample text. |

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
