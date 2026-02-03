import { randomBytes, timingSafeEqual } from 'crypto'

// ============================================================================
// Branded Types for Type-Safe CSRF State
// ============================================================================

/**
 * Branded type for OAuth CSRF state tokens.
 * These are 64-character hex strings (32 bytes of entropy).
 */
export type OAuthState = string & { readonly __brand: 'OAuthState' }

/**
 * Type guard to validate OAuthState format.
 * State tokens must be 64-character hexadecimal strings.
 *
 * @param value - The string to validate
 * @returns True if the value matches the OAuthState format
 */
export function isValidOAuthState(value: string): value is OAuthState {
  return /^[a-f0-9]{64}$/.test(value)
}

/**
 * Creates a branded OAuthState from a string.
 * @throws Error if the value is not a valid OAuthState format
 */
export function asOAuthState(value: string): OAuthState {
  if (!isValidOAuthState(value)) {
    throw new Error(`Invalid OAuthState format: expected 64 hex characters, got ${value.length} characters`)
  }
  return value
}

/**
 * Safely attempts to create a branded OAuthState from a string.
 * @returns The branded OAuthState or null if invalid
 */
export function tryAsOAuthState(value: string): OAuthState | null {
  return isValidOAuthState(value) ? value : null
}

// ============================================================================
// State Generation
// ============================================================================

/**
 * Generates a cryptographically secure random state for OAuth CSRF protection.
 * Uses crypto.randomBytes(32) for 256 bits of entropy.
 *
 * @returns A 64-character hex string as an OAuthState branded type
 */
export function generateOAuthState(): OAuthState {
  return randomBytes(32).toString('hex') as OAuthState
}

// ============================================================================
// State Validation
// ============================================================================

/**
 * Validates that two OAuth state strings match using a timing-safe comparison.
 * This prevents timing attacks that could be used to infer state values.
 *
 * @param expected - The expected state value (stored in session)
 * @param actual - The actual state value (received from callback)
 * @returns True if the states match, false otherwise
 */
export function validateOAuthState(expected: string, actual: string): boolean {
  // Early return on length mismatch is acceptable here because:
  // 1. The state parameter is visible in the URL, so attackers already know its length
  // 2. Valid OAuth states are always 64 hex characters, so length leakage reveals nothing
  // 3. The actual value comparison below uses timing-safe comparison
  if (expected.length !== actual.length) {
    return false
  }

  // Use timing-safe comparison to prevent timing attacks
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const actualBuffer = Buffer.from(actual, 'utf8')

  return timingSafeEqual(expectedBuffer, actualBuffer)
}

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
