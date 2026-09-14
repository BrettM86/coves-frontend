import { beforeEach, describe, expect, it, vi } from 'vitest'
import { XrpcError } from '$lib/api/coves/xrpc'

vi.mock('$app/environment', () => ({
  browser: false,
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
  profile: { isAuthenticated: false },
  api: {
    getDiscover: vi.fn(),
    getTimeline: vi.fn(),
  },
}))

vi.mock('$lib/app/state/settings.svelte', () => ({
  settings: state.settings,
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
  } as Parameters<typeof load>[0]
}

describe('home feed loader', () => {
  beforeEach(() => {
    state.settings.defaultSort = {
      feed: 'timeline',
      sort: 'hot',
      timeframe: 'all',
    }
    state.profile.isAuthenticated = false
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
})
