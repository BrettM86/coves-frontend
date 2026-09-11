import type { RequestEvent } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { log } from '$lib/server/log'
import { stampClientAddress } from '$lib/server/client-address'
import { normalizeInstanceUrl } from '$lib/app/state/instance/resolve'
import {
  upstreamInstanceUrl,
  upstreamSchemeAllowed,
} from '$lib/server/instance'
import { enforceSameOrigin, validateProxyPath } from '../validate'

/**
 * =============================================================================
 * API PROXY SECURITY MODEL
 * =============================================================================
 *
 * PURPOSE:
 * This proxy exists to keep authentication tokens secure by never exposing them
 * to the browser. Authentication is managed via a backend-delegated session: the
 * Coves Go backend sets a sealed (encrypted) session cookie during OAuth, and
 * the proxy relays that opaque credential as a Bearer Authorization header.
 * The backend validates it on the requested endpoint; proxy requests skip
 * /api/me prevalidation and do not establish authenticated frontend locals.
 * The client never needs to handle or store tokens.
 *
 * TRUST MODEL:
 * - Client -> Proxy: Client is untrusted. All paths are validated for security
 *   issues (traversal, injection, etc.). Every request goes to the normalized
 *   operator-configured upstream. The client and session account data never
 *   influence the target host.
 * - Proxy -> Backend: Backend is trusted to validate the supplied credential
 *   and authorize the requested operation.
 *
 * PATH VALIDATION:
 * The path is validated to prevent:
 * - Path traversal attacks (../ patterns)
 * - Null byte injection (can truncate paths)
 * - Protocol injection (javascript:, data:, etc.)
 * - Encoded path separators that could bypass validation
 *
 * TRANSPORT:
 * The upstream hop uses `globalThis.fetch`, never the `fetch` from the request
 * event. kit's event.fetch is built for loading data on the user's behalf, so
 * it deliberately re-attaches the caller's credentials to same-site requests —
 * which would silently undo the allowlist below. In
 * @sveltejs/kit/src/runtime/server/fetch.js it sets `origin` on requests that
 * lack one (~line 41), copies the inbound `cookie` through for same-host and
 * subdomain targets (~line 77 and ~line 132), and re-adds the inbound
 * `authorization` when the outgoing request has none (~line 137). Since the
 * upstream is usually the same host or a sibling subdomain, every one of those
 * applies here: the session cookie the proxy is careful never to forward would
 * arrive at the backend anyway, and a client-forged authorization could ride
 * along on an unauthenticated request. The platform fetch has no such
 * behaviour, and the allowlist stays the whole truth about what is sent.
 *
 * Redirects are relayed, never followed (`redirect: 'manual'`). Following one
 * would let an upstream response choose the next URL this process fetches —
 * with the Authorization header already attached and no path validation on the
 * new target — turning an open redirect on the backend into SSRF against
 * internal addresses. On 307/308 the method and body are preserved, so the
 * client's payload would be replayed to that target as well. The 3xx and its
 * `location` go to the browser, which resolves it under its own rules.
 *
 * HEADER HANDLING:
 * The upstream request is built from scratch rather than by editing a copy of
 * the client's headers, so a header only reaches the backend if it is named
 * here. Denylisting the known-dangerous headers would silently forward any new
 * one a browser or an attacker invents.
 *
 * 1. Allowlisted from the client: only the headers named in
 *    FORWARDED_REQUEST_HEADERS survive; see that constant for the list and the
 *    reasoning. Everything else is dropped — cookie (see 3), authorization,
 *    hop-by-hop framing, and any custom header.
 *
 * 2. Stamped by the proxy, after the filter so nothing the client sent can be
 *    confused with — or appended to — what we observed:
 *    - 'X-Forwarded-For' / 'X-Real-IP': event.getClientAddress(). This is the
 *      address the backend rate-limits and audit-logs on, so it must be the
 *      observed connection, never a client claim. The call is guarded:
 *      adapter-node throws when ADDRESS_HEADER is configured but the header is
 *      absent, and that misconfiguration must degrade to "no address claim"
 *      rather than fail the request. DEPLOYMENT NOTE: behind a reverse proxy,
 *      ADDRESS_HEADER must be set (see docs/ENVIRONMENT.md) or every user
 *      appears to the backend as the proxy's own address and shares one
 *      rate-limit bucket.
 *    - 'X-Forwarded-Proto' / 'X-Forwarded-Host': the scheme and host the client
 *      addressed. Stamped for parity with what Caddy already sets on traffic
 *      that reaches the AppView directly; the backend does not consume either
 *      one today. Note X-Forwarded-Host is only as trustworthy as adapter-node's
 *      URL resolution: ORIGIN must be set in production, or url.host is derived
 *      from the client's raw Host header and the value is a client claim.
 *    - 'Authorization': Bearer token from the session cookie, when supplied.
 *
 * 3. The incoming Cookie and Authorization headers are never forwarded. The
 *    sealed session cookie is read only to inject the Bearer credential; it
 *    does not prove authentication. The backend owns session validation.
 *    Generic XRPC errors do not clear the browser's session cookie.
 *    Expiration cleanup belongs to page /api/me validation; authenticated
 *    browser 401 responses trigger invalidateAll() to rerun that validation.
 *    OptionalAuth endpoints returning anonymous 200 responses cannot trigger it.
 *
 * 4. Denylisted from the response (DENIED_RESPONSE_HEADERS): connection framing,
 *    the backend's credential/cookie headers, and the headers that set policy
 *    for an origin the backend does not own are terminated here; payload and
 *    metadata headers pass through. Hop-by-hop headers nominated by name in the
 *    upstream's `Connection` / `Proxy-Connection` are dropped too, since a
 *    nominated header is no more forwardable than a hardcoded one. Rationale
 *    per group lives on that constant.
 *
 * 5. Responses to requests supplying a session credential are marked
 *    `cache-control: private, no-store` and
 *    stripped of their validators (CACHE_VALIDATOR_HEADERS). The backend
 *    describes what it returns as if answering a bare request, unaware the
 *    proxy attached a session, so its caching headers are not safe to relay for
 *    a response that may be specific to one account. This applies even when
 *    the credential is invalid or the backend returns an error. Requests with
 *    no session credential keep the backend's caching headers exactly as sent.
 *
 * =============================================================================
 */

