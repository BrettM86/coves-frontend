// @vitest-environment jsdom
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { flushSync } from 'svelte'
import { profile } from '$lib/app/state/auth.svelte'
import {
  alice,
  createGenerationFactory,
  createSessionActions,
} from '$lib/feature/notification/notification-test-harness'
import * as pageModule from './+page'
import type { PageLoadEvent } from './$types'

// The real profile runs its browser path (storage, `expireSession`) only
// with `browser` true and the client svelte runtime.
vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$lib/app/state/instance/env', () => ({
  DEFAULT_INSTANCE_URL: 'http://localhost:8081',
  LINKED_INSTANCE_URL: undefined,
}))
vi.mock('$app/navigation', () => ({
  invalidate: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
}))
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/notifications'),
    data: {},
    params: {},
    route: { id: '/notifications' },
    status: 200,
    state: {},
  },
  navigating: { to: null },
}))
// Hoisted: this file imports svelte and the profile statically, so the mock
// factories run before the module body.
const { svelteClientEntry } = vi.hoisted(() => ({
  svelteClientEntry: async (subpath: string): Promise<unknown> => {
    const { createRequire } = await import('node:module')
    const require_ = createRequire(import.meta.url)
    return await import(
      /* @vite-ignore */
      require_.resolve('svelte/package.json').replace('package.json', subpath)
    )
  },
}))
vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))
vi.mock('svelte/reactivity', () =>
  svelteClientEntry('src/reactivity/index-client.js'),
)

const nextGeneration = createGenerationFactory('load-generation')
const { signIn } = createSessionActions(
  () => ({ profile, svelte: { flushSync } }),
  nextGeneration,
)

// The load reads only the URL, `fetch` and the root layout's session; the
// rest of the event is unused.
const loadPage = pageModule.load as (
  event: Pick<PageLoadEvent, 'url' | 'fetch'> & {
    parent: () => Promise<LayoutSession>
  },
) => ReturnType<typeof pageModule.load>

/** The part of the root layout data the load reads. */
interface LayoutSession {
  session: { authenticated: boolean } | null
  sessionExpired: boolean
}

/** The root layout data of a request with no session cookie. */
const signedOutLayout: LayoutSession = { session: null, sessionExpired: false }
/** The root layout data of a request whose cookie holds alice's session. */
const signedInLayout: LayoutSession = {
  session: { authenticated: true },
  sessionExpired: false,
}

/** The event's own fetch; the load must not call it. */
const eventFetch = vi.fn<typeof fetch>()
/** The global fetch; the load must not call it either. */
const globalFetch = vi.fn<typeof fetch>()

/**
 * SvelteKit's tracked URL throws on `url.hash` during load; the URL passed in
 * does the same, so a load that reads the hash fails here.
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

/** Runs the load; returns what it threw, or undefined when it returned. */
async function runLoad(
  href: string,
  layout: LayoutSession = signedOutLayout,
): Promise<unknown> {
  try {
    await loadPage({
      url: loadUrl(href),
      fetch: eventFetch,
      parent: async () => layout,
    })
    return undefined
  } catch (error) {
    return error
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('__VERSION__', 'test')
  eventFetch.mockReset()
  globalFetch.mockReset()
  vi.stubGlobal('fetch', globalFetch)
  profile.syncFromServer(undefined)
  flushSync()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(() => profile.mainEffect())

describe('notifications page load', () => {
  it.each([
    {
      href: 'https://web.example.invalid/notifications',
      location: '/login?redirect=%2Fnotifications',
    },
    {
      href: 'https://web.example.invalid/notifications?x=1#top',
      location: '/login?redirect=%2Fnotifications%3Fx%3D1',
    },
  ])(
    'redirects a signed-out visitor to $location',
    async ({ href, location }) => {
      expect(await runLoad(href)).toMatchObject({ status: 302, location })
    },
  )

  it('lets a signed-in visitor and an expired session through', async () => {
    expect(
      await runLoad('https://web.example.invalid/notifications'),
      'precondition: the same load redirects a signed-out visitor',
    ).toMatchObject({ status: 302 })

    signIn(alice)
    expect(
      await runLoad(
        'https://web.example.invalid/notifications',
        signedInLayout,
      ),
      'signed in',
    ).toBeUndefined()

    profile.expireSession(profile.sessionGeneration)
    flushSync()
    expect(profile.sessionExpired, 'the session is expired').toBe(true)
    expect(
      await runLoad('https://web.example.invalid/notifications'),
      'expired',
    ).toBeUndefined()
  })

  it('lets a just-signed-in visitor through while the stored profile is still the guest', async () => {
    // Cold entry after the OAuth callback: the cookie holds alice's session,
    // but the root layout has not yet synced the profile from it.
    expect(profile.isAuthenticated, 'precondition: stored guest').toBe(false)
    expect(
      await runLoad(
        'https://web.example.invalid/notifications',
        signedInLayout,
      ),
    ).toBeUndefined()
  })

  it('redirects a stored signed-in profile when the request has no session', async () => {
    signIn(alice)
    expect(
      await runLoad('https://web.example.invalid/notifications'),
    ).toMatchObject({
      status: 302,
      location: '/login?redirect=%2Fnotifications',
    })
  })

  it('lets an expired session through whether the profile or the layout reports it', async () => {
    signIn(alice)
    profile.expireSession(profile.sessionGeneration)
    flushSync()
    expect(
      await runLoad('https://web.example.invalid/notifications', {
        session: null,
        sessionExpired: false,
      }),
      'expired on the profile',
    ).toBeUndefined()

    profile.syncFromServer(undefined)
    flushSync()
    expect(profile.sessionExpired, 'precondition: not expired').toBe(false)
    expect(
      await runLoad('https://web.example.invalid/notifications', {
        session: null,
        sessionExpired: true,
      }),
      'expired in the layout',
    ).toBeUndefined()
  })

  it('renders on the client only and fetches nothing', async () => {
    expect(Reflect.get(pageModule, 'ssr'), 'ssr export').toBe(false)

    await runLoad('https://web.example.invalid/notifications')
    signIn(alice)
    await runLoad('https://web.example.invalid/notifications', signedInLayout)

    expect(eventFetch).not.toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
  })
})
