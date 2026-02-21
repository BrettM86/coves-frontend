import type { RequestHandler } from './$types'
import { DEFAULT_INSTANCE_URL } from '$lib/app/instance.svelte'

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
 * Validates a proxy path for security issues.
 * Returns an error message if the path is invalid, or null if it's safe.
 *
 * Security checks performed:
 * 1. Null bytes - can be used to bypass filters or truncate paths
 * 2. Protocol schemes - prevents javascript:, data:, or other protocol injection
 * 3. Path traversal - blocks ../ patterns and their encoded variants
 * 4. Backslash - Windows separator that could bypass Unix-style checks
 * 5. Encoded separators - %2F (/), %5C (\) that could bypass validation
 */
function validateProxyPath(path: string): string | null {
  // Check for null bytes (can be used to bypass filters)
  if (path.includes('\x00')) {
    return 'Invalid path: null bytes not allowed'
  }

  // Check for protocol injection attempts
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return 'Invalid path: protocol schemes not allowed'
  }

  // Check for path traversal patterns
  // This catches: ../, ..\, and URL-encoded variants like %2F, %5C
  const traversalPattern =
    /(?:^|[\\/])\.\.(?:[\\/]|$)|%2e%2e|%252e|%c0%ae|%c1%9c/i
  if (traversalPattern.test(path)) {
    return 'Invalid path: path traversal not allowed'
  }

  // Check for backslash (Windows path separator that could bypass checks)
  if (path.includes('\\')) {
    return 'Invalid path: backslash not allowed'
  }

  // Check for URL-encoded separators that might bypass validation
  // %2F = /, %5C = \
  if (/%2f|%5c/i.test(path)) {
    return 'Invalid path: encoded path separators not allowed'
  }

  return null
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
  let baseUrl: string
  if (instance.startsWith('http://') || instance.startsWith('https://')) {
    // Instance already has protocol, use as-is
    baseUrl = instance
  } else {
    // Instance is just hostname, add https://
    baseUrl = `https://${instance}`
  }

  // In production, only allow HTTPS URLs to prevent MITM attacks
  if (import.meta.env.PROD && baseUrl.startsWith('http://')) {
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
    const fetchOptions: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers,
    }

    // Only include body for methods that support it
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = request.body
      fetchOptions.duplex = 'half' // Required for streaming body
    }

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
    return new Response(
      JSON.stringify({
        error: 'Bad Gateway',
        message: 'Failed to connect to upstream server',
        requestId,
      }),
      {
        status: 502,
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
