import { describe, it, expect } from 'vitest'
import { load } from './+page'

interface RedirectError {
  status: number
  location: string
}

describe('/u/[handle] redirect', () => {
  it('redirects to /profile/{handle} with 301 status', () => {
    const params = { handle: 'alice' }
    const url = new URL('http://localhost/u/alice')

    try {
      load({ params, url } as Parameters<typeof load>[0])
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(301)
      expect(redirect.location).toBe('/profile/alice')
    }
  })

  it('preserves query parameters in redirect', () => {
    const params = { handle: 'alice' }
    const url = new URL('http://localhost/u/alice?sort=top&page=2')

    try {
      load({ params, url } as Parameters<typeof load>[0])
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(301)
      expect(redirect.location).toBe('/profile/alice?sort=top&page=2')
    }
  })

  it('encodes special characters in handle', () => {
    const params = { handle: 'user@example.com' }
    const url = new URL('http://localhost/u/user@example.com')

    try {
      load({ params, url } as Parameters<typeof load>[0])
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(301)
      expect(redirect.location).toBe('/profile/user%40example.com')
    }
  })

  it('redirects with empty query string when no params', () => {
    const params = { handle: 'bob' }
    const url = new URL('http://localhost/u/bob')

    try {
      load({ params, url } as Parameters<typeof load>[0])
      expect.fail('Expected redirect to be thrown')
    } catch (e: unknown) {
      const redirect = e as RedirectError
      expect(redirect.status).toBe(301)
      expect(redirect.location).toBe('/profile/bob')
    }
  })
})
