// ============================================================================
// Origin Validation
// ============================================================================

/**
 * Result of origin validation check.
 */
export interface OriginValidationResult {
  /** Whether the origin is valid (same-origin or no origin header) */
  valid: boolean
  /** Reason for the validation result (useful for logging) */
  reason?: string
}

/**
 * Validates that a request originates from the expected origin.
 * Checks the Origin header first, falling back to the Referer header.
 *
 * This helps prevent CSRF attacks by ensuring requests come from the same origin.
 * If neither Origin nor Referer headers are present, the request is considered valid
 * because some browsers strip these headers for privacy reasons.
 *
 * @param request - The incoming request object
 * @param expectedOrigin - The expected origin URL (e.g., "https://example.com")
 * @returns An object with valid status and optional reason
 */
export function validateRequestOrigin(
  request: Request,
  expectedOrigin: string
): OriginValidationResult {
  const origin = request.headers.get('Origin')
  const referer = request.headers.get('Referer')

  // Check Origin header first (preferred)
  if (origin) {
    if (origin === expectedOrigin) {
      return { valid: true, reason: 'Origin header matches expected origin' }
    }
    return {
      valid: false,
      reason: `Origin mismatch: expected "${expectedOrigin}", got "${origin}"`,
    }
  }

  // Fall back to Referer header
  if (referer) {
    try {
      const refererUrl = new URL(referer)
      const refererOrigin = refererUrl.origin

      if (refererOrigin === expectedOrigin) {
        return { valid: true, reason: 'Referer origin matches expected origin' }
      }
      return {
        valid: false,
        reason: `Referer origin mismatch: expected "${expectedOrigin}", got "${refererOrigin}"`,
      }
    } catch {
      return {
        valid: false,
        reason: `Invalid Referer URL: "${referer}"`,
      }
    }
  }

  // No Origin or Referer header - accept the request
  // Some browsers strip these headers for privacy, so we can't reject
  return {
    valid: true,
    reason: 'No Origin or Referer header present (accepted for browser compatibility)',
  }
}
