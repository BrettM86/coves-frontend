# Coves Mini web PRD (frontend mini mode and the Lobsters/HN layout)

Status: approved by Bretton 2026-11-18. W4 decided as text only (no images or embeds); every other decision on its recommended option. Draft 2 was revised after the second-opinion review (codex, code-reviewer, comment-analyzer). Repo: `coves-frontend`. Base: `main`.

Parent PRD: `coves/docs/PRD_MINI.md` on `prd/prd_mini`, §8 "Frontend mini mode" and §12 chunk 7. The parent's decisions stand unless a decision below says it amends one. Mini loop tasks 01 to 10 are done, 11 is superseded by main's admin-removal work and 12 was dropped; the launch gate (remove/restore and bans through the community moderators work) is met. The parent's §12 chunks 8 (published images) and 9 (operator kit) are separate and the kit is not started. The backend branch merges to main after `prd/prd_community_moderators`; this work ships after both.

Design reference: the "Coves mini design language" canvas in the project. It holds the tokens (by name: `bg`, `raised`, `rule`, `guide`, `ink`, `ink-2`, `meta`, `accent`, in dark and light; `accent` is the Coves community teal, brightened on dark and deepened on light to pass 4.5:1, with cool-tinted neutrals to match), type scale, parts, and the frontpage and thread on desktop and phone. Where the canvas and this document differ, this document wins.

## Goal

When `MINI_COMMUNITY` is set, the existing web client becomes a single-forum site in the Lobsters/HN style: a dense ranked story list, compact nested threads, the forum's own name and legal pages, and nothing that points at other communities. Unset, the client behaves exactly as today, and nothing mini-specific (preset, fonts, routes) is visible.

## Non-goals

- A Discourse-style layout (parent D2).
- Browsing other communities from a mini site (parent §5.2).
- The mini look in the Coves mobile app (parent non-goal; decision W9).
- Making the layout selectable on a normal instance (parent §8). The code should not prevent it later.
- Tags (parent D10). Pinned posts (no pin data exists in the backend). Saved posts (the feature is a stub today).
- A "newest comments" page (no endpoint; Q2 below).
- A separate frontend app (parent D3, D4).

## What the backend gives the client

Checked against `prd/prd_mini`:

| Need | Source |
| --- | --- |
| Mini mode on, home community name | `MINI_COMMUNITY`, read server-side. No XRPC endpoint (parent §4). Backend name rule: `^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`, no `c-` prefix in any case (`communities.ValidateName`). |
| Home community view | `social.coves.community.get` with the bare name; the AppView resolves it against its own domain. No forum host needed in the frontend. |
| Forum name, description, avatar | The community profile, from that view. There is no rules field. |
| Downvotes allowed | `allowDownvotes` (default true) on `communityView` and `communityViewDetailed`. Set from `MINI_DOWNVOTES` at AppView boot, so it only changes on restart. Not yet in `src/lib/api/coves/types.ts`. |
| Uploads enabled | No read surface. Upload endpoints return 403 `ImageUploadsDisabled` when `IMAGE_UPLOADS_ENABLED=false`. Unset means on. Decision W5. |
| Legal pages | Fixed AppView paths on the forum host: `/privacy`, `/safety/child-safety`, `/delete-account`, rendered from the operator's Markdown. |
| OAuth consent branding | Done by the AppView from the home community. |
| Scoped profile | `community` (at-identifier, so a DID works) on `actor.getPosts` and `actor.getComments`. `actor.getProfile` counts are scoped server-side. |
| Scoped notifications | `community` on `notification.listNotifications` and `getUnreadCount`; empty or invalid returns 400. The frontend client methods don't take it yet. |
| Scoped search | `social.coves.feed.searchPosts` takes `community` (DID, handle, name@origin or bare name). The frontend has no post-search client method or page yet. |
| Community creation | `community.create` returns 403 for every caller on a mini AppView. |

The kit's single `.env` feeds both containers, so `MINI_COMMUNITY` and `IMAGE_UPLOADS_ENABLED` should not disagree between the AppView and the frontend; W5 still handles it if they do.

