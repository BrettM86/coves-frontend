import { validateRequestOrigin } from '$lib/server/csrf'

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
export function validateProxyPath(path: string): string | null {
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
 * CSRF defense-in-depth for state-changing proxy requests.
 *
 * SameSite=Lax on the session cookie already blocks most CSRF vectors, but
 * the proxy carries every authenticated write, so the Origin/Referer headers
 * are validated too (same policy as /api/auth/logout). GET/HEAD are exempt:
 * reads are side-effect-free and Lax deliberately allows top-level GET
 * navigations.
 *
 * Returns a 403 Response to short-circuit with, or null when the request may
 * proceed. Exported so the tests exercise the same code the route ships —
 * a test-local copy of this check would stay green if the real one were
 * removed.
 */
export function enforceSameOrigin(
  request: Request,
  expectedOrigin: string,
  path: string,
): Response | null {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return null
  }

  const originResult = validateRequestOrigin(request, expectedOrigin)
  if (originResult.valid) {
    return null
  }

  console.warn(
    `[proxy] Cross-origin ${request.method} /${path} blocked:`,
    originResult.reason,
  )
  return new Response(
    JSON.stringify({
      error: 'Forbidden',
      message: 'Cross-origin requests not allowed',
    }),
    {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}
