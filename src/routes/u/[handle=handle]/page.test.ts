import { describe, it, expect } from 'vitest'
import { load } from './+page'

interface RedirectError {
  status: number
  location: string
}

describe('/u/[handle=handle] redirect', () => {
  // All fixture params must be matcher-valid — the [handle=handle] matcher
  // only routes handles (dotted domains) and DIDs, so a bare name like
  // "alice" would never reach this load function.
  it('redirects to /profile/{handle} with 301 status', () => {
    const params = { handle: 'alice.coves.social' }
    const url = new URL('http://localhost/u/alice.coves.social')

    try {
      load({ params, url } as Parameters<typeof load>[0])
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(301)
      expect(redirect.location).toBe('/profile/alice.coves.social')
    }
  })

  it('preserves query parameters in redirect', () => {
    const params = { handle: 'alice.coves.social' }
    const url = new URL('http://localhost/u/alice.coves.social?sort=top&page=2')

    try {
      load({ params, url } as Parameters<typeof load>[0])
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(301)
      expect(redirect.location).toBe(
        '/profile/alice.coves.social?sort=top&page=2',
      )
    }
  })

  it('encodes special characters in a DID param', () => {
    // DIDs are the matcher-valid param form that needs URL encoding (colons).
    const params = { handle: 'did:plc:abc123' }
    const url = new URL('http://localhost/u/did:plc:abc123')

    try {
      load({ params, url } as Parameters<typeof load>[0])
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(301)
      expect(redirect.location).toBe('/profile/did%3Aplc%3Aabc123')
    }
  })

  it('redirects with empty query string when no params', () => {
    const params = { handle: 'bob.example.com' }
    const url = new URL('http://localhost/u/bob.example.com')

    try {
      load({ params, url } as Parameters<typeof load>[0])
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(301)
      expect(redirect.location).toBe('/profile/bob.example.com')
    }
  })
})