## Decisions for Bretton

Each has a recommendation. Pick, amend, or say "all recommended".

**W1. Where the layout lives.**
- (a) **Recommended.** A new `src/lib/feature/mini/` module (`StoryList`, `StoryRow`, `MiniThread`, `MiniComment`, `MiniShell`, `VoteControl`). It reuses the data layer: feed loading, vote actions, `comments.svelte.ts`, `CommentForm`, moderation actions. `VirtualFeed` and `CommentProvider` render `Post` and `CommentTree` directly today, so chunks 5 and 6 first add optional render snippets to them (`item`, `empty`; `tree`, `sort`) with today's components as the defaults.
- (b) Restyle the existing `Post` compact view and `CommentTree` behind a flag. Less new code, but every mini rule becomes a branch inside components that already carry gallery, embed and placement logic.

**W2. Typefaces.**
- (a) **Recommended.** Space Grotesk for titles and bodies, JetBrains Mono for meta, self-hosted as woff2 under `src/lib/assets/fonts/` like Inter (no runtime Google Fonts call). Both OFL. Loaded and applied only under the mini root attribute (W3).
- (b) Inter plus the system mono stack. Nothing new to ship, but loses most of the look.

**W3. Theme.**
- (a) **Recommended.** In mini mode the root element carries `data-mini`. The mini palette is a preset that is only offered in the theme picker in mini mode and is the default there; the default colour scheme in mini mode is dark, and the existing light/dark switch still works. Mini fonts and spacing tokens are scoped under `[data-mini]` in `src/app.css`, so the global `@theme` values are unchanged on normal instances.
- (b) Same, but the mini preset is also offered on normal instances.

**W4. Images and embeds. Decided: text only.**
Mini shows no thumbnails, inline images, galleries or embeds anywhere. See "Text only" under Behaviour.

**W5. How the client learns uploads are off.**
- (a) **Recommended.** Read `IMAGE_UPLOADS_ENABLED` server-side alongside `MINI_COMMUNITY` (unset means on) and pass `uploadsEnabled` in layout data. When false, these controls are not rendered: post images, comment images, profile avatar and banner, community avatar and banner in community settings, and the Bluesky import avatar step. A 403 `ImageUploadsDisabled` is still shown as a plain error.
- (b) Add a field to a backend view.

**W6. Rank numbers and paging.**
- (a) **Recommended.** One pager for both sizes: the first page is server-rendered, later pages are appended in place by cursor (desktop with a "more →" button, phone loading automatically near the end). Ranks `1.` `2.` … show on desktop only and continue across appended pages. No `?p=2` URLs.
- (b) No ranks anywhere.

**W7. Comment depth.**
- (a) **Recommended.** One limit on both sizes: today's `MAX_INLINE_DEPTH` (4) in `comments.svelte.ts`, so `subtreeFetchDepth` and the permalink loader need no change. Past it, "continue thread →" opens the existing comment permalink. At 14 px per level the phone loses 56 px at the deepest level.
- (b) A lower phone limit (3). Needs a second limit threaded through `subtreeFetchDepth` and the permalink loader.

**W8. Phone navigation.**
- (a) **Recommended.** A bottom bar: front, search, post, inbox, me. The thread has a top bar with back and ↑ ↓ jumps between top-level comments.
- (b) Top nav only, wrapped, as on desktop.

**W9. The Coves mobile app.**
- (a) **Recommended.** Keep it a non-goal, as the parent says. The app keeps showing the forum through coves.social in its normal look. An app-side look would be its own `coves-mobile` PRD.
- (b) Add an app-side compact story list now with the same tokens.

**W10. Guidelines page. Parent D12 says guideline pages are operator-supplied and required by setup.**
- (a) **Recommended, keeps D12.** A new `MINI_GUIDELINES_PAGE` Markdown path, mounted by the kit into the frontend container and rendered at `/community-guidelines` in mini mode. Small backend change: the AppView's mini config validation requires the variable too, so setup fails without it, like the other three pages.
- (b) Amends D12: show the community description instead. No rules field exists, so this is only the profile description.

