import { describe, it, expect, vi, beforeEach } from 'vitest'

interface RedirectError {
  status: number
  location: string
}

// Use vi.hoisted to define mutable state accessible in the mock factory
const mockProfile = vi.hoisted(() => ({
  current: {
    type: 'guest' as 'guest' | 'authenticated',
    handle: undefined as string | undefined,
    did: undefined as string | undefined,
  },
}))

vi.mock('$lib/app/auth.svelte', () => ({
  profile: mockProfile,
}))

import { load } from './+page'

describe('/profile redirect', () => {
  beforeEach(() => {
    mockProfile.current = { type: 'guest', handle: undefined, did: undefined }
  })

  it('redirects to /profile/{handle} when user has a handle', () => {
    mockProfile.current = {
      type: 'authenticated',
      handle: 'alice.coves.social',
      did: 'did:plc:abc123',
    }

    try {
      load()
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(302)
      expect(redirect.location).toBe('/profile/alice.coves.social')
    }
  })

  it('redirects to /profile/{did} when user has no handle but has a DID', () => {
    mockProfile.current = {
      type: 'authenticated',
      handle: undefined,
      did: 'did:plc:abc123',
    }

    try {
      load()
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(302)
      expect(redirect.location).toBe('/profile/did%3Aplc%3Aabc123')
    }
  })

  it('redirects to /login when user is a guest', () => {
    mockProfile.current = { type: 'guest', handle: undefined, did: undefined }

    try {
      load()
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(302)
      expect(redirect.location).toBe('/login')
    }
  })

  it('encodes special characters in handle', () => {
    mockProfile.current = {
      type: 'authenticated',
      handle: 'user@example.com',
      did: 'did:plc:xyz789',
    }

    try {
      load()
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(302)
      expect(redirect.location).toBe('/profile/user%40example.com')
    }
  })

  it('redirects to /login when user type is guest even with handle', () => {
    mockProfile.current = {
      type: 'guest',
      handle: 'stale-handle',
      did: undefined,
    }

    try {
      load()
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(302)
      expect(redirect.location).toBe('/login')
    }
  })
})
