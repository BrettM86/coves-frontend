import { beforeEach, describe, expect, it, vi } from 'vitest'
import { XrpcError } from '$lib/api/coves/xrpc'

const env = vi.hoisted(() => ({ browser: false }))
vi.mock('$app/environment', () => ({
  get browser() {
    return env.browser
  },
  building: false,
  dev: false,
  version: 'test',
}))

const state = vi.hoisted(() => ({
  settings: {
    defaultSort: {
      feed: 'timeline',
      sort: 'hot',
      timeframe: 'all',
    },
  },
  profile: {
    isAuthenticated: false,
    current: { type: 'guest' } as { type: string; did?: string },
  },
  // The session the server rendered with, from the cookie.
  serverSession: null as null | {
    authenticated: true
    account: { did: string }
  },
  api: {
    getDiscover: vi.fn(),
    getTimeline: vi.fn(),
  },
}))

vi.mock('$lib/app/state/settings.svelte', () => ({
  settings: state.settings,
  // What the server builds its request from: it has no saved settings.
  defaultSettings: {
    defaultSort: { feed: 'discover', sort: 'hot', timeframe: 'all' },
  },
}))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile: state.profile }))
vi.mock('$lib/api/client.svelte', () => ({ coves: () => state.api }))
vi.mock('$lib/app/state/i18n', () => ({
  t: { get: (key: string) => key },
}))
vi.mock('$lib/feature/feeds/feed.svelte', () => ({
  feed: (
    _routeId: string,
    loadFeed: (params: Record<string, unknown>) => Promise<unknown>,
  ) => ({ load: loadFeed }),
}))

import { load } from './+page'

function loadArgs(path = '/'): Parameters<typeof load>[0] {
  return {
    url: new URL(path, 'https://coves.example'),
    fetch: vi.fn() as unknown as typeof globalThis.fetch,
    route: { id: '/' },
    parent: vi.fn(async () => ({ session: state.serverSession })),
  } as unknown as Parameters<typeof load>[0]
}

// What localStorage says about the reader, which the browser load reads.
function signInBrowser(did: string | undefined): void {
  state.profile.isAuthenticated = did !== undefined
  state.profile.current = did
    ? { type: 'authenticated', did }
    : { type: 'guest' }
}

// What the session cookie said when the server rendered.
function signInServer(did: string | undefined): void {
  state.serverSession = did ? { authenticated: true, account: { did } } : null
}