**W11. Sorts.**
- (a) **Recommended.** hot, new, top, using the existing ranges in `src/lib/api/coves/sort.ts` (hour to all) and the backend's default of day. Comment sorts are hot, top, new, the only three the backend has.
- (b) hot and new only.

**W12. Where a link post's title goes. Parent §8 and HN send it to the link.**
- (a) **Recommended, keeps parent §8.** The title opens the link; the domain beside it and the comment count open the thread. Text posts open the thread.
- (b) Amends §8: the title always opens the thread, the domain opens the link (the Lemmy-style reference).

**W13. Where points go. Parent §8 puts them on the second line.**
- (a) **Recommended, amends §8 wording.** Points sit between the arrows in the vote column, as in the canvas, and are left off the meta line.
- (b) Points on the meta line ("142 points by …"), arrows only in the column.

**W14. Coves legal and license pages in mini mode.**
- (a) **Recommended.** `/license` and the AGPL source offer on `/legal` stay reachable (the client is AGPL-3.0), rebranded: no Coves product copy except "runs on Coves". The footer links "source". Coves' own terms are not shown; the operator's pages are.
- (b) Remove them. Not allowed by the AGPL source offer.

**W15. End-to-end test home.**
- (a) **Recommended.** Add a frontend container to the backend's hermetic CI stack (`scripts/lib/ci-stack.sh` in `coves`), built from the frontend checkout, with `MINI_COMMUNITY=mini` and `PUBLIC_INSTANCE_URL` pointing at `appview2`, serving appview2's legal paths through the same stack. A new `playwright.mini.config.ts` in `coves-frontend` targets it. The suite runs as its own gate (a `make e2e-mini` target in `coves`), not inside `pnpm run ci`, which has no AppView.
- (b) Run the Playwright suite by hand against a local mini AppView before each release.

## Scope proposals beyond the parent

These are not needed for v1. Each says what it prevents, the smaller alternative, and the added work.

- **P1. Operator accent colour (`PUBLIC_MINI_ACCENT`).** Prevents every mini forum looking identical. Smaller alternative: forums differ by name and avatar only (v1 default). Work: one variable, a contrast check against both backgrounds with fallback to the default accent, one test.
- **P2. Caching the home community view.** Prevents one `community.get` per page render. Smaller alternative (v1): resolve the home DID once at boot and fetch the view per request. A cache, if added later, must fetch anonymously and hold only public fields, since `community.get` fills in `viewer` (subscribed, blocked, roles) for signed-in requests.

## Behaviour

### Mini config (server)

`src/lib/server/mini.ts` reads `MINI_COMMUNITY` and `IMAGE_UPLOADS_ENABLED`. It validates the name with the backend rule above and fails boot naming the variable, following the boot-failure pattern in `src/hooks.server.ts`. At first use it resolves the home community's DID with an anonymous `community.get` by bare name and keeps only the DID (it never changes); a failed lookup is not kept and is retried on the next request. The root `+layout.server.ts` fetches the home `communityViewDetailed` per request with the viewer's session and adds `mini: { did, community, uploadsEnabled } | null` to layout data. Because root layout data is reused across client navigations, branding changes show on the next full load; `allowDownvotes` only changes on AppView restart. If the home community cannot be fetched, the page renders the error page with "This forum is not reachable"; it never falls back to a normal instance.

### Routing (parent §8)

Every `/c/[handle]` route resolves its parameter to a DID with the existing community resolution before deciding anything:

- Any alias of the home community (DID, `c-` handle, `name@origin`, bare name) on the bare community route redirects 308 to `/`. In mini mode this check runs before the existing 302 canonical redirect in `src/routes/c/[handle=handle]/+page.ts`, so there is one redirect, not two.
- Sub-routes under a home alias (`post/[owner]/[rkey]`, its `comment/…` permalink, `rss`, `settings`, `settings/team`) keep working. A post route also checks that the post's community DID is the home DID, else 404.
- Any other community returns 404.
- In mini mode `communityLink(home)` returns `/`; post links keep the canonical `/c/<home>/post/…` form.
- `explore/communities`, `/communities`, `profile/blocks/communities` and `profile/blocks/instances` return 404 and leave navigation. `profile/voted` is hidden in v1 (no `community` filter).
- `create/post` posts to the home community with no picker. Community creation entry points are not rendered.
- `/` renders the home feed with `StoryList`.

