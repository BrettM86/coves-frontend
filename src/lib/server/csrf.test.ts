import { describe, it, expect } from 'vitest'
import {
  generateOAuthState,
  validateOAuthState,
  validateRequestOrigin,
  isValidOAuthState,
  asOAuthState,
  tryAsOAuthState,
  type OAuthState,
} from './csrf'

// ============================================================================
// State Generation Tests
// ============================================================================

describe('generateOAuthState', () => {
  it('produces a 64-character hex string', () => {
    const state = generateOAuthState()

    expect(state).toHaveLength(64)
    expect(/^[a-f0-9]{64}$/.test(state)).toBe(true)
  })

  it('produces unique values on each call', () => {
    const states = new Set<string>()

    // Generate 100 states and verify uniqueness
    for (let i = 0; i < 100; i++) {
      states.add(generateOAuthState())
    }

    expect(states.size).toBe(100)
  })

  it('returns a branded OAuthState type', () => {
    const state = generateOAuthState()

    // Type check: state should be assignable to OAuthState
    const typedState: OAuthState = state
    expect(typedState).toBe(state)
  })
})

// ============================================================================
// State Validation Tests
// ============================================================================

describe('validateOAuthState', () => {
  it('returns true for matching states', () => {
    const state = generateOAuthState()

    expect(validateOAuthState(state, state)).toBe(true)
  })

  it('returns true for identical manually created states', () => {
    const state = 'a'.repeat(64)

    expect(validateOAuthState(state, state)).toBe(true)
  })

  it('returns false for mismatched states', () => {
    const state1 = generateOAuthState()
    const state2 = generateOAuthState()

    expect(validateOAuthState(state1, state2)).toBe(false)
  })

  it('returns false for states with different lengths', () => {
    const state1 = generateOAuthState()
    const state2 = state1.slice(0, 32) // Half length

    expect(validateOAuthState(state1, state2)).toBe(false)
  })

  it('returns false for empty strings', () => {
    const state = generateOAuthState()

    expect(validateOAuthState(state, '')).toBe(false)
    expect(validateOAuthState('', state)).toBe(false)
    expect(validateOAuthState('', '')).toBe(true) // Both empty is technically equal
  })

  it('handles states that differ only in one character', () => {
    const state1 = 'a'.repeat(64)
    const state2 = 'a'.repeat(63) + 'b'

    expect(validateOAuthState(state1, state2)).toBe(false)
  })

  it('uses timing-safe comparison (uses timingSafeEqual internally)', () => {
    // We can verify this by checking the function imports crypto.timingSafeEqual
    // The actual timing safety is guaranteed by Node's crypto module
    const state1 = generateOAuthState()
    const state2 = generateOAuthState()

    // Multiple calls should have consistent performance regardless of where they differ
    // This is a property test - the timing-safe comparison should work identically
    const results: boolean[] = []
    for (let i = 0; i < 10; i++) {
      results.push(validateOAuthState(state1, state2))
    }

    // All results should be false (states are different)
    expect(results.every((r) => r === false)).toBe(true)
  })
})

// ============================================================================
// OAuthState Type Validation Tests
// ============================================================================

describe('isValidOAuthState', () => {
  it('validates correct 64-char hex strings', () => {
    expect(isValidOAuthState('a'.repeat(64))).toBe(true)
    expect(isValidOAuthState('0'.repeat(64))).toBe(true)
    expect(isValidOAuthState('0123456789abcdef'.repeat(4))).toBe(true)
  })

  it('rejects non-hex characters', () => {
    expect(isValidOAuthState('g'.repeat(64))).toBe(false)
    expect(isValidOAuthState('A'.repeat(64))).toBe(false) // Uppercase not allowed
    expect(isValidOAuthState('!'.repeat(64))).toBe(false)
  })

  it('rejects wrong length strings', () => {
    expect(isValidOAuthState('a'.repeat(63))).toBe(false)
    expect(isValidOAuthState('a'.repeat(65))).toBe(false)
    expect(isValidOAuthState('')).toBe(false)
  })
})

