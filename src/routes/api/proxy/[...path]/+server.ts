import type { RequestHandler } from './$types'
import { env } from '$env/dynamic/private'
import { env as publicEnv } from '$env/dynamic/public'
import { DEFAULT_INSTANCE_URL } from '$lib/app/instance.svelte'
import { validateProxyPath } from '../validate'

/**
 * =============================================================================
 * API PROXY SECURITY MODEL
 * =============================================================================
 *
 * PURPOSE:
 * This proxy exists to keep authentication tokens secure by never exposing them
 * to the browser. Authentication is managed via a backend-delegated session: the
 * Coves Go backend sets a sealed (encrypted) session cookie during OAuth, and
 * the SvelteKit frontend forwards that cookie to the backend's /api/me endpoint
 * for validation. The proxy injects the Authorization header (using the sealed
 * token from the cookie) on behalf of the client, so the client never needs to
 * handle or store tokens.
 *
 * TRUST MODEL:
 * - Client -> Proxy: Client is untrusted. All paths are validated for security
 *   issues (traversal, injection, etc.). The proxy only forwards to the
 *   pre-configured backend instance URL from the user's session.
 * - Proxy -> Backend: Backend is trusted. The proxy forwards requests with
 *   auth headers to the Coves server at the user's registered instance URL.
 *
 * PATH VALIDATION:
 * The path is validated to prevent:
 * - Path traversal attacks (../ patterns)
 * - Null byte injection (can truncate paths)
 * - Protocol injection (javascript:, data:, etc.)
 * - Encoded path separators that could bypass validation
 *
 * HEADER HANDLING:
 * Stripped from request:
 * - 'host': Prevents host header attacks; backend should see its own host
 * - 'connection': Hop-by-hop header, not meant to be forwarded
 *
 * Added to request:
 * - 'Authorization': Bearer token from encrypted session (if authenticated)
 *
 * Stripped from response:
 * - 'content-encoding': Let SvelteKit handle compression; avoids double-encoding
 *
 * =============================================================================
 */

/**
 * Resolves an instance value (which may lack a scheme) to a URL origin,
 * applying the same https:// protocol-defaulting used when deriving the
 * proxy target from the session instance. Returns null when the value is
 * empty or unparseable.
 */
function toOrigin(instance: string | undefined): string | null {
  if (!instance) return null
  const withProtocol =
    instance.startsWith('http://') || instance.startsWith('https://')
      ? instance
      : `https://${instance}`
  try {
    return new URL(withProtocol).origin
  } catch {
    return null
  }
}

/**
 * Handles proxying requests to the upstream Coves server.
 * Injects the Authorization header from the session if available.
 */
async function handler({
  params,
  request,
  locals,
  fetch: fetchFn,
}: {
  params: { path: string }
  request: Request
  locals: App.Locals
  fetch: typeof fetch
}): Promise<Response> {
  const path = params.path

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

  // Determine target instance (from session or default)
  // Instance may already include protocol (e.g., "https://coves.social") or be just the hostname
  const instance = locals.auth.authenticated
    ? locals.auth.account.instance
    : DEFAULT_INSTANCE_URL
  if (!instance) {
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
  let baseUrl: string
  if (instance.startsWith('http://') || instance.startsWith('https://')) {
    // Instance already has protocol, use as-is
    baseUrl = instance
  } else {
    // Instance is just hostname, add https://
    baseUrl = `https://${instance}`
  }

  // In production, only allow HTTPS URLs to prevent MITM attacks.
  // ALLOW_HTTP_INTERNAL_INSTANCE=true is an explicit operator opt-in for
  // deployments that reach the backend over a private network (e.g. the
  // Docker service `http://appview:8080`), where plaintext is the norm.
  // The exemption is scoped: plaintext is permitted ONLY when the target
  // origin equals the operator-configured PUBLIC_INTERNAL_INSTANCE (which
  // must carry an explicit http:// scheme to match) — a session-derived
  // instance can never downgrade the proxy to http://.
  if (import.meta.env.PROD && baseUrl.startsWith('http://')) {
    const allowedHttpOrigin =
      env.ALLOW_HTTP_INTERNAL_INSTANCE === 'true'
        ? toOrigin(publicEnv.PUBLIC_INTERNAL_INSTANCE)
        : null
    const targetOrigin = toOrigin(baseUrl)
    if (
      allowedHttpOrigin === null ||
      targetOrigin === null ||
      targetOrigin !== allowedHttpOrigin
    ) {
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
  }
  // Remove trailing slash from baseUrl if present to avoid double slashes
  // Preserve query parameters from the original request
  const requestUrl = new URL(request.url)
  const queryString = requestUrl.search
  const targetUrl = `${baseUrl.replace(/\/$/, '')}/${path}${queryString}`

  // Build headers for upstream request
  const headers = new Headers(request.headers)

  // Strip hop-by-hop and security-sensitive headers
  // 'host' - Prevents host header attacks; backend should receive its own host
  // 'connection' - Hop-by-hop header, not meant to be forwarded through proxies
  headers.delete('host')
  headers.delete('connection')

  // Inject Authorization header from the sealed session cookie.
  // The sealed token is opaque to the browser (encrypted by the Go backend),
  // so raw access/refresh tokens are never exposed to client-side code.
  if (locals.auth.authenticated) {
    headers.set('Authorization', `Bearer ${locals.auth.authToken}`)
  }

  try {
    // Forward request
    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
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

    const response = await fetchFn(targetUrl, fetchOptions)

    // Return response, stripping headers that SvelteKit should handle
    const responseHeaders = new Headers(response.headers)
    // 'content-encoding' - Let SvelteKit handle compression to avoid double-encoding
    responseHeaders.delete('content-encoding')

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (error) {
    // Generate a unique request ID for error correlation
    const requestId = crypto.randomUUID().slice(0, 8) // Short ID for easier reference

    // Connection error to upstream - include request context for debugging
    console.error(
      `Proxy error [${request.method} /${path}] [requestId: ${requestId}]:`,
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
