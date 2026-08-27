/**
 * Instance-URL resolution — the single source of truth for which Coves
 * backend the frontend talks to.
 *
 * Two environment variables describe the backend:
 *
 * - `PUBLIC_INSTANCE_URL`      the backend as reachable from the browser.
 * - `PUBLIC_INTERNAL_INSTANCE` an optional server-only shortcut (e.g. the
 *                              Docker service `http://appview:8080`) used
 *                              for SSR and proxy hops.
 *
 * Precedence is decided here and nowhere else:
 *
 * - browser  → `PUBLIC_INSTANCE_URL`
 * - server   → `PUBLIC_INTERNAL_INSTANCE`, falling back to `PUBLIC_INSTANCE_URL`
 *
 * The functions are pure and take their env as a parameter so the same rules
 * are unit-testable and shareable between the browser-facing module
 * (`$lib/app/state/instance.svelte`) and the server-only one (`$lib/server/instance`),
 * which is the only place private env may be read.
 *
 * See docs/ENVIRONMENT.md for the operator-facing reference.
 */

export interface InstanceEnv {
  readonly PUBLIC_INSTANCE_URL?: string
  readonly PUBLIC_INTERNAL_INSTANCE?: string
}

export type InstanceSide = 'browser' | 'server'

export const MISSING_INSTANCE_MESSAGE =
  'No instance URL configured. Set PUBLIC_INSTANCE_URL (and optionally PUBLIC_INTERNAL_INSTANCE for server-side hops).'

/**
 * The configured instance URL for the given side, or `''` when nothing is set.
 * Empty-string env values count as unset.
 */
export function resolveInstanceUrl(
  env: InstanceEnv,
  side: InstanceSide,
): string {
  if (side === 'browser') return env.PUBLIC_INSTANCE_URL || ''
  return env.PUBLIC_INTERNAL_INSTANCE || env.PUBLIC_INSTANCE_URL || ''
}

/**
 * Whether production can boot with this env. The browser can only ever see
 * `PUBLIC_INSTANCE_URL`, so an internal-only configuration would leave every
 * client without an instance even though server code would appear to work.
 */
export function hasRequiredInstanceConfig(env: InstanceEnv): boolean {
  return Boolean(env.PUBLIC_INSTANCE_URL)
}

/**
 * Normalises a user- or operator-supplied instance value to an absolute URL
 * string. A bare hostname gets `https://`; an explicit `http://` or `https://`
 * scheme is kept. Returns null when the result is not a parseable URL.
 *
 * Only the leading scheme is added — any path component is preserved so a
 * backend mounted under a prefix keeps working.
 */
export function normalizeInstanceUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  const withScheme =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`
  try {
    // Parse for validity; return the normalised input rather than URL#href so
    // a missing trailing slash is not introduced for callers that join paths.
    new URL(withScheme)
    return withScheme
  } catch {
    return null
  }
}

/** Origin (`scheme://host[:port]`) of an instance value, or null if invalid. */
export function instanceOrigin(raw: string | undefined): string | null {
  const normalized = normalizeInstanceUrl(raw)
  if (normalized === null) return null
  return new URL(normalized).origin
}

/**
 * Host (with port) of `PUBLIC_INSTANCE_URL`, used in development to redirect
 * `localhost` to the `127.0.0.1` origin the OAuth cookie is scoped to.
 */
export function canonicalPublicHost(env: InstanceEnv): string | null {
  const publicUrl = env.PUBLIC_INSTANCE_URL
  if (!publicUrl) return null
  try {
    return new URL(publicUrl).host
  } catch {
    return null
  }
}

export interface PlaintextPolicyEnv extends InstanceEnv {
  readonly ALLOW_HTTP_INTERNAL_INSTANCE?: string
}

/**
 * Whether a plaintext `http://` upstream target is permitted.
 *
 * `https://` targets are always fine. Plaintext is allowed ONLY when the
 * operator opted in with `ALLOW_HTTP_INTERNAL_INSTANCE=true` AND the target's
 * origin equals the operator-configured `PUBLIC_INTERNAL_INSTANCE` (which must
 * therefore carry an explicit `http://` scheme). A session-derived instance
 * can never downgrade a server-side hop to plaintext.
 */
export function isUpstreamSchemeAllowed(
  target: string,
  env: PlaintextPolicyEnv,
): boolean {
  if (!target.startsWith('http://')) return true
  if (env.ALLOW_HTTP_INTERNAL_INSTANCE !== 'true') return false
  const allowed = instanceOrigin(env.PUBLIC_INTERNAL_INSTANCE)
  const targetOrigin = instanceOrigin(target)
  return allowed !== null && targetOrigin !== null && allowed === targetOrigin
}

export interface AddressHeaderEnv {
  readonly ADDRESS_HEADER?: string
}

/**
 * The boot-time warning for a missing `ADDRESS_HEADER`, or null when there is
 * nothing to say.
 *
 * Behind a reverse proxy, adapter-node has no way to see the real client
 * address unless `ADDRESS_HEADER` names the header carrying it; without it
 * `getClientAddress()` reports the proxy's own address for every request. The
 * `/api/proxy` upstream stamp is built from that value, so the backend ends up
 * rate-limiting every user of the instance as a single caller. The failure is
 * completely silent — requests succeed, limits just apply to the wrong
 * identity — which is why it is worth saying out loud at boot.
 *
 * Only meaningful in production: in dev the frontend is normally reached
 * directly, and the address is the connection's own.
 */
export function addressHeaderWarning(
  env: AddressHeaderEnv,
  isProd: boolean,
): string | null {
  if (!isProd) return null
  if (env.ADDRESS_HEADER) return null
  return (
    '[instance] ADDRESS_HEADER is not set. Behind a reverse proxy every ' +
    'request will look like it came from the proxy, so the backend will rate ' +
    'limit all users as one caller. See docs/ENVIRONMENT.md.'
  )
}
