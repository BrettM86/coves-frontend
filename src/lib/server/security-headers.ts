/**
 * Response security headers.
 *
 * Ownership model:
 *   - The app emits the browser-facing policy for every response that reaches
 *     `handle`: `Content-Security-Policy`, `Referrer-Policy`,
 *     `Permissions-Policy`, `X-Frame-Options`, `X-Content-Type-Options`,
 *     `Cross-Origin-Opener-Policy`.
 *   - Static assets and prerendered pages are served by adapter-node's sirv
 *     (Vite in dev) *before* hooks run, so they never pass through here.
 *   - The TLS edge (Caddy, backend repo) owns what the app cannot see — HSTS,
 *     TLS, body limits, `-Server` — and emits its own copies of the headers
 *     above with set-if-absent (`header ?Name`) semantics, so the app's values
 *     win wherever the app sends them and sirv-served assets still get a
 *     baseline. Keep the two in agreement.
 *
 * Split of the CSP header itself:
 *   - `svelte.config.js` (`kit.csp`) declares `script-src` because Kit must
 *     own that directive to append its per-request nonce, plus the three
 *     directives that must survive an `ADAPTER=static` build (no hooks there).
 *   - Everything else is built here at runtime so instance-specific hosts
 *     come from the environment instead of the build.
 *
 * Pure: no env access, no SvelteKit imports. `hooks.server.ts` wires it up.
 */
import { EMBED_FRAME_ORIGINS } from '$lib/app/util/embed-hosts'

export interface SecurityHeaderOptions {
  /** Vite dev server: HMR needs inline `<style>` elements and a websocket. */
  readonly dev: boolean
  /** Request arrived over https — the only case `upgrade-insecure-requests` is safe. */
  readonly secure: boolean
  /**
   * Origin of `PUBLIC_INSTANCE_URL`. Same-origin in the reference deployment,
   * but a frontend hosted apart from its backend needs it in `connect-src`,
   * `img-src` and `media-src`. `null` when unset.
   */
  readonly instanceOrigin: string | null
  /** Origins `<video>`/`<audio>` may stream from (`CSP_VIDEO_ORIGINS`). */
  readonly videoOrigins: readonly string[]
}

const HTTP_SCHEMES = new Set(['http:', 'https:'])

/**
 * Characters that must never appear in a CSP source expression we derive from
 * configuration. WHATWG URL parsing lets `;`, quotes and `*` through as host
 * code points, so `new URL(...).origin` alone is not enough to guarantee an
 * entry serialises as exactly one host source.
 */
const FORBIDDEN_IN_ORIGIN = /[;'"`*\s]/

/**
 * Parses a whitespace- or comma-separated list of origins from an env var.
 * Each entry is normalised to its bare origin. Anything that is not an
 * absolute http(s) origin — or that would serialise as more than one CSP
 * source — throws. Called once at module load in `hooks.server.ts`, so a
 * misconfigured policy refuses to boot rather than silently widening or
 * narrowing what the browser is told.
 */
export function parseOriginList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((entry) => {
      let url: URL
      try {
        url = new URL(entry)
      } catch {
        throw new Error(`[security-headers] not an absolute origin: "${entry}"`)
      }
      if (!HTTP_SCHEMES.has(url.protocol)) {
        throw new Error(
          `[security-headers] origin must be http(s), got "${entry}"`,
        )
      }
      if (FORBIDDEN_IN_ORIGIN.test(url.origin)) {
        throw new Error(
          `[security-headers] origin must be a single exact host, got "${entry}"`,
        )
      }
      return url.origin
    })
}

function unique(sources: readonly (string | null)[]): string[] {
  return [...new Set(sources.filter((s): s is string => s !== null))]
}

/** Parses a serialized policy into an ordered directive map. */
function parsePolicy(policy: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const raw of policy.split(';')) {
    const directive = raw.trim()
    if (!directive) continue
    const [name, ...sources] = directive.split(/\s+/)
    map.set(name.toLowerCase(), sources.join(' '))
  }
  return map
}

function serializePolicy(map: Map<string, string>): string {
  return [...map.entries()]
    .map(([name, sources]) => (sources ? `${name} ${sources}` : name))
    .join('; ')
}

/**
 * Completes the policy Kit emitted for a page it rendered. Kit-owned
 * directives (in practice `script-src` with its nonce) are kept verbatim;
 * every directive this module owns is set from `options`, overriding whatever
 * the input carried. Idempotent.
 */