### Scoping

Every request that can return content from other communities passes `community=<home DID>`: `actor.getPosts` and `actor.getComments` on `/u/<h>`, `/profile/<h>` and the own-profile route, the two profile RSS endpoints, `listNotifications`, `getUnreadCount`, and `searchPosts`. The notification client methods gain the parameter. `updateSeen` keeps its single watermark; notifications from other communities are never shown on the mini site, so moving the watermark past them only affects the mini AppView's own state and is accepted.

### Text only (W4)

Mini renders no images or embeds. Content still arrives from coves.social users who post images into the forum, so:
- **Story list:** no thumbnail column. An image or gallery post shows `(image)` or `(N images)` in place of the domain; it links to the thread.
- **Thread:** a post's images are listed as mono links, `image 1`, `image 2` …, each opening the full image through the image proxy in a new tab. Link posts show the URL as a plain link, with no link card. Bluesky post embeds and video embeds become plain links.
- **Markdown in bodies and comments:** image syntax renders as a link with its alt text (or "image"), never an `<img>`.
- **Avatars:** none in lists, threads or comment headers. The forum avatar appears only in the header and favicon, as branding.
- **Composer:** no image controls, regardless of `uploadsEnabled` (W5 still covers profile and community settings).

### Search

A new `/search` page in mini mode: a query box and results as `StoryRow`s, from a new `searchPosts` client method with `community=<home DID>`.

### Votes (shared rule)

`VoteControl` is used by `StoryRow`, the thread post header and `MiniComment`. When `allowDownvotes` is false the ▼ is not rendered and a stored downvote from before the switch shows as no vote. `allowDownvotes` is added to `CommunityView` in `src/lib/api/coves/types.ts`. On phone each arrow has a 44 × 32 px hit area that may overflow the 32 px column into the row's padding; desktop arrows have a 32 × 24 px hit area.

### Story list

One `<article>` per post on a 1 px `rule`, no cards. Desktop grid: rank 28 px, vote 32 px, body. Phone: vote, body.

- **Title line:** title (17/500 desktop, 16/500 phone), then the domain in mono `meta`, e.g. `(nullroute.dev)`. For github.com, gitlab.com and codeberg.org the first path segment is kept, `(github.com/mira)`. Links per W12.
- **Meta line (mono 12.5, phone 12):** author, age, comment count ("N comments", phone "Nc", "discuss" at zero). Authors whose handle ends in the forum host are shown by the part before it; others in full, `name@host`. One line with ellipsis.
- **Votes:** `VoteControl` with the score between the arrows (W13). Your vote shows in `accent`.
- **Paging:** W6.
- **Removed and sensitive posts:** the existing placeholders and sensitive-content rules in the title position.

### Thread page

- Post header: `VoteControl`, title 24/600, domain, meta line, body (16/1.55, max 68ch), then mono actions: reply, share, report, and the existing moderator menu.
- Inline composer under the post (`CommentForm`), labelled "add a comment".
- Sort row: `N comments · hot top new`.
- Comments: mono header (author, `op` in `accent` for the post author, age, points, `[-]`/`[+]` right-aligned); sans body 16/1.55, max 72ch; quotes with a 2 px `guide` rule; mono actions (`VoteControl` inline as `▲ up ▼`, link, reply). Indent 24 px desktop, 14 px phone, one 1 px `guide` line per level. Collapsed: `[+] N replies hidden`. "N more replies →" in `accent` loads the subtree through the existing `getComments({ parentRkey })` path. Depth per W7. Removed comments keep their place with "removed by moderator" in italic mono and no actions.
- Phone top bar: back, forum name with "N comments · sort", ↑ ↓ to the previous or next top-level comment.
- The thread is nested lists so screen readers announce depth; guide lines are `aria-hidden`.

