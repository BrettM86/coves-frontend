# Coves Mini web PRD (frontend mini mode and the Lobsters/HN layout)

Status: draft for review, 2026-11-18. Repo: `coves-frontend`. Base: `main`.

Parent PRD: `coves/docs/PRD_MINI.md` on `prd/prd_mini` (tip `08a7fb9e`), §8 "Frontend mini mode" and §12 chunk 7. That PRD's decisions stand; this one only covers the web client. Backend chunks 01 to 10 are done, 11 is superseded by main `d43ffdb5`, 12 was dropped, and the launch gate (community remove/restore and bans through the moderators work) is met as of 2026-11-17. The backend branch has to merge to main after `prd/prd_community_moderators` before this work can ship.

Design reference: the "Coves mini design language" canvas (claude.ai artifact `AXkt13Fzh59eXbtGjW5ayt`): tokens and parts, frontpage and thread on desktop and phone, dark and light. Where the canvas and this document differ, this document wins.

## Goal

When `MINI_COMMUNITY` is set, the existing web client becomes a single-forum site in the Lobsters/HN style: a dense ranked story list, compact nested threads, the forum's own name and legal pages, and nothing that points at other communities. Unset, the client behaves exactly as today.

## Non-goals

- A Discourse-style layout (parent D2).
- Browsing other communities from a mini site (parent §5.2).
- The mini look in the Coves mobile app (parent non-goal; see decision W9).
- Making the layout selectable on a normal instance (parent §8). The code should not prevent it later (W1).
- Tags (parent D10).
- A separate frontend app (parent D3, D4).

## What the backend gives the client

Facts from `prd/prd_mini`, checked 2026-11-18:

| Need | Source |
| --- | --- |
| Mini mode on, home community name | `MINI_COMMUNITY`, read server-side from `$env/dynamic/private`. No XRPC endpoint (parent §4). |
| Home community view | `social.coves.community.get` with handle `c-<name>.<forum host>` (`communities.ProvisionedHandle`). |
| Forum name, description, avatar | The community profile, from that view. |
| Downvotes allowed | `allowDownvotes` (default true) on `communityView` and `communityViewDetailed`. Source record `social.coves.community.config`, written from `MINI_DOWNVOTES` at boot. |
| Uploads enabled | No read surface. Upload endpoints return 403 `ImageUploadsDisabled` when off (`IMAGE_UPLOADS_ENABLED=false`). See W5. |
| Legal pages | Fixed AppView paths on the forum host: `/privacy`, `/safety/child-safety`, `/delete-account`, rendered from the operator's Markdown. |
| OAuth consent branding | Done by the AppView: `client_name` and `logo_uri` come from the home community. |
| Scoped profile | `community` (DID) on `actor.getPosts` and `actor.getComments`. Counts in `actor.getProfile` are scoped server-side. |
| Scoped notifications | `community` (DID) on `notification.listNotifications` and `getUnreadCount`. Empty or invalid returns 400. |
| Scoped search | Parent §5.2 says search is scoped but names no parameter. Open question Q1. |
| Community creation | `community.create` returns 403 for every caller on a mini AppView. |

The kit's single `.env` feeds both containers, so `MINI_COMMUNITY` and `IMAGE_UPLOADS_ENABLED` cannot disagree between the AppView and the frontend.

## Decisions for Bretton

Each has a recommendation. Pick, amend, or say "all recommended".

**W1. Where the layout lives.**
- (a) **Recommended.** A new `src/lib/feature/mini/` module (`StoryList`, `StoryRow`, `MiniThread`, `MiniComment`, `MiniShell`) that reuses the existing data layer: feed loading and paging, `VirtualFeed`, vote actions, `comments.svelte.ts` and `CommentProvider`, `CommentForm`, moderation actions. Routes pick the mini components when mini mode is on.
- (b) Restyle the existing `Post` compact view and `CommentTree` behind a flag. Less new code, but every mini rule becomes a branch inside components that already carry gallery, embed and placement logic.

**W2. Typefaces.**
- (a) **Recommended.** Space Grotesk for titles and bodies, JetBrains Mono for meta, both self-hosted as woff2 under `src/lib/assets/fonts/` like Inter (no Google Fonts request at runtime, so no third-party call from a privacy-minded forum). Both are OFL.
- (b) Inter plus the system mono stack. Nothing new to ship, but loses most of the look.

**W3. Theme.**
- (a) **Recommended.** A "Mini" preset in `src/lib/app/state/theme/presets.ts` holding the canvas palette, dark by default with light available from the existing theme switch, plus `--font-*` and mini tokens in the `@theme` block of `src/app.css`. One optional operator variable, `PUBLIC_MINI_ACCENT`, overrides the accent in both themes; the client checks contrast against the background and falls back to the default accent if it fails 4.5:1.
- (b) Same preset, no operator accent.

**W4. Thumbnails in the story list.**
- (a) **Recommended.** Show a 56 px (phone 52 px) thumbnail on the right only when the post has an image or a link thumbnail; text posts and bare links get none. `PUBLIC_MINI_THUMBNAILS=false` hides them all.
- (b) Never show thumbnails (pure HN).

