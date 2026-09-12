import { beforeEach, describe, expect, it, vi } from 'vitest'

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

function loadArgs(): Parameters<typeof load>[0] {
  return {
    url: new URL('https://coves.example/'),
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
    state.api.getTimeline.mockReset()
  })

  it('uses discover for a signed-out visit without overwriting the saved timeline default', async () => {
    const result = await load(loadArgs())

    expect(state.api.getDiscover).toHaveBeenCalledTimes(1)
    expect(state.api.getTimeline).not.toHaveBeenCalled()
    expect(result.filters.value.type_).toBe('discover')
    expect(state.settings.defaultSort.feed).toBe('timeline')
  })
})