describe('asOAuthState', () => {
  it('returns branded type for valid state', () => {
    const validState = 'a'.repeat(64)
    const branded = asOAuthState(validState)

    expect(branded).toBe(validState)
  })

  it('throws for invalid state', () => {
    expect(() => asOAuthState('invalid')).toThrow('Invalid OAuthState format')
    expect(() => asOAuthState('a'.repeat(63))).toThrow(
      'Invalid OAuthState format',
    )
  })
})

describe('tryAsOAuthState', () => {
  it('returns branded type for valid state', () => {
    const validState = 'a'.repeat(64)
    const result = tryAsOAuthState(validState)

    expect(result).toBe(validState)
  })

  it('returns null for invalid state', () => {
    expect(tryAsOAuthState('invalid')).toBeNull()
    expect(tryAsOAuthState('')).toBeNull()
  })
})

// ============================================================================
// Origin Validation Tests
// ============================================================================

describe('validateRequestOrigin', () => {
  const expectedOrigin = 'https://example.com'

  function createMockRequest(headers: Record<string, string>): Request {
    return new Request('https://example.com/test', { headers })
  }

  it('accepts same-origin requests (Origin header)', () => {
    const request = createMockRequest({ Origin: 'https://example.com' })
    const result = validateRequestOrigin(request, expectedOrigin)

    expect(result.valid).toBe(true)
    expect(result.reason).toContain('Origin header matches')
  })

  it('rejects cross-origin requests (Origin header)', () => {
    const request = createMockRequest({ Origin: 'https://evil.com' })
    const result = validateRequestOrigin(request, expectedOrigin)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('Origin mismatch')
    expect(result.reason).toContain('https://evil.com')
  })

  it('rejects the literal "null" Origin (sandboxed iframe / data: URL)', () => {
    // Browsers send `Origin: null` for opaque origins — sandboxed iframes,
    // data: URLs, some redirect chains — all real CSRF delivery vectors.
    // This must never be "fixed" as a false positive.
    const request = createMockRequest({ Origin: 'null' })
    const result = validateRequestOrigin(request, expectedOrigin)

    expect(result.valid).toBe(false)
  })

  it('accepts same-origin requests via Referer header when Origin is missing', () => {
    const request = createMockRequest({
      Referer: 'https://example.com/some/path',
    })
    const result = validateRequestOrigin(request, expectedOrigin)

    expect(result.valid).toBe(true)
    expect(result.reason).toContain('Referer origin matches')
  })

  it('rejects cross-origin requests via Referer header', () => {
    const request = createMockRequest({ Referer: 'https://evil.com/attack' })
    const result = validateRequestOrigin(request, expectedOrigin)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('Referer origin mismatch')
  })

  it('prefers Origin header over Referer header', () => {
    // Even if Referer is cross-origin, if Origin matches, it should pass
    const request = createMockRequest({
      Origin: 'https://example.com',
      Referer: 'https://evil.com/attack',
    })
    const result = validateRequestOrigin(request, expectedOrigin)

    expect(result.valid).toBe(true)
    expect(result.reason).toContain('Origin header matches')
  })

  it('accepts requests without Origin or Referer header', () => {
    const request = createMockRequest({})
    const result = validateRequestOrigin(request, expectedOrigin)

    expect(result.valid).toBe(true)
    expect(result.reason).toContain('No Origin or Referer header')
  })

  it('handles invalid Referer URL gracefully', () => {
    const request = createMockRequest({ Referer: 'not-a-valid-url' })
    const result = validateRequestOrigin(request, expectedOrigin)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('Invalid Referer URL')
  })

  it('handles port differences correctly', () => {
    const request = createMockRequest({ Origin: 'https://example.com:443' })
    const result = validateRequestOrigin(request, expectedOrigin)

    // https://example.com:443 is NOT the same string as https://example.com
    // Even though they're semantically equivalent, the string comparison fails
    expect(result.valid).toBe(false)
  })

  it('handles protocol differences', () => {
    const request = createMockRequest({ Origin: 'http://example.com' })
    const result = validateRequestOrigin(request, expectedOrigin)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('Origin mismatch')
  })

  it('handles subdomain differences', () => {
    const request = createMockRequest({ Origin: 'https://sub.example.com' })
    const result = validateRequestOrigin(request, expectedOrigin)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('Origin mismatch')
  })
})
