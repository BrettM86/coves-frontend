# Environment variables

The single reference for every variable the frontend reads. Code resolves
instance URLs in exactly one place — `src/lib/app/state/instance/resolve.ts` — and
the tables below describe that behaviour. If you change a default or add a
variable, update this file; `Dockerfile`, `.github/README.md` and
`.env.development` only point here.

`PUBLIC_*` variables are exposed to the browser bundle by SvelteKit. Anything
without the prefix is server-only. All are read at **runtime** (via
`$env/dynamic/*`), so the same image can be deployed to several environments.

## Backend instance

| Variable | Read by | Required | Description |
| --- | --- | --- | --- |
| `PUBLIC_INSTANCE_URL` | browser, server | **yes in production** | The Coves backend as reachable from the browser (e.g. `https://coves.social`). The server refuses to boot in production without it, even if `PUBLIC_INTERNAL_INSTANCE` is set, because the browser can only ever see this value. In dev the OAuth cookie is scoped to this host, so `hooks.server.ts` redirects any other hostname to it (RFC 8252 requires `127.0.0.1`, not `localhost`). |
| `PUBLIC_INTERNAL_INSTANCE` | server | no | Server-only shortcut to the backend for `hooks.server.ts` (`/api/me` validation) and the `/api/proxy` upstream — e.g. `http://appview:8080` on a Docker network, or `http://127.0.0.1:8081` in dev to skip the Caddy loop. Falls back to `PUBLIC_INSTANCE_URL`. |
| `ALLOW_HTTP_INTERNAL_INSTANCE` | server | no | `"true"` to let the production proxy talk plaintext `http://` **only** to the origin of `PUBLIC_INTERNAL_INSTANCE` (which must then carry an explicit `http://` scheme). Any other `http://` target is still rejected with 400. |
| `PUBLIC_LOCK_TO_INSTANCE` | browser | no (default `true`) | When `true`, the login UI is pinned to `PUBLIC_INSTANCE_URL` and users cannot type a different instance. Set `false` to allow arbitrary instances. |

Resolution precedence:

- **Browser** → `PUBLIC_INSTANCE_URL`.
- **Server** (SSR fetches, hooks, proxy fallback) → `PUBLIC_INTERNAL_INSTANCE`, else `PUBLIC_INSTANCE_URL`.
- **Proxy for an authenticated user** → the instance stored in the session, normalised to `https://` when it has no scheme.
- Neither set → hooks and proxy return a hard configuration error; nothing ever falls back to a third-party host.

## Deployment (adapter-node)

| Variable | Required | Description |
| --- | --- | --- |
| `ORIGIN` | **yes behind a proxy** | Public URL of this frontend (e.g. `https://coves.social`). adapter-node needs it for correct origin / form-action checks. |
| `NODE_ENV` | set by the Dockerfile | `production` in the runtime image. |
| `ADAPTER` | build-time only | `node` (Docker) or `static`; anything else uses adapter-auto. |
| `LOG_STACKS` | no (default on) | Server log lines (`src/lib/server/log.ts`) are single JSON records with a request id; error messages and stacks pass through a secret scrubber before being written. Set `0` to omit stack traces entirely. Every response also carries an `x-request-id` header matching the `requestId` field in the logs. |

## Rendering

| Variable | Default | Description |
| --- | --- | --- |
| `PUBLIC_SSR_ENABLED` | unset (off) | Enable server-side rendering. **Leave unset in production for now**: it activates a cross-request locale race in `src/routes/+layout.server.ts` and a guest-rendered flash for logged-in users. |

## Appearance and default settings

All optional. Booleans accept `true`/`false`. They seed a new user's settings
(`src/lib/app/state/settings.svelte.ts`); users can change them afterwards.

| Variable | Default | Description |
| --- | --- | --- |
| `PUBLIC_THEME` | Kelp default | JSON theme exported from the theme settings page. |
| `PUBLIC_COLORSCHEME` | `system` | `system`, `light` or `dark`. |
| `PUBLIC_FONT` | `inter` | Font preset. |
| `PUBLIC_LANGUAGE` | browser locale | Force a UI language code. |
| `PUBLIC_VIEW` | `compact` | Feed view: `compact`, `cozy`, … |
| `PUBLIC_DEFAULT_FEED` | `discover` | Default feed listing. |
| `PUBLIC_DEFAULT_FEED_SORT` | `hot` | Default post sort. |
| `PUBLIC_DEFAULT_FEED_TIMEFRAME` | `all` | Default timeframe for time-bound sorts. |
| `PUBLIC_DEFAULT_COMMENT_SORT` | `hot` | Default comment sort. |
| `PUBLIC_EXPANDABLE_IMAGES` | `true` | Click-to-expand images in the feed. |
| `PUBLIC_EXPAND_IMAGES` | `true` | Show images expanded by default. |
| `PUBLIC_MARK_READ_POSTS` | `true` | Visually mark read posts. |
| `PUBLIC_MARK_POSTS_AS_READ` | `true` | Mark posts as read when opened. |
| `PUBLIC_HIDE_DELETED` | `false` | Hide deleted content. |
| `PUBLIC_HIDE_REMOVED` | `false` | Hide moderator-removed content. |
| `PUBLIC_EXPAND_SIDEBAR` | `true` | Sidebar open by default. |
| `PUBLIC_EXPAND_COMMUNITIES` | `true` | Sidebar "communities" section open. |
| `PUBLIC_EXPAND_FAVORITES` | `true` | Sidebar "favorites" section open. |
| `PUBLIC_EXPAND_MODERATES` | `true` | Sidebar "moderates" section open. |
| `PUBLIC_NSFW_BLUR` | `true` | Blur NSFW media. |
| `PUBLIC_MODLOG_CARD_VIEW` | unset | Card view for the modlog. |
| `PUBLIC_DEBUG_INFO` | `false` | Show debug info in the UI. |
| `PUBLIC_LEFT_ALIGN` | `false` | Left-align the layout. |
| `PUBLIC_LIMIT_LAYOUT_WIDTH` | `true` | Constrain the layout width. |
| `PUBLIC_DEDUPLICATE_EMBED` | `true` | Collapse duplicate link embeds. |
| `PUBLIC_COMPACT_FEATURED` | `true` | Compact featured posts. |
| `PUBLIC_REVERSE_ACTIONS` | `false` | Reverse the post action bar order. |
| `PUBLIC_TITLE_OPENS_URL` | `false` | Post titles open the linked URL. |
| `PUBLIC_FULL_MARKDOWN` | `false` | Enable the full markdown feature set. |
| `PUBLIC_BADGES` | unset | JSON map of DID → badge labels shown next to user names. |
| `PUBLIC_INSTANCE_TYPE` | unset | Legacy Photon hint (`piefedalpha`); unused on Coves. |

## Examples

Local development (`.env.development`, loaded automatically by Vite):

```dotenv
PUBLIC_INTERNAL_INSTANCE=http://127.0.0.1:8081
PUBLIC_INSTANCE_URL=http://127.0.0.1:8080
```

Production container:

```dotenv
ORIGIN=https://coves.social
PUBLIC_INSTANCE_URL=https://coves.social
PUBLIC_INTERNAL_INSTANCE=http://appview:8080
ALLOW_HTTP_INTERNAL_INSTANCE=true
```
