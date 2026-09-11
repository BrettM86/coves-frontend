import { describe, it, expect } from 'vitest'
import { validateRequestOrigin } from './csrf'

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
