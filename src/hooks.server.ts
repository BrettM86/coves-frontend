import {
  redirect,
  type Handle,
  type HandleFetch,
  type HandleServerError,
  type RequestEvent,
} from '@sveltejs/kit'
import { building, dev } from '$app/environment'
import { getRequestEvent } from '$app/server'
import { env as privateEnv } from '$env/dynamic/private'
import { isBackendUnavailable } from '$lib/app/util/error'
import { installRequestEventAccessor } from '$lib/app/util/request-event'
import {
  addressHeaderConfigWarning,
  originConfigWarning,
  canonicalHost,
  internalInstanceOrigin,
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
// Refuse production startup when adapter-node would trust the client Host
// header for event.url and origin checks. Builds have no deployment env yet.
const originStartupError = building ? null : originConfigWarning()
if (originStartupError) throw new Error(originStartupError)

// Universal modules cannot import `$app/server`, so they reach the in-flight
// request through an accessor this server-only file installs at module load.
// `getRequestEvent()` throws when there is no request in scope (module init,
// background work), which callers read as "no request context".
installRequestEventAccessor(() => {
  try {
    return getRequestEvent()
  } catch {
    return undefined
  }
})

/**
 * Allows universal server loads to read responses from the trusted internal
 * backend. SvelteKit applies browser CORS checks after this hook returns, even
 * though the request is a private server hop, so a successful CORS-free XRPC
 * response would otherwise become a 500. Scope the synthetic header to the
 * explicitly configured internal origin; arbitrary cross-origin fetches must
 * still satisfy the upstream server's real CORS policy.
 */
export const handleFetch: HandleFetch = async ({ event, request, fetch }) => {
  const internalOrigin = internalInstanceOrigin()
  const requestOrigin = new URL(request.url).origin

  if (
    internalOrigin === null ||
    requestOrigin !== internalOrigin ||
    requestOrigin === event.url.origin
  ) {
    return fetch(request)
  }

  const response = await fetch(request)

  // Network fetches expose the final URL after redirects. Fail closed when a
  // response escaped the configured internal origin (or a custom transport
  // returned no parseable URL) rather than blessing the redirect target.
  let responseOrigin: string
  try {
    responseOrigin = new URL(response.url).origin
  } catch {
    return response
  }
  if (responseOrigin !== internalOrigin) return response

  const allowedOrigin = response.headers.get('access-control-allow-origin')
  // Missing ACAO is the internal-hop failure this hook repairs. An explicit
  // value is an upstream policy decision, including when it denies this page.
  if (allowedOrigin !== null) return response

  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', event.url.origin)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

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

  // The proxy relays the opaque credential; the backend validates it on the
  // requested endpoint. Cookie presence does not establish authenticated locals.
  if (event.route.id === '/api/proxy/[...path]') {
    return resolve(event)
  }

  const covesSession = event.cookies.get('coves_session')
  if (!covesSession) {
    return resolve(event)
  }

  // Validate configuration eagerly — these throw on invalid input and must
  // NOT be caught so that misconfiguration surfaces immediately on the first request.
  const instance = asInstanceURL(upstreamInstanceUrl())
  const sealedToken = asSealedToken(covesSession)

  // Built from scratch — nothing the client sent is forwarded — and stamped
  // with the observed client address. This /api/me hop runs on cookie-bearing
  // non-proxy requests. The backend's global rate limiter keys on X-Real-IP;
  // without the stamp every user on the site would share this container's bucket
  // and, past the limit, receive a temporary rate_limited auth warning.
  const upstreamHeaders = new Headers({
    Cookie: `coves_session=${covesSession}`,
  })
  stampClientAddress(upstreamHeaders, event.getClientAddress, 'hooks')
  try {
    const response = await fetch(`${instance}/api/me`, {
      headers: upstreamHeaders,
      // A hung backend must not pile up requests until the Node process
      // exhausts sockets — this fetch runs on cookie-bearing non-proxy requests.
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
        if (response.status === 429) {
          // Rate limiting does not establish that the session expired. Preserve
          // the cookie and let the layout explain the temporary auth failure.
          event.locals.authError = 'rate_limited'
        }
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
 * `+layout.server.ts` puts the signed-in session (handle, avatar, DID) in the
 * load payload, and the payload reaches the browser one of two ways. With SSR
 * on it is serialised into the page itself; with `ssr = false`, which is what
 * we ship, Kit renders an empty shell and the client fetches the same payload
 * as `__data.json`. Either way a stored copy replays one user's session to
 * whoever loads it next on that device, so both are forced to
 * `private, no-store`. Kit already stamps that on `__data.json` itself, but
 * this hook states it independently — belt and braces on the response we own,
 * and the only cover for the SSR-on document.
 *
 * This header addresses HTTP caches: shared proxies and the browser's own disk
 * cache. It says nothing to our service worker, whose Cache API ignores
 * `Cache-Control` entirely; that hole is closed separately in
 * `service-worker.ts`. `no-store` rather than `no-cache` because only
 * `no-store` also forbids writing the response to disk. It forfeits bfcache in
 * browsers that still exclude no-store pages (Firefox, Safari; Chromium
 * restores them with restrictions), deliberately.
 *
 * Everything else defaults to no-store as well, unless it named a policy of
 * its own — silence is not permission to cache. That default is what covers a
 * page-level `redirect()` and Kit's error page, which produce neither a
 * transformed chunk nor a data request while still having branched on who is
 * signed in; a 301 or 308 is heuristically cacheable, so leaving those bare
 * would be a real leak. An endpoint that sets its own `cache-control` (the
 * proxy relaying an unauthenticated upstream, say) chose its freshness
 * deliberately and keeps it.
 */
function applyCachePolicy(
  headers: Headers,
  kitPage: boolean,
  isDataRequest: boolean,
): void {
  if (!kitPage && !isDataRequest && headers.has('cache-control')) return
  headers.set('cache-control', 'private, no-store')
}

/**
 * Every response that reaches `handle` — Kit pages, endpoints, and the manual
 * early returns in `session` above — leaves with the full security header
 * set. Not covered: static assets and prerendered pages (served by sirv / Vite
 * ahead of hooks; the edge supplies their baseline headers), and anything
 * thrown out of `session` (the dev-only host redirect, or Kit's fatal-error
 * page for an unexpected throw), which Kit builds outside this function.
 * The cache policy rides along under exactly the same coverage and the same
 * re-wrap on an immutable Headers guard.
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
    applyCachePolicy(response.headers, kitPage, event.isDataRequest)
    return response
  } catch (error) {
    // A Response built from `fetch()` or `Response.redirect()` carries an
    // immutable Headers guard: `Headers.set` throws TypeError before touching
    // anything. Re-wrap and retry; a TypeError for any other reason recurs on
    // the copy and propagates from there.
    if (!(error instanceof TypeError)) throw error
    const copy = new Response(response.body, response)
    applySecurityHeaders(copy.headers, options, kitPage)
    applyCachePolicy(copy.headers, kitPage, event.isDataRequest)
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

  if (isBackendUnavailable(error)) {
    return {
      message: 'The server is temporarily unreachable. Please try again.',
      code: 'BackendUnavailable',
    }
  }
  return { message: 'An unexpected error occurred' }
}
