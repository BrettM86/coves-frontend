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

| Variable                       | Read by         | Required              | Description                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PUBLIC_INSTANCE_URL`          | browser, server | **yes in production** | The Coves backend as reachable from the browser (e.g. `https://coves.social`). The server refuses to boot in production without it, even if `PUBLIC_INTERNAL_INSTANCE` is set, because the browser can only ever see this value. In dev the OAuth cookie is scoped to this host, so `hooks.server.ts` redirects any other hostname to it (RFC 8252 requires `127.0.0.1`, not `localhost`). |
| `PUBLIC_INTERNAL_INSTANCE`     | server          | no                    | Server-only shortcut to the backend for `hooks.server.ts` (`/api/me` validation) and the `/api/proxy` upstream — e.g. `http://appview:8080` on a Docker network, or `http://127.0.0.1:8081` in dev to skip the Caddy loop. Falls back to `PUBLIC_INSTANCE_URL`.                                                                                                                            |
| `ALLOW_HTTP_INTERNAL_INSTANCE` | server          | no                    | `"true"` to let the production proxy talk plaintext `http://` **only** to the origin of `PUBLIC_INTERNAL_INSTANCE` (which must then carry an explicit `http://` scheme). Any other `http://` target is still rejected with 400.                                                                                                                                                            |
| `PUBLIC_LOCK_TO_INSTANCE`      | browser, server | no (default `true`)   | When `true`, login is pinned to `PUBLIC_INSTANCE_URL`: the login UI hides the instance field and `POST /api/auth/login` rejects any other origin with 403. Set `false` to allow arbitrary instances.                                                                                                                                                                                       |

Resolution precedence:

- **Browser** → `PUBLIC_INSTANCE_URL`.
- **Server** (SSR fetches, hooks, proxy fallback) → `PUBLIC_INTERNAL_INSTANCE`, else `PUBLIC_INSTANCE_URL`.
- **Proxy for an authenticated user** → the instance stored in the session, normalised to `https://` when it has no scheme.
- Neither set → hooks and proxy return a hard configuration error; nothing ever falls back to a third-party host.

## Deployment (adapter-node)

| Variable            | Required               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ORIGIN`            | **yes behind a proxy** | Public URL of this frontend (e.g. `https://coves.social`). adapter-node needs it for correct origin / form-action checks. Its scheme also decides whether requests count as https, which gates the CSP `upgrade-insecure-requests` directive.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `CSP_VIDEO_ORIGINS` | no                     | Origins `<video>`/`<audio>` may stream from — the CSP `media-src` directive — whitespace- or comma-separated absolute `http(s)` origins (e.g. `https://pds.coves.me https://tdpl.io`). Video is served straight from the hosting PDS rather than the image proxy, so list every PDS whose blobs the instance shows. `self`, `blob:` and the `PUBLIC_INSTANCE_URL` origin are always allowed; unset = only those, and video from any other host is blocked by the browser (fail-closed, no server-side signal). A malformed entry refuses to boot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ADDRESS_HEADER`    | **yes behind a proxy** | Header adapter-node reads for `getClientAddress()` — set it to `x-real-ip` and make the reverse proxy in front of the frontend populate that header (Caddy: `header_up X-Real-IP {remote_host}`). `/api/proxy` stamps the resolved address onto upstream requests as `X-Forwarded-For` / `X-Real-IP`, so without this the backend sees the proxy's own address for every user and rate-limits them all in one bucket. When it is set but a request arrives without the header, adapter-node throws; the proxy catches that and forwards with no address stamp, so requests still succeed. **The front proxy must overwrite this header unconditionally on every request** (`header_up` does; a merely additive config does not) — if a client-supplied `X-Real-IP` can survive to the frontend, the address stamped onto upstream requests is attacker-controlled and rate limits can be evaded or poisoned. The alternative is `ADDRESS_HEADER=x-forwarded-for` with `XFF_DEPTH=1`, which counts back one trusted hop from the right of the chain. Setting this at all makes adapter-node trust that header on **every** connection, with no notion of which peer is allowed to assert it, so the Node listener (port 3000) must be reachable only from the trusted reverse proxy — bound to loopback or confined to the container network, never published directly — because any client that can open a connection to it simply sets its own `X-Real-IP`. |
| `NODE_ENV`          | set by the Dockerfile  | `production` in the runtime image.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ADAPTER`           | build-time only        | `node` (Docker) or `static`; anything else uses adapter-auto.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `LOG_STACKS`        | no (default on)        | Server log lines (`src/lib/server/log.ts`) are single JSON records with a request id; error messages and stacks pass through a secret scrubber before being written. Set `0` to omit stack traces entirely. Every response also carries an `x-request-id` header matching the `requestId` field in the logs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Security headers

The app owns every browser-facing security header — `Content-Security-Policy`,
`Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`,
`X-Content-Type-Options`, `Cross-Origin-Opener-Policy` — in
`src/lib/server/security-headers.ts`, applied by `src/hooks.server.ts` to every
response that reaches hooks. Static assets and prerendered pages are served by
adapter-node (sirv) ahead of hooks and get only the edge's baseline headers.
`svelte.config.js` declares `script-src` (Kit attaches its per-request nonce)
plus the three directives a static build must keep.

The reverse proxy must not overwrite these: the production Caddyfile emits its
copies with set-if-absent semantics (`header ?Name`) and unconditionally adds
only what the app cannot see — HSTS, TLS, body limits. The launch gate is
`curl -sI https://coves.social/` showing a `'nonce-'` in `script-src`.

