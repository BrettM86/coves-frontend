import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { env } from '$env/dynamic/public'
import {
  parseApiMeResponse,
  asInstanceURL,
  asSealedToken,
} from '$lib/server/session'

function getInstanceUrl(): string {
  return env.PUBLIC_INTERNAL_INSTANCE || env.PUBLIC_INSTANCE_URL || ''
}

/**
 * Returns the canonical hostname (with port) from PUBLIC_INSTANCE_URL, if configured.
 *
 * In development, the ATProto OAuth spec (RFC 8252) requires the callback redirect_uri
 * to use 127.0.0.1 rather than "localhost". The Go backend sets APPVIEW_PUBLIC_URL to
 * http://127.0.0.1:8080, so the coves_session cookie is set on the 127.0.0.1 domain.
 * If a user navigates to localhost:8080 instead, the cookie is invisible and the user
 * appears unauthenticated. This function extracts the canonical host so we can redirect
 * mismatched hostnames to the correct origin.
 */
function getCanonicalHost(): string | null {
  const publicUrl = env.PUBLIC_INSTANCE_URL
  if (!publicUrl) return null
  try {
    return new URL(publicUrl).host
  } catch {
    return null
  }
}

/**
 * Checks whether an error is a network-level failure (DNS, TLS, connection refused, etc.).
 * Inspects the error message for known network-related keywords rather than matching on
 * error type alone, to avoid misclassifying programming bugs as transient network errors.
 */
function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    // AbortSignal.timeout() rejects with a DOMException named 'TimeoutError';
    // an aborted fetch rejects with 'AbortError'. Match the structured name
    // rather than message substrings so programming bugs that merely mention
    // "timeout"/"abort" in their message are not misclassified.
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return true
    }
    const msg = error.message.toLowerCase()
    return (
      msg.includes('fetch failed') ||
      msg.includes('network') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('etimedout') ||
      msg.includes('tls') ||
      msg.includes('ssl') ||
      msg.includes('dns')
    )
  }
  return false
}

export const handle: Handle = async ({ event, resolve }) => {
  // The /util/* debug pages are dev-only. Their +layout.ts guard only runs
  // client-side when SSR is disabled, which still serves a 200 app shell —
  // return a real HTTP 404 at the server edge instead.
  if (
    !dev &&
    (event.url.pathname === '/util' || event.url.pathname.startsWith('/util/'))
  ) {
    return new Response('Not found', { status: 404 })
  }

  // DEV MODE: Normalize hostname to match the OAuth callback domain.
  // The ATProto PDS requires 127.0.0.1 in redirect_uri (per RFC 8252), so the
  // coves_session cookie is set on 127.0.0.1. If the user accesses the app via
  // "localhost" instead, the cookie is invisible and auth silently fails.
  // Redirect to the canonical host from PUBLIC_INSTANCE_URL to ensure consistency.
  if (dev) {
    const canonicalHost = getCanonicalHost()
    if (canonicalHost && event.url.host !== canonicalHost) {
      const canonicalUrl = new URL(event.url)
      const canonical = new URL(env.PUBLIC_INSTANCE_URL!)
      canonicalUrl.hostname = canonical.hostname
      canonicalUrl.port = canonical.port
      canonicalUrl.protocol = canonical.protocol
      redirect(302, canonicalUrl.toString())
    }
  }

  event.locals.auth = { authenticated: false }

  const covesSession = event.cookies.get('coves_session')
  if (!covesSession) {
    return resolve(event)
  }

  const instanceUrl = getInstanceUrl()
  if (!instanceUrl) {
    throw new Error(
      '[hooks] No instance URL configured. Set PUBLIC_INTERNAL_INSTANCE or PUBLIC_INSTANCE_URL.',
    )
  }

  // Validate configuration eagerly — these throw on invalid input and must
  // NOT be caught so that misconfiguration surfaces immediately on the first request.
  const instance = asInstanceURL(instanceUrl)
  const sealedToken = asSealedToken(covesSession)

  // TODO: Consider caching /api/me responses or skipping validation for proxy
  // requests to reduce latency. Currently /api/me is called on every request.
  try {
    const response = await fetch(`${instance}/api/me`, {
      headers: {
        Cookie: `coves_session=${covesSession}`,
      },
      // A hung backend must not pile up requests until the Node process
      // exhausts sockets — this fetch runs on every authenticated request.
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      if (response.status === 401) {
        // Session expired or revoked — clear the stale cookie so we don't
        // make a wasted /api/me round-trip on every subsequent request.
        event.cookies.delete('coves_session', { path: '/' })
        // Flag so the layout can show "Your session has expired" to the user
        event.locals.sessionExpired = true
      } else {
        console.warn(
          `[hooks] /api/me returned ${response.status} - treating as unauthenticated`,
        )
      }
      return resolve(event)
    }

    const data: unknown = await response.json()
    const account = parseApiMeResponse(data, instance, sealedToken)

    if (!account) {
      console.warn(
        '[hooks] /api/me response failed validation - treating as unauthenticated',
      )
      event.locals.authError = 'validation_error'
      return resolve(event)
    }

    event.locals.auth = {
      authenticated: true,
      account,
      authToken: sealedToken,
    }
  } catch (error) {
    // Distinguish network/infrastructure errors from validation errors.
    // Network errors (DNS, TLS, timeouts, connection refused) are likely
    // temporary — preserve the cookie so the user can retry.
    if (isNetworkError(error)) {
      console.warn(
        '[hooks] Network error calling /api/me - backend may be unreachable:',
        error,
      )
      event.locals.authError = 'network_error'
    } else if (error instanceof SyntaxError) {
      // JSON parse error from response.json() — the server returned
      // non-JSON content (e.g. HTML error page, empty body)
      console.warn(
        '[hooks] /api/me returned invalid JSON - treating as unauthenticated:',
        error,
      )
      event.locals.authError = 'validation_error'
    } else {
      console.warn(
        '[hooks] Unexpected error calling /api/me - treating as unauthenticated:',
        error,
      )
      event.locals.authError = 'network_error'
    }
  }

  return resolve(event)
}

export const handleError: HandleServerError = async ({
  error,
  event,
  status,
  message,
}) => {
  if (status == 404) {
    return { message: 'Not found' }
  }

  // Log only safe request context — never the full event, which contains the
  // session cookie and sealed auth token (locals.auth.authToken).
  console.error(
    `[hooks] Error captured: ${event.request.method} ${event.url.pathname} (status ${status}): ${message}`,
  )
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)

  return { message: 'An unexpected error occurred' }
}