export function buildContentSecurityPolicy(
  existing: string,
  options: SecurityHeaderOptions,
): string {
  const policy = parsePolicy(existing)
  const { dev, secure, instanceOrigin, videoOrigins } = options

  const set = (name: string, sources: readonly string[]): void => {
    policy.set(name, sources.join(' '))
  }

  set('default-src', ["'self'"])
  set('base-uri', ["'self'"])
  set('object-src', ["'none'"])
  set('frame-ancestors', ["'none'"])
  set('form-action', ["'self'"])
  set('worker-src', ["'self'"])
  set('manifest-src', ["'self'"])
  set('font-src', ["'self'"])
  // Inline `style=""` attributes are pervasive (app.html, Svelte's style:
  // directive during SSR); inline `<style>` elements are not — except that
  // Vite's dev server injects component CSS through them. `style-src` keeps
  // `'unsafe-inline'` as the fallback for user agents without `-elem`/`-attr`
  // support; browsers that understand the split use the tighter pair.
  set('style-src', ["'self'", "'unsafe-inline'"])
  set('style-src-elem', dev ? ["'self'", "'unsafe-inline'"] : ["'self'"])
  set('style-src-attr', ["'unsafe-inline'"])
  // `https:` — post embeds may hotlink images from anywhere (PostImage and
  // PostLink render thumbnail URLs taken from the record, gated only by a
  // scheme check, and the firehose does not validate them). An image cannot
  // execute script; the cost is the ordinary hotlink cost, already bounded by
  // Referrer-Policy.
  set('img-src', unique(["'self'", 'data:', 'blob:', 'https:', instanceOrigin]))
  set('media-src', unique(["'self'", 'blob:', instanceOrigin, ...videoOrigins]))
  set(
    'connect-src',
    unique(["'self'", instanceOrigin, ...(dev ? ['ws:', 'wss:'] : [])]),
  )
  set('frame-src', [...EMBED_FRAME_ORIGINS])
  if (secure) policy.set('upgrade-insecure-requests', '')
  else policy.delete('upgrade-insecure-requests')

  return serializePolicy(policy)
}

/**
 * Policy for an HTML document the app did NOT render: endpoint output, or
 * upstream markup relayed by `/api/proxy`. Such a document must never become
 * a script host under our origin, whatever CSP it arrived with — so this
 * replaces rather than merges. A future endpoint that legitimately returns
 * markup must be added to the Kit-page detection in `hooks.server.ts`, not
 * loosen this.
 */
export const DENY_ALL_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

/**
 * Features the app never uses on any origin. Everything the embed iframe
 * delegates through `allow=` / `allowfullscreen` in `PostIframe.svelte`
 * (autoplay, fullscreen, gyroscope, …) is deliberately absent: listing a
 * feature here with `()` or `(self)` would override that delegation and break
 * the player.
 */
const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'hid=()',
  'bluetooth=()',
  'midi=()',
  'magnetometer=()',
  'browsing-topics=()',
].join(', ')

function isDocument(headers: Headers): boolean {
  const type = headers.get('content-type')
  return type !== null && /^(text\/html|application\/xhtml\+xml)\b/i.test(type)
}

/**
 * Applies the full header set to a response, in place.
 *
 * `kitPage` must be true only when Kit's page renderer produced the response
 * (the caller learns that from `transformPageChunk` firing — a signal no
 * upstream can spoof through the proxy). Only then is the incoming CSP
 * trusted and completed; any other document gets `DENY_ALL_CSP` outright.
 *
 * CSP is touched only on documents: a CSP on a script response governs the
 * worker that script becomes, and the service worker must keep `fetch()`ing.
 */
export function applySecurityHeaders(
  headers: Headers,
  options: SecurityHeaderOptions,
  kitPage: boolean,
): void {
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Legacy twin of frame-ancestors for user agents that predate CSP2.
  headers.set('X-Frame-Options', 'DENY')
  // Safe because login is a top-level redirect flow (RFC 8252 loopback), not
  // a popup. A future popup-based flow needs `same-origin-allow-popups`.
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  headers.set('Permissions-Policy', PERMISSIONS_POLICY)

  if (!isDocument(headers)) return

  headers.set(
    'Content-Security-Policy',
    kitPage
      ? buildContentSecurityPolicy(
          headers.get('content-security-policy') ?? '',
          options,
        )
      : DENY_ALL_CSP,
  )
}