describe('home feed loader', () => {
  beforeEach(() => {
    env.browser = false
    state.settings.defaultSort = {
      feed: 'timeline',
      sort: 'hot',
      timeframe: 'all',
    }
    signInBrowser(undefined)
    state.serverSession = null
    state.api.getDiscover.mockReset().mockResolvedValue({
      feed: [],
      cursor: undefined,
    })
    state.api.getTimeline.mockReset().mockResolvedValue({
      feed: [],
      cursor: undefined,
    })
  })

  it('uses discover for a signed-out visit without overwriting the saved timeline default', async () => {
    const result = await load(loadArgs())

    expect(state.api.getDiscover).toHaveBeenCalledTimes(1)
    expect(state.api.getTimeline).not.toHaveBeenCalled()
    expect(result.filters.value.type_).toBe('discover')
    expect(state.settings.defaultSort.feed).toBe('timeline')
  })

  it('dispatches pagination from the captured listing instead of the live filter', async () => {
    const result = await load(loadArgs())
    state.api.getDiscover.mockClear()
    const discoverRequest = {
      listing: 'discover',
      sort: 'hot',
      cursor: 'discover-cursor',
    }
    const timelineRequest = {
      listing: 'timeline',
      sort: 'new',
      cursor: 'timeline-cursor',
    }

    result.filters.value.type_ = 'timeline'
    await result.loadFeed(discoverRequest)

    result.filters.value.type_ = 'discover'
    await result.loadFeed(timelineRequest)

    expect(state.api.getDiscover).toHaveBeenCalledExactlyOnceWith({
      sort: 'hot',
      cursor: 'discover-cursor',
    })
    expect(state.api.getTimeline).toHaveBeenCalledExactlyOnceWith({
      sort: 'new',
      cursor: 'timeline-cursor',
    })
  })

  it('replaces a stale Discover Hot route page by recovering once from InvalidCursor', async () => {
    state.api.getDiscover
      .mockRejectedValueOnce(
        new XrpcError(400, 'InvalidCursor', 'cursor expired'),
      )
      .mockResolvedValueOnce({
        feed: [{ post: { uri: 'at://post/replacement' } }],
        cursor: 'fresh-page-2',
      })

    const result = await load(
      loadArgs('/?type=discover&sort=hot&cursor=expired-page-2'),
    )

    expect(state.api.getDiscover).toHaveBeenCalledTimes(2)
    expect(state.api.getDiscover.mock.calls).toEqual([
      [
        {
          cursor: 'expired-page-2',
          sort: 'hot',
          timeframe: 'all',
          limit: 20,
        },
      ],
      [{ cursor: undefined, sort: 'hot', timeframe: 'all', limit: 20 }],
    ])
    expect(result.feed.value).toMatchObject({
      feed: [{ post: { uri: 'at://post/replacement' } }],
      cursor: 'fresh-page-2',
      params: { cursor: 'fresh-page-2' },
    })
  })

  it('attempts stale Discover Hot route recovery only once', async () => {
    state.api.getDiscover.mockRejectedValue(
      new XrpcError(400, 'InvalidCursor', 'cursor expired'),
    )

    await expect(
      load(loadArgs('/?type=discover&sort=hot&cursor=expired-page-2')),
    ).rejects.toMatchObject({ errorName: 'InvalidCursor' })

    expect(state.api.getDiscover).toHaveBeenCalledTimes(2)
    expect(state.api.getDiscover.mock.calls[0]?.[0]).toMatchObject({
      cursor: 'expired-page-2',
    })
    expect(state.api.getDiscover.mock.calls[1]?.[0]).toMatchObject({
      cursor: undefined,
    })
  })

  // The first load in the browser, before the app has hydrated. The server
  // rendered its page from the default settings; this load reads the saved
  // ones from localStorage.
  describe('hydrating load', () => {
    beforeEach(() => {
      env.browser = true
    })

    it('awaits the request the server rendered', async () => {
      const result = await load(loadArgs())

      expect(result.feed.value).not.toBeInstanceOf(Promise)
    })

    it('streams a saved sort the server never saw', async () => {
      state.settings.defaultSort.sort = 'new'

      const result = await load(loadArgs())

      // Awaited, these posts would hydrate the server's hot rows.
      expect(state.api.getDiscover).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'new' }),
      )
      expect(result.feed.value).toBeInstanceOf(Promise)
    })

    it('streams a saved Timeline the server never saw', async () => {
      signInBrowser('did:plc:reader')
      signInServer('did:plc:reader')

      const result = await load(loadArgs())

      expect(state.api.getTimeline).toHaveBeenCalled()
      expect(result.feed.value).toBeInstanceOf(Promise)
    })

    it('awaits a saved sort the URL overrides', async () => {
      state.settings.defaultSort.sort = 'new'

      const result = await load(loadArgs('/?sort=hot'))

      expect(result.feed.value).not.toBeInstanceOf(Promise)
    })

    it('streams a later hot page read with a saved timeframe', async () => {
      state.settings.defaultSort.timeframe = 'week'

      const result = await load(
        loadArgs('/?type=discover&sort=hot&cursor=page-2'),
      )

      expect(state.api.getDiscover).toHaveBeenCalledWith(
        expect.objectContaining({ timeframe: 'week' }),
      )
      expect(result.feed.value).toBeInstanceOf(Promise)
    })

    it('hands a failed first load to the page instead of throwing', async () => {
      const failure = new XrpcError(503, 'DiscoverUnavailable', 'recovering')
      state.api.getDiscover.mockRejectedValue(failure)

      const result = await load(loadArgs())

      await expect(result.feed.value).rejects.toBe(failure)
    })

    it('awaits a Timeline the server rendered for the same reader', async () => {
      signInBrowser('did:plc:reader')
      signInServer('did:plc:reader')

      const result = await load(loadArgs('/?type=timeline'))

      expect(state.api.getTimeline).toHaveBeenCalled()
      expect(result.feed.value).not.toBeInstanceOf(Promise)
    })

    // The layout syncs the cookie's session into the browser profile only
    // after this load, so the two can disagree about who is reading.
    describe('when the session cookie and the saved profile disagree', () => {
      it('streams the Discover asked for in place of the Timeline the server rendered', async () => {
        signInServer('did:plc:reader')

        const result = await load(loadArgs('/?type=timeline'))

        expect(state.api.getDiscover).toHaveBeenCalled()
        expect(result.feed.value).toBeInstanceOf(Promise)
      })

      it('streams when a saved Timeline default fell back to Discover', async () => {
        signInServer('did:plc:reader')

        const result = await load(loadArgs())

        // Same listing, but the server rendered it for a signed-in reader.
        expect(state.api.getDiscover).toHaveBeenCalled()
        expect(result.feed.value).toBeInstanceOf(Promise)
      })

      it('streams the Timeline asked for in place of the Discover the server rendered', async () => {
        signInBrowser('did:plc:reader')

        const result = await load(loadArgs('/?type=timeline'))

        expect(state.api.getTimeline).toHaveBeenCalled()
        expect(result.feed.value).toBeInstanceOf(Promise)
      })

      it('streams a saved Timeline default the anonymous server never rendered', async () => {
        signInBrowser('did:plc:reader')

        const result = await load(loadArgs())

        expect(state.api.getTimeline).toHaveBeenCalled()
        expect(result.feed.value).toBeInstanceOf(Promise)
      })

      it('streams when the server rendered for another account', async () => {
        signInBrowser('did:plc:reader')
        signInServer('did:plc:other')

        const result = await load(loadArgs('/?type=timeline'))

        expect(result.feed.value).toBeInstanceOf(Promise)
      })
    })

    it('keeps a streamed first load that fails before the page subscribes handled', async () => {
      const failure = new XrpcError(503, 'DiscoverUnavailable', 'recovering')
      state.api.getDiscover.mockRejectedValue(failure)
      state.settings.defaultSort.sort = 'new'
      const unhandled = vi.fn()
      process.on('unhandledRejection', unhandled)

      try {
        const result = await load(loadArgs())
        // The layout load is still running, so `{#await}` has not subscribed.
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(unhandled).not.toHaveBeenCalled()
        await expect(result.feed.value).rejects.toBe(failure)
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })
  })

  describe('client-side navigation', () => {
    it('does not wait on the layout load for the server session', async () => {
      env.browser = true
      vi.resetModules()
      const { markHydrated } = await import('$lib/app/util/ssr')
      const { load: navigationLoad } = await import('./+page')
      markHydrated()
      const args = loadArgs('/?type=timeline')

      const result = await navigationLoad(args)

      expect(args.parent).not.toHaveBeenCalled()
      expect(result.feed.value).toBeInstanceOf(Promise)
    })
  })
})