/**
 * The only client-supplied request headers that reach the backend. These carry
 * content negotiation and conditional-request state the backend needs to answer
 * correctly; every other header is either the proxy's to stamp (authorization,
 * client address) or none of the backend's business (cookies, custom headers).
 *
 * 'accept-encoding' is deliberately absent: fetch negotiates and decodes its
 * own encoding for the upstream hop, so the client's preference has nothing to
 * act on — it is irrelevant here rather than harmful. (The same decoding is why
 * content-encoding/content-length are stripped from the response.)
 *
 * 'range', 'if-match' and 'if-modified-since' are deliberately excluded too:
 * the backend supports none of them, and image/blob traffic does not go through
 * this proxy. Adding any of them means adding the matching response-side
 * handling (206 Partial Content, 304 Not Modified) at the same time — forwarding
 * the request header alone would invite responses this proxy does not frame
 * correctly.
 */
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'if-none-match',
  'user-agent',
] as const satisfies readonly Lowercase<string>[]

/**
 * Upstream response headers that are terminated here rather than relayed to the
 * browser. Everything not listed passes through untouched.
 *
 * Connection framing (transfer-encoding, connection, keep-alive, upgrade, te,
 * trailer) describes the hop between the proxy and the backend, which ends
 * here; the server frames the browser hop itself.
 *
 * 'content-encoding' and 'content-length' need the same treatment for a
 * subtler reason: fetch transparently decompresses the upstream body, so the
 * upstream values describe *compressed* bytes we no longer forward. Leaving
 * content-length set advertises the compressed length for a decompressed body
 * (observed as a truncated read surfacing as a JSON parse error), and leaving
 * content-encoding set tells the browser to inflate already-inflated bytes.
 * Bodies leave this process uncompressed: neither SvelteKit nor adapter-node
 * compresses dynamic responses (sirv only serves precompressed static assets),
 * so if the browser hop is compressed at all it is the reverse proxy in front
 * of the frontend that does it (Caddy `encode`).
 *
 * Prior art: kit performs this exact pair of deletes on its own fetch
 * responses — see kit/src/runtime/server/respond.js ("if content-encoding,
 * delete content-encoding and content-length") and sveltejs/kit#12197.
 *
 * Credential and state headers (set-cookie, www-authenticate,
 * proxy-authenticate, clear-site-data) would let the backend set or clear
 * state on the frontend origin — an origin it does not own. Session state
 * belongs to the OAuth flow, not to a proxied API call.
 *
 * Origin policy (strict-transport-security, alt-svc, the access-control-*
 * family, nel, report-to, reporting-endpoints, accept-ch) is the same problem
 * one level up: these configure the *origin* rather than describe the payload,
 * and the origin the browser applies them to is the frontend's, not the
 * backend's. Relayed, the backend could pin HSTS across the app's domain,
 * redirect it to another endpoint via alt-svc, aim telemetry reports at a host
 * of its choosing, or answer a CORS preflight the frontend never authorised —
 * `access-control-allow-origin: *` alongside allow-credentials being the
 * sharpest example. The frontend owns its origin's policy; the backend gets to
 * describe its payload.
 */