Policy decisions recorded here:

- `img-src` allows any `https:` host — post and comment bodies may hotlink
  images (the markdown renderer emits raw hrefs). An image cannot run script.
- `frame-src` is a fixed allowlist (`src/lib/app/util/embed-hosts.ts`) shared
  with the YouTube-frontend chooser; it is not configurable by environment.
- `connect-src` is `self` plus the `PUBLIC_INSTANCE_URL` origin. There is no
  UI for logging into a different instance (the Photon-era guest login was
  removed with this policy), so `PUBLIC_LOCK_TO_INSTANCE` must stay `true`;
  re-enabling multi-instance use means adding the chosen instance to
  `connect-src` from the session as well as restoring that UI.

## Rendering

| Variable             | Default     | Description                                                                                                                                                                                     |
| -------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_SSR_ENABLED` | unset (off) | Enable server-side rendering. **Leave unset in production for now**: it activates a cross-request locale race in `src/routes/+layout.server.ts` and a guest-rendered flash for logged-in users. |

## Appearance and default settings

All optional. Booleans accept `true`/`false`. They seed a new user's settings
(`src/lib/app/state/settings.svelte.ts`); users can change them afterwards.

| Variable                        | Default        | Description                                              |
| ------------------------------- | -------------- | -------------------------------------------------------- |
| `PUBLIC_THEME`                  | Kelp default   | JSON theme exported from the theme settings page.        |
| `PUBLIC_COLORSCHEME`            | `system`       | `system`, `light` or `dark`.                             |
| `PUBLIC_FONT`                   | `inter`        | Font preset.                                             |
| `PUBLIC_LANGUAGE`               | browser locale | Force a UI language code.                                |
| `PUBLIC_VIEW`                   | `compact`      | Feed view: `compact`, `cozy`, …                          |
| `PUBLIC_DEFAULT_FEED`           | `discover`     | Default feed listing.                                    |
| `PUBLIC_DEFAULT_FEED_SORT`      | `hot`          | Default post sort.                                       |
| `PUBLIC_DEFAULT_FEED_TIMEFRAME` | `all`          | Default timeframe for time-bound sorts.                  |
| `PUBLIC_DEFAULT_COMMENT_SORT`   | `hot`          | Default comment sort.                                    |
| `PUBLIC_EXPANDABLE_IMAGES`      | `true`         | Click-to-expand images in the feed.                      |
| `PUBLIC_EXPAND_IMAGES`          | `true`         | Show images expanded by default.                         |
| `PUBLIC_MARK_READ_POSTS`        | `true`         | Visually mark read posts.                                |
| `PUBLIC_MARK_POSTS_AS_READ`     | `true`         | Mark posts as read when opened.                          |
| `PUBLIC_HIDE_DELETED`           | `false`        | Hide deleted content.                                    |
| `PUBLIC_HIDE_REMOVED`           | `false`        | Hide moderator-removed content.                          |
| `PUBLIC_EXPAND_SIDEBAR`         | `true`         | Sidebar open by default.                                 |
| `PUBLIC_EXPAND_COMMUNITIES`     | `true`         | Sidebar "communities" section open.                      |
| `PUBLIC_EXPAND_FAVORITES`       | `true`         | Sidebar "favorites" section open.                        |
| `PUBLIC_EXPAND_MODERATES`       | `true`         | Sidebar "moderates" section open.                        |
| `PUBLIC_NSFW_BLUR`              | `true`         | Blur NSFW media.                                         |
| `PUBLIC_MODLOG_CARD_VIEW`       | unset          | Card view for the modlog.                                |
| `PUBLIC_DEBUG_INFO`             | `false`        | Show debug info in the UI.                               |
| `PUBLIC_LEFT_ALIGN`             | `false`        | Left-align the layout.                                   |
| `PUBLIC_LIMIT_LAYOUT_WIDTH`     | `true`         | Constrain the layout width.                              |
| `PUBLIC_DEDUPLICATE_EMBED`      | `true`         | Collapse duplicate link embeds.                          |
| `PUBLIC_COMPACT_FEATURED`       | `true`         | Compact featured posts.                                  |
| `PUBLIC_REVERSE_ACTIONS`        | `false`        | Reverse the post action bar order.                       |
| `PUBLIC_TITLE_OPENS_URL`        | `false`        | Post titles open the linked URL.                         |
| `PUBLIC_FULL_MARKDOWN`          | `false`        | Enable the full markdown feature set.                    |
| `PUBLIC_BADGES`                 | unset          | JSON map of DID → badge labels shown next to user names. |
| `PUBLIC_INSTANCE_TYPE`          | unset          | Legacy Photon hint (`piefedalpha`); unused on Coves.     |

## Examples

Local development (`.env.development`, loaded automatically by Vite):

```dotenv
PUBLIC_INTERNAL_INSTANCE=http://127.0.0.1:8081
PUBLIC_INSTANCE_URL=http://127.0.0.1:8080
```

Production container:

```dotenv
ORIGIN=https://coves.social
ADDRESS_HEADER=x-real-ip
PUBLIC_INSTANCE_URL=https://coves.social
PUBLIC_INTERNAL_INSTANCE=http://appview:8080
ALLOW_HTTP_INTERNAL_INSTANCE=true
CSP_VIDEO_ORIGINS=https://pds.coves.me https://coves.me https://tdpl.io
```