**W5. How the client learns uploads are off.**
- (a) **Recommended.** Read `IMAGE_UPLOADS_ENABLED` server-side alongside `MINI_COMMUNITY` and pass `uploadsEnabled` in layout data. Upload controls (post image, avatar, banner, comment images) are not rendered when false. A 403 `ImageUploadsDisabled` is still handled as a plain error in case the two ever disagree.
- (b) Add a field to a backend view. Cleaner contract, but a backend change for a value the shared `.env` already gives us.

**W6. Rank numbers.**
- (a) **Recommended.** Show `1.` `2.` … on desktop, hide on phone to give the title width. Ranks count only the current page plus earlier loaded pages, so infinite scroll keeps numbering.
- (b) No ranks anywhere.

**W7. Comment depth.**
- (a) **Recommended.** Keep `MAX_INLINE_DEPTH` from `comments.svelte.ts` on desktop; on phone (below the `sm` breakpoint) stop inline nesting at depth 6 and show "continue thread →", which opens the existing comment permalink route.
- (b) One limit for both.

**W8. Phone navigation.**
- (a) **Recommended.** A bottom bar: front, comments, post, inbox, me, as in the phone boards, with the thread top bar holding back and ↑ ↓ jumps between top-level comments.
- (b) Top nav only, as on desktop, wrapped.

**W9. The Coves mobile app.**
- (a) **Recommended.** Keep it a non-goal, as the parent PRD says. The app keeps showing the forum through coves.social in the app's normal look. If you want the app to offer this look later, that is its own PRD in `coves-mobile`.
- (b) Add an app-side "compact story list" view now, using the same tokens.