const DENIED_RESPONSE_HEADERS = [
  'set-cookie',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-connection',
  'upgrade',
  'te',
  'trailer',
  'proxy-authenticate',
  'www-authenticate',
  'clear-site-data',
  'strict-transport-security',
  'alt-svc',
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-expose-headers',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-max-age',
  'nel',
  'report-to',
  'reporting-endpoints',
  'accept-ch',
] as const satisfies readonly Lowercase<string>[]

/**
 * Response headers that describe a *shared* cacheable artefact. When the proxy
 * has attached a session token the response is not one, so these are replaced
 * rather than relayed — see the caching block in the handler.
 */
const CACHE_VALIDATOR_HEADERS = [
  'etag',
  'last-modified',
  'expires',
] as const satisfies readonly Lowercase<string>[]

/**
 * The slice of the SvelteKit request event the proxy actually uses. Narrowing
 * structurally (rather than taking a full RequestEvent) keeps the exported
 * handlers assignable to RequestHandler while enforcing least privilege on the
 * handler itself. The cookie API is read-only; the handler cannot set or
 * delete cookies.
 */
type ProxyRequestEvent = Pick<
  RequestEvent<{ path: string }>,
  'params' | 'request' | 'url' | 'getClientAddress'
> & {
  cookies: Pick<RequestEvent['cookies'], 'get'>
  locals: Pick<App.Locals, 'requestId'>
}

/**
 * Handles proxying requests to the upstream Coves server.
 * Injects the Authorization header from the selected opaque cookie if available.
 */
