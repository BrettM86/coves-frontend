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

vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: mockProfile,
}))

import { load } from './+page'
import type { PageLoadEvent } from './$types'

// These loads only read URL and the separately controlled authentication state.
const loadPage = load as (
  event: Pick<PageLoadEvent, 'url'>,
) => ReturnType<typeof load>

/**
 * SvelteKit's tracked URL throws on `url.hash` during load. Mirror that guard so
 * any regression that reads the hash fails here instead of in the browser.
 */
function loadUrl(href: string): URL {
  const url = new URL(href)
  Object.defineProperty(url, 'hash', {
    get() {
      throw new Error('Cannot access url.hash during load')
    },
  })
  return url
}

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
      loadPage({
        url: loadUrl('https://web.example.invalid/profile?tab=comments#latest'),
      })
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
      loadPage({
        url: loadUrl('https://web.example.invalid/profile?tab=comments#latest'),
      })
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
      loadPage({
        url: loadUrl('https://web.example.invalid/profile?tab=comments#latest'),
      })
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(302)
      const target = new URL(redirect.location, 'https://web.example.invalid')
      expect(target.pathname).toBe('/login')
      expect(target.searchParams.get('redirect')).toBe('/profile?tab=comments')
    }
  })

  it('encodes special characters in handle', () => {
    mockProfile.current = {
      type: 'authenticated',
      handle: 'user@example.com',
      did: 'did:plc:xyz789',
    }

    try {
      loadPage({
        url: loadUrl('https://web.example.invalid/profile?tab=comments#latest'),
      })
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
      loadPage({
        url: loadUrl('https://web.example.invalid/profile?tab=comments#latest'),
      })
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(302)
      const target = new URL(redirect.location, 'https://web.example.invalid')
      expect(target.pathname).toBe('/login')
      expect(target.searchParams.get('redirect')).toBe('/profile?tab=comments')
    }
  })
})