**W10. The "comments" tab (newest comments across the forum, like HN's /newcomments).**
- (a) **Recommended.** Leave it out of v1 unless Q2 finds an endpoint; the tab is hidden, not disabled.
- (b) Add a backend endpoint for it first.

**W11. Guidelines page.**
- (a) **Recommended.** `/community-guidelines` in mini mode shows the home community's rules or description from the community profile (moderators work), and the Coves guidelines copy is not shown.
- (b) A new `MINI_GUIDELINES_PAGE` Markdown file, mounted like the legal pages. Needs a small kit and frontend change and duplicates what moderators can already edit.

**W12. Sorts.**
- (a) **Recommended.** hot, new, top as the parent says; top shows a range picker (day, week, month, year, all) defaulting to week, from the existing sort mappings in `src/lib/api`.
- (b) hot and new only.

## Behaviour

### Mini config (server)

`src/lib/server/mini.ts` is the only module that reads `MINI_COMMUNITY` and `IMAGE_UPLOADS_ENABLED` (following `src/lib/server/instance.ts`). It validates the name with the same rules as the backend (lower case, no leading `c-`); an invalid value fails boot with a message naming the variable. The root `+layout.server.ts` adds `mini: { community: CommunityViewDetailed, uploadsEnabled: boolean } | null`, fetching the home community once per request through the existing server fetch path and caching it in memory for 60 seconds so a profile edit shows up within a minute. If the community cannot be fetched, every page renders the error page with "This forum is not reachable" rather than falling back to a normal instance.

### Routing (parent §8)

- `/` renders the home community feed with `StoryList`.
- The exact path `/c/<home handle>` redirects (308) to `/`. Its sub-routes (post, comment, rss, settings, team) keep working.
- Any `/c/<other>` route returns 404.
- `explore/communities`, `/communities`, `profile/blocks/communities` and `profile/blocks/instances` return 404 and are removed from navigation.
- `create/post` posts to the home community with no community picker.
- Community creation entry points are not rendered.
- `/u/<handle>` and `/profile/<handle>` pass `community=<home DID>` to `actor.getPosts` and `actor.getComments`.
- Notifications pass `community=<home DID>` to `listNotifications` and `getUnreadCount`.

### Story list

One `<article>` per post on a 1 px rule, no cards. Desktop grid: rank 28 px, vote 32 px, body, optional thumbnail. Phone: vote 32 px, body, optional thumbnail.

- **Title line:** title (17/500 desktop, 16/500 phone) linking to the thread for text posts and to the thread for link posts too (the domain is the outbound link), then the domain in mono meta, `(github.com/mira)`, trimmed to registrable domain plus first path segment for code hosts, like HN.
- **Meta line (mono 12.5):** `pinned ·` when pinned, author handle (local users without `@host`, remote users as `name@host`), age, comment count as "N comments" (phone "Nc"), "discuss" at zero. One line, ellipsis on overflow.
- **Votes:** ▲ score ▼ in the vote column. Your vote turns the arrow and score to the accent. When `allowDownvotes` is false the ▼ is not rendered (parent D19), and a stored downvote from before the switch is shown as no vote.
- **Paging:** "more →" at the end on desktop, and the existing `VirtualFeed` infinite scroll on phone.
- **Removed and NSFW posts:** reuse the existing placeholders and sensitive-content rules in the title position; no thumbnail.

### Thread page

- Post header: vote column, title 24/600, domain, meta line, body (16/1.55, max 68ch), then mono actions: reply, share, save, report, and moderator actions from the existing menu.
- Inline composer under the post (`CommentForm`), labelled "add a comment".
- Sort row: `N comments · top new old controversial` (the existing comment sorts).
- Comments: header in mono (handle, `op` marker in accent for the post author, age, points, `[-]`/`[+]` right-aligned); body in sans 16/1.55, max 72ch; quotes with a 2 px guide-coloured rule; actions `▲ up ▼ link reply` in mono. Indent 24 px desktop, 14 px phone, each level drawn as a 1 px guide line. Collapsed comments show `[+] N replies hidden`. "N more replies →" in accent loads the subtree with the existing `getComments({ parentRkey })` path. Removed comments keep their place with "removed by moderator" in italic mono and no actions.
- Phone top bar: back, forum name with "N comments · sort", ↑ ↓ buttons that scroll to the previous or next top-level comment.

### Shell and branding

- Header: forum avatar (or a letter tile in the accent when it has none), forum name, sort nav (hot new top [comments] search submit), sign-in or the signed-in handle. No Coves logo or Coves product name anywhere in mini mode.
- Under the header on the front page: the community description and member count in mono meta.
- Footer: guidelines, privacy, child safety, rss, and "runs on Coves, federated with coves.social" (the one Coves mention, as attribution).
- Page `<title>`: `<post title> | <forum name>`, front page `<forum name>`.
- Sign-in: the kit sets `PUBLIC_LOCK_TO_INSTANCE`, so the login page has no instance field. Sign-up follows `PRD_SIGNUP` and the parent D18 (off unless the operator configures it).

### Accessibility

Real buttons for every vote and collapse control with `aria-label` ("Upvote", "Downvote", "Collapse thread"), 44 px hit areas on phone and 32 px on desktop around the small glyphs, all text at least 4.5:1 in both themes (the canvas palette passes: meta `#8d948b` on `#0e110f` and `#66675f` on `#f6f6ef`), and comment guides are decoration (`aria-hidden`). The thread uses nested lists so screen readers announce depth.

## Open questions

- **Q1. Search scoping.** Which search endpoint and parameter scope results to the home community? If none exists, a small backend chunk adds `community` to post search; until then the mini search page is hidden.
- **Q2. Newest comments across the forum.** Is there a list endpoint for recent comments in a community? Drives W10.
- **Q3. SP-4 from the parent loop** (with uploads off, a user can still upload straight to the PDS). Not a frontend issue, but the frontend must not render images from such uploads differently; confirm the image proxy rules cover it.

## Testing

- Unit (Vitest): mini config parsing and validation; route guards (redirect, 404s); domain trimming; meta line formatting; rank numbering across pages; downvote hiding, including a stored downvote when `allowDownvotes` is false; phone depth limit.
- Browser tests for `StoryRow` and `MiniComment` in both themes, with and without thumbnails.
- Playwright against the CI mini AppView (`appview2`: `MINI_COMMUNITY=mini`, `did:web:forum.pds2.test`, community `c-mini.forum.pds2.test`, pages from `tests/fixtures/mini_pages`): front page shows only the home community, `/c/c-mini...` redirects, another community 404s, posting has no picker, profile shows only home activity, notifications are scoped, legal links resolve, and the ▼ disappears after `appview2-bootstrap-downvotes-off` and returns after `-on`.
- `pnpm run ci` passes with `MINI_COMMUNITY` unset (normal instance unchanged) and set.

## Chunks

Each chunk ends with `pnpm check`, `pnpm lint` and the tests it adds passing. Run them in a worktree, never the main checkout.

1. **Mini config.** `src/lib/server/mini.ts`, layout data, the 60 s community cache, boot validation, unit tests.
2. **Routing and scoping.** `/` as home feed, `/c/<home>` redirect, 404s, hidden explore/blocks/creation, `create/post` without a picker, `community` on profile and notification requests.
3. **Tokens and fonts.** Mini preset, `@theme` tokens, self-hosted Space Grotesk and JetBrains Mono, `PUBLIC_MINI_ACCENT` with the contrast fallback (W2, W3).
4. **Shell and branding.** Header, footer, titles, Coves branding removed, legal and guidelines links (W11).
5. **Story list.** `StoryList` and `StoryRow` on the existing feed loader, votes with `allowDownvotes`, thumbnails (W4), ranks (W6), sorts (W12).
6. **Thread page.** `MiniThread` and `MiniComment` on `CommentProvider`, composer, collapse, more replies, removed placeholders, depth rules (W7).
7. **Phone shell.** Bottom bar and thread top bar with top-level jumps (W8).
8. **Uploads off.** Hide upload controls from `uploadsEnabled` (W5).
9. **End-to-end.** Playwright suite against `appview2`.
10. **Published image.** Frontend image to atcr.io on a version tag, following the AppView's release script (parent §9.1). Can run in parallel with 3 to 9.

Chunks 1 and 2 must land first. 3 and 4 can run in parallel; 5 and 6 need 3; 7 needs 5 and 6; 9 needs every earlier chunk and a mini AppView in CI.
