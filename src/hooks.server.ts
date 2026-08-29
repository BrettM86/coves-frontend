import {
  redirect,
  type Handle,
  type HandleServerError,
  type RequestEvent,
} from '@sveltejs/kit'
import { dev } from '$app/environment'
import { env as privateEnv } from '$env/dynamic/private'
import {
  addressHeaderConfigWarning,
  canonicalHost,
  publicInstanceUrl,
  upstreamInstanceUrl,
} from '$lib/server/instance'
import { log, type LogContext } from '$lib/server/log'
import { stampClientAddress } from '$lib/server/client-address'
import {
  applySecurityHeaders,
  parseOriginList,
  type SecurityHeaderOptions,
} from '$lib/server/security-headers'
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

const session: Handle = async ({ event, resolve }) => {
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
  //
  // Built from scratch — nothing the client sent is forwarded — and stamped
  // with the observed client address. This hop runs once per authenticated
  // page view and the backend's global rate limiter keys on X-Real-IP; without
  // the stamp every user on the site would share this container's one bucket
  // and, past the limit, be silently logged out (429 is handled below as
  // "unauthenticated").
  const upstreamHeaders = new Headers({
    Cookie: `coves_session=${covesSession}`,
  })
  stampClientAddress(upstreamHeaders, event.getClientAddress, 'hooks')
  try {
    const response = await fetch(`${instance}/api/me`, {
      headers: upstreamHeaders,
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

// Parsed once, at module load: adapter-node imports this module at process
// start, so a malformed CSP_VIDEO_ORIGINS refuses to boot instead of turning
// every request into a 500 after its side effects have already run.
const videoOrigins: readonly string[] = parseOriginList(
  privateEnv.CSP_VIDEO_ORIGINS,
)

function securityHeaderOptions(secure: boolean): SecurityHeaderOptions {
  return {
    dev,
    secure,
    instanceOrigin: publicInstanceUrl()?.origin ?? null,
    videoOrigins,
  }
}

/**
 * Every response that reaches `handle` — Kit pages, endpoints, and the manual
 * early returns in `session` above — leaves with the full security header
 * set. Not covered: static assets and prerendered pages (served by sirv / Vite
 * ahead of hooks; the edge supplies their baseline headers), and anything
 * thrown out of `session` (the dev-only host redirect, or Kit's fatal-error
 * page for an unexpected throw), which Kit builds outside this function.
 *
 * Composed by hand rather than with Kit's `sequence()`: as of Kit 2.70,
 * `sequence.js` calls `get_request_store()` up front, which throws outside
 * Kit's AsyncLocalStorage context and so cannot run under Vitest. Fine while
 * `session` passes no resolve options; revisit if a third handle is added.
 */
export const handle: Handle = async ({ event, resolve }) => {
  // Built before any request work so a configuration problem cannot follow a
  // side effect (e.g. a proxied POST) with a 500.
  const options = securityHeaderOptions(event.url.protocol === 'https:')

  // `transformPageChunk` fires only when Kit's page renderer produces the
  // response. That is the one signal an upstream cannot forge through
  // /api/proxy, which relays its response headers — including any CSP and
  // content-type — verbatim. Only a Kit page gets its CSP completed; every
  // other document gets deny-all.
  let kitPage = false
  const response = await session({
    event,
    resolve: (ev, opts) =>
      resolve(ev, {
        ...opts,
        transformPageChunk: (input) => {
          kitPage = true
          return opts?.transformPageChunk?.(input) ?? input.html
        },
      }),
  })

  try {
    applySecurityHeaders(response.headers, options, kitPage)
    return response
  } catch (error) {
    // A Response built from `fetch()` or `Response.redirect()` carries an
    // immutable Headers guard: `Headers.set` throws TypeError before touching
    // anything. Re-wrap and retry; a TypeError for any other reason recurs on
    // the copy and propagates from there.
    if (!(error instanceof TypeError)) throw error
    const copy = new Response(response.body, response)
    applySecurityHeaders(copy.headers, options, kitPage)
    return copy
  }
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
