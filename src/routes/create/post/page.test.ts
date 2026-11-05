import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockProfile = vi.hoisted(() => ({
  current: { jwt: undefined as string | undefined },
  sessionExpired: false,
}))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile: mockProfile }))
import { load } from './+page'
import type { PageLoadEvent } from './$types'

/** The root layout's data the guard reads through `parent()`. */
interface LayoutSession {
  session: { authenticated: boolean } | null
  sessionExpired: boolean
}

// These loads only read the URL, the root layout's session and the separately
// controlled stored profile; the rest of the event is unused.
const loadPage = load as (
  event: Pick<PageLoadEvent, 'url'> & {
    parent: () => Promise<LayoutSession>
  },
) => Promise<void>

function withLayout(layout: LayoutSession): () => Promise<LayoutSession> {
  return async () => layout
}

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

  it('allows composing when the layout session is authenticated, before the stored profile has synced', async () => {
    expect(
      await loadPage({
        url: loadUrl(
          'https://web.example.invalid/create/post?community=orchids',
        ),
        parent: withLayout({
          session: { authenticated: true },
          sessionExpired: false,
        }),
      }),
    ).toBeUndefined()
  })

  it.each([
    { storedJwt: undefined, profileState: 'a guest stored profile' },
    {
      storedJwt: 'fixture-session',
      profileState: 'a stale stored profile',
    },
  ])(
    'redirects to login with the requested path and query, given no layout session and $profileState',
    async ({ storedJwt }) => {
      mockProfile.current.jwt = storedJwt
      const url = loadUrl(
        'https://web.example.invalid/create/post?community=orchids#editor',
      )
      let thrown: unknown
      try {
        await loadPage({
          url,
          parent: withLayout({ session: null, sessionExpired: false }),
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown, 'Expected authentication redirect').toBeDefined()
      const redirect = thrown as { status: number; location: string }
      expect(redirect.status).toBe(302)
      const target = new URL(redirect.location, url.origin)
      expect(target.pathname).toBe('/login')
      expect(target.searchParams.get('redirect')).toBe(
        '/create/post?community=orchids',
      )
    },
  )

  it.each([
    {
      expiredBy: 'the layout',
      layoutExpired: true,
      profileExpired: false,
    },
    {
      expiredBy: 'the stored profile',
      layoutExpired: false,
      profileExpired: true,
    },
  ])(
    'keeps the page (and its draft) while $expiredBy reports the session expired',
    async ({ layoutExpired, profileExpired }) => {
      mockProfile.sessionExpired = profileExpired
      expect(
        await loadPage({
          url: loadUrl('https://web.example.invalid/create/post'),
          parent: withLayout({ session: null, sessionExpired: layoutExpired }),
        }),
      ).toBeUndefined()
    },
  )
})