async function handler({
  params,
  request,
  cookies,
  locals,
  url,
  getClientAddress,
}: ProxyRequestEvent): Promise<Response> {
  const path = params.path

  // CSRF defense-in-depth: reject cross-origin state-changing requests
  // (see enforceSameOrigin for the full policy rationale).
  const csrfRejection = enforceSameOrigin(
    request,
    url.origin,
    path,
    locals.requestId,
  )
  if (csrfRejection) {
    return csrfRejection
  }

  // Validate path for security issues
  const pathError = validateProxyPath(path)
  if (pathError) {
    return new Response(
      JSON.stringify({ error: 'Bad Request', message: pathError }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  // Every request targets the operator-configured upstream, normalized so a
  // bare hostname still becomes an absolute https:// URL.
  let baseUrl: string | null
  try {
    baseUrl = normalizeInstanceUrl(upstreamInstanceUrl())
  } catch (error) {
    // Preserve the configuration failure in logs while returning a generic 500.
    log.error('[proxy] upstream instance unresolved', undefined, error)
    baseUrl = null
  }
  if (!baseUrl) {
    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
        message: 'No instance URL configured',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  // In production, only allow HTTPS URLs to prevent MITM attacks, unless the
  // operator opted a specific private-network origin into plaintext via
  // ALLOW_HTTP_INTERNAL_INSTANCE (policy in $lib/app/state/instance/resolve).
  if (import.meta.env.PROD && !upstreamSchemeAllowed(baseUrl)) {
    return new Response(
      JSON.stringify({
        error: 'Bad Request',
        message: 'HTTP URLs are not allowed in production',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
  // Remove trailing slash from baseUrl if present to avoid double slashes
  // Preserve query parameters from the original request
  const requestUrl = new URL(request.url)
  const queryString = requestUrl.search
  const targetUrl = `${baseUrl.replace(/\/$/, '')}/${path}${queryString}`

  // Build headers for upstream request. The client is untrusted, so the
  // upstream request is assembled from scratch: only the allowlisted
  // content-negotiation headers are copied across, and everything else the
  // client sent (cookies, forged credentials, hop-by-hop framing, custom
  // headers) is left behind.
  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value !== null) {
      headers.set(name, value)
    }
  }

  // Stamp the connection metadata the backend is entitled to trust. This runs
  // after the allowlist filter, so any client-supplied x-forwarded-*, x-real-ip
  // or RFC 7239 `Forwarded` header has already been dropped and cannot be
  // confused with — or appended to — what we observed ourselves.
  //
  // Proto and Host are stamped for parity with what Caddy sets on traffic that
  // reaches the AppView directly; the backend consumes neither one today. Host
  // rather than hostname, so a non-default port survives — but note the value
  // is only as trustworthy as adapter-node's URL resolution: with ORIGIN unset
  // in production, url.host comes from the client's own Host header.
  headers.set('X-Forwarded-Proto', url.protocol.replace(/:$/, ''))
  headers.set('X-Forwarded-Host', url.host)
  // Guarded inside: a missing ADDRESS_HEADER degrades to "no address claim",
  // never a failed request or a client-supplied address (see the helper).
  stampClientAddress(headers, getClientAddress, 'proxy')

  // Inject Authorization header from the sealed session cookie.
  // The sealed token is opaque to the browser (encrypted by the Go backend),
  // so raw access/refresh tokens are never exposed to client-side code.
  const covesSession = cookies.get('coves_session')
  if (covesSession) {
    try {
      headers.set('Authorization', `Bearer ${covesSession}`)
    } catch {
      // Reject values that cannot be represented in an HTTP header without
      // exposing the credential through the platform's exception message.
      return new Response(
        JSON.stringify({
          error: 'Bad Request',
          message: 'Invalid session credential header',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-store',
          },
        },
      )
    }
  }

  try {
    // Forward request
    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
      // Relay 3xx to the client; never follow it here. See the TRANSPORT note.
      redirect: 'manual',
    }

    // Only include body for methods that support it.
    // We consume the body as a Blob rather than streaming request.body
    // (ReadableStream) because Node.js undici has issues with ReadableStream
    // bodies in fetch(), causing "expected non-null body source" errors.
    // Using Blob handles both text and binary content types correctly.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = await request.blob()
    }

    // Bound upstream latency: a hung backend must fail this request rather
    // than accumulate pending connections until the process is starved.
    // The signal is created only after the client body has been fully read,
    // so a slow client upload doesn't eat into the upstream's 30s budget.
    // Known limitation (accepted risk): the signal continues to govern the
    // response body stream after headers return, so an upstream stream that
    // takes >30s in total is truncated mid-stream rather than mapped to 504.
    fetchOptions.signal = AbortSignal.timeout(30_000)

    // globalThis.fetch, never event.fetch — see the TRANSPORT note in the
    // banner. kit's fetch would re-add the very headers the allowlist drops.
    const response = await globalThis.fetch(targetUrl, fetchOptions)

    // Return the response, terminating the headers that belong to the upstream
    // hop or to an origin the backend does not own (see
    // DENIED_RESPONSE_HEADERS). Everything else — content-type, caching and
    // rate-limit metadata, custom headers — passes through.
    const responseHeaders = new Headers(response.headers)
    // `Connection` does not just describe itself: it nominates further headers
    // as hop-by-hop by name, and a nominated header is no more forwardable than
    // a hardcoded one. Read it before the fixed list deletes it.
    for (const nominator of ['connection', 'proxy-connection'] as const) {
      const nominated = responseHeaders.get(nominator)
      if (nominated === null) continue
      for (const name of nominated.split(',')) {
        // Skip empty tokens: a trailing comma would otherwise reach
        // Headers.delete('') and throw on an otherwise fine response.
        const hopByHop = name.trim().toLowerCase()
        if (hopByHop) responseHeaders.delete(hopByHop)
      }
    }
    for (const name of DENIED_RESPONSE_HEADERS) {
      responseHeaders.delete(name)
    }

    // A supplied credential may personalize any response, including errors.
    // Caches in front of the frontend cannot see the injected Authorization
    // header, so prevent storage and revalidation regardless of whether the
    // backend accepted the credential. Without a credential, preserve the
    // backend's caching policy.
    //
    // Dropping the validators costs nothing today: the backend only honours
    // If-None-Match on the image proxy, which does not route through here.
    if (covesSession) {
      responseHeaders.set('cache-control', 'private, no-store')
      for (const name of CACHE_VALIDATOR_HEADERS) {
        responseHeaders.delete(name)
      }
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (error) {
    // The per-request id minted in hooks.server.ts, in full. Three things carry
    // it — the `x-request-id` response header, the 502/504 body below, and this
    // log line — so a report of "502, id abc" can be traced across all three.
    const requestId = locals.requestId

    // Connection error to upstream. Only safe request context is logged; the
    // error travels through log's `err` parameter so it is scrubbed.
    log.error(
      `[proxy] Proxy error ${request.method} /${path}`,
      { requestId, method: request.method, path: `/${path}` },
      error,
    )
    // Name-based check rather than `instanceof DOMException`: under other
    // runtimes (e.g. the Bun adapter) the abort error may not be a
    // DOMException, but timeout aborts are always named 'TimeoutError'.
    // DOMException subclasses Error in modern runtimes, so this narrows safely.
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return new Response(
      JSON.stringify({
        error: timedOut ? 'Gateway Timeout' : 'Bad Gateway',
        message: timedOut
          ? 'Upstream server timed out'
          : 'Failed to connect to upstream server',
        requestId,
      }),
      {
        status: timedOut ? 504 : 502,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}

// Handle all HTTP methods by wrapping the handler
export const GET: RequestHandler = (event) => handler(event)
export const POST: RequestHandler = (event) => handler(event)
export const PUT: RequestHandler = (event) => handler(event)
export const DELETE: RequestHandler = (event) => handler(event)
export const PATCH: RequestHandler = (event) => handler(event)
