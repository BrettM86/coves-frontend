import {
  redirect,
  type Handle,
  type HandleServerError,
  type RequestEvent,
} from '@sveltejs/kit'
import { dev } from '$app/environment'
import {
  addressHeaderConfigWarning,
  canonicalHost,
  publicInstanceUrl,
  upstreamInstanceUrl,
} from '$lib/server/instance'
import { log, type LogContext } from '$lib/server/log'
import {
  parseApiMeResponse,
  asInstanceURL,
  asSealedToken,
} from '$lib/server/session'

// Config problems that cannot be detected per-request are reported once, at
// module load, so they appear in the boot log rather than never.
const startupWarning = addressHeaderConfigWarning()
if (startupWarning) log.warn(startupWarning)

/**
 * The safe subset of a request to attach to a log line. Deliberately excludes
 * the event itself, which carries the session cookie and the sealed auth token.
 *
 * `requestId` collapses to undefined — and so drops out of the line entirely —
 * when it is missing or empty: `handleError` can fire on a failure raised
 * before `handle()` ran, and an empty string would read as a real id.
 */
function requestContext(event: RequestEvent): LogContext {
  return {
    requestId: event.locals.requestId || undefined,
    method: event.request.method,
    path: event.url.pathname,
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
  // Minted before any branch below can return, so log lines from anywhere in
  // this request can be correlated. setHeaders only reaches the response
  // resolve() returns: the manual /util 404 below carries the header itself,
  // while the dev redirect and Kit's own fatal-error responses do not.
  const requestId = crypto.randomUUID()
  event.locals.requestId = requestId
  event.setHeaders({ 'x-request-id': requestId })

  // The /util/* debug pages are dev-only. Their +layout.ts guard only runs
  // client-side when SSR is disabled, which still serves a 200 app shell —
  // return a real HTTP 404 at the server edge instead.
  if (
    !dev &&
    (event.url.pathname === '/util' || event.url.pathname.startsWith('/util/'))
  ) {
    // This Response bypasses resolve(), so setHeaders never reaches it.
    return new Response('Not found', {
      status: 404,
      headers: { 'x-request-id': requestId },
    })
  }

  // DEV MODE: Normalize hostname to match the OAuth callback domain.
  // The ATProto PDS requires 127.0.0.1 in redirect_uri (per RFC 8252), so the
  // coves_session cookie is set on 127.0.0.1. If the user accesses the app via
  // "localhost" instead, the cookie is invisible and auth silently fails.
  // Redirect to the canonical host from PUBLIC_INSTANCE_URL to ensure consistency.
  // (RFC 8252 requires 127.0.0.1 in the OAuth redirect_uri, so the Go backend
  // sets APPVIEW_PUBLIC_URL to http://127.0.0.1:8080 and the coves_session
  // cookie lands on that host; visiting via "localhost" would hide it.)
  if (dev) {
    const canonical = publicInstanceUrl()
    if (canonical && event.url.host !== canonicalHost()) {
      const canonicalUrl = new URL(event.url)
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

  // Validate configuration eagerly — these throw on invalid input and must
  // NOT be caught so that misconfiguration surfaces immediately on the first request.
  const instance = asInstanceURL(upstreamInstanceUrl())
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
        log.warn(
          `[hooks] /api/me returned ${response.status} - treating as unauthenticated`,
          { ...requestContext(event), status: response.status },
        )
      }
      return resolve(event)
    }

    const data: unknown = await response.json()
    const account = parseApiMeResponse(
      data,
      instance,
      sealedToken,
      requestContext(event),
    )

    if (!account) {
      log.warn(
        '[hooks] /api/me response failed validation - treating as unauthenticated',
        requestContext(event),
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
      log.warn(
        '[hooks] Network error calling /api/me - backend may be unreachable',
        requestContext(event),
        error,
      )
      event.locals.authError = 'network_error'
    } else if (error instanceof SyntaxError) {
      // JSON parse error from response.json() — the server returned
      // non-JSON content (e.g. HTML error page, empty body)
      log.warn(
        '[hooks] /api/me returned invalid JSON - treating as unauthenticated',
        requestContext(event),
        error,
      )
      event.locals.authError = 'validation_error'
    } else {
      log.warn(
        '[hooks] Unexpected error calling /api/me - treating as unauthenticated',
        requestContext(event),
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

  // One structured line. Method, path and status ride as fields rather than in
  // the message, and the error goes through log's `err` parameter — never as a
  // raw console argument — so it is scrubbed and its stack is policy-gated.
  log.error(
    `[hooks] Error captured: ${message}`,
    { ...requestContext(event), status },
    error,
  )

  return { message: 'An unexpected error occurred' }
}
