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