### Shell and branding

- Header: forum avatar (or a letter tile in `accent` when there is none), forum name, nav (hot new top search submit), sign-in or the signed-in handle. No Coves logo or product name.
- Front page subheader: community description and member count in mono `meta`.
- Footer: guidelines, privacy, child safety, rss, source, and "runs on Coves, federated with coves.social".
- `<title>`: `<post title> | <forum name>`; front page `<forum name>`.
- Sign-in: the kit sets `PUBLIC_LOCK_TO_INSTANCE`. Sign-up follows `PRD_SIGNUP` and parent D18 (off unless configured).
- All text meets 4.5:1 in both themes; the canvas tokens pass.

## Open questions

- **Q1. Search scoping.** Answered: `searchPosts` takes `community`. Frontend work only (chunk 7).
- **Q2. Newest comments across the forum.** Answered: no endpoint (`getComments` needs `post`, `actor.getComments` needs `actor`). Out of v1.
- **Q3. Parent SP-4** (with uploads off a user can still upload straight to the PDS). Backend; the frontend shows such images through the image proxy like any other.

## Testing

- Unit (Vitest): mini config parsing and validation (including upper case and `c-`); route guards (every home alias redirects once, other communities 404, a foreign post under a home slug 404s); domain trimming; author formatting; rank numbering across appended pages; `VoteControl` with `allowDownvotes` false, including a stored downvote, for posts and comments; scoping parameters on every listed request; uploads-off control hiding.
- Browser tests for `StoryRow`, `MiniComment` and `VoteControl` in both themes, and for text-only rendering: an image post, a gallery, a link post, a Bluesky embed and Markdown image syntax produce links and no `<img>` apart from the header avatar.
- Mini mode in unit and browser tests comes from mocked layout data. `pnpm run ci` (the merge gate) runs with `MINI_COMMUNITY` unset; its build and SSR tiers have no AppView.
- Playwright (W15) against `appview2` (`MINI_COMMUNITY=mini`, `did:web:forum.pds2.test`, community `c-mini.forum.pds2.test`, pages from `tests/fixtures/mini_pages`): only the home community shows, home aliases redirect to `/`, another community 404s, posting has no picker, profile and search show only home activity, notifications are scoped, legal links resolve, and ▼ disappears after `appview2-bootstrap-downvotes-off` and returns after `-on`, on posts and comments.

## Chunks

Each chunk ends with `pnpm run ci` passing, run in a worktree, never the main checkout. Each chunk that adds a variable updates `docs/ENVIRONMENT.md`.

1. **Mini config.** `src/lib/server/mini.ts`, home DID resolution, per-request community view, layout data, boot validation, `allowDownvotes` type.
2. **Routing and scoping.** DID-based route guards and redirects, link builders, hidden explore/blocks/voted/creation, `create/post` without a picker, `community` on every request in Scoping (needs 1).
3. **Tokens and fonts.** `data-mini`, mini preset and dark default, scoped tokens, self-hosted fonts (W2, W3; needs 1).
4. **Shell and branding.** Header, footer, titles, Coves branding removed, guidelines page (W10), legal and license (W14) (needs 1 and 3). W10(a) also needs the small backend config change.
5. **Story list.** Render snippets on `VirtualFeed`, `StoryList`, `StoryRow`, `VoteControl`, the text-only rendering rules (W4), pager and ranks (W6), sorts (W11), title links (W12) (needs 2 and 3).
6. **Thread page.** Render snippets on `CommentProvider`, `MiniThread`, `MiniComment`, composer, collapse, more replies, depth (W7) (needs 5 for `VoteControl`).
7. **Search.** `searchPosts` client method and `/search` (needs 5).
8. **Phone shell.** Bottom bar and thread top bar (W8) (needs 5 and 6).
9. **Uploads off.** Hide every control listed in W5 (needs 1).
10. **End-to-end.** The W15 stack change in `coves` and the Playwright suite (needs 2 to 9).

Published frontend images to atcr.io stay in the parent's §12 chunk 8 and are not repeated here.
