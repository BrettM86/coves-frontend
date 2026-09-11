import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockProfile = vi.hoisted(() => ({
  current: { jwt: undefined as string | undefined },
  sessionExpired: false,
}))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile: mockProfile }))
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

describe('create post authentication redirect', () => {
  beforeEach(() => {
    mockProfile.current.jwt = undefined
    mockProfile.sessionExpired = false
  })

  it('preserves the requested create page path and query for a guest', () => {
    const url = loadUrl(
      'https://web.example.invalid/create/post?community=orchids#editor',
    )
    try {
      loadPage({ url })
      expect.fail('Expected authentication redirect')
    } catch (error) {
      const redirect = error as { status: number; location: string }
      expect(redirect.status).toBe(302)
      const target = new URL(redirect.location, url.origin)
      expect(target.pathname).toBe('/login')
      expect(target.searchParams.get('redirect')).toBe(
        '/create/post?community=orchids',
      )
    }
  })

  it('allows an authenticated browser to compose a post', () => {
    mockProfile.current.jwt = 'fixture-session'
    expect(() =>
      loadPage({ url: loadUrl('https://web.example.invalid/create/post') }),
    ).not.toThrow()
  })

  it('keeps the page (and its draft) while the session is expired', () => {
    mockProfile.sessionExpired = true
    expect(() =>
      loadPage({ url: loadUrl('https://web.example.invalid/create/post') }),
    ).not.toThrow()
  })
})
