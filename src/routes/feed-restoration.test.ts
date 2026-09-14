import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: false,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.test' },
}))

const state = vi.hoisted(() => ({
  settings: {
    defaultSort: { feed: 'discover', sort: 'hot', timeframe: 'all' },
  },
  profile: { isAuthenticated: false, meta: { profile: undefined } },
  api: {
    getDiscover: vi.fn(),
    getTimeline: vi.fn(),
    getCommunityFeed: vi.fn(),
    getCommunity: vi.fn(),
  },
}))

vi.mock('$lib/app/state/settings.svelte', () => ({ settings: state.settings }))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile: state.profile }))
vi.mock('$lib/app/state/i18n', () => ({
  t: { get: (key: string) => key },
}))
vi.mock('$lib/api/client.svelte', () => ({ coves: () => state.api }))

import { feeds } from '$lib/feature/feeds/feed.svelte'
import { load as loadHome } from './+page'
import { load as loadCommunity } from './c/[handle=handle]/+page'

interface RuntimeFeedValue {
  virtualList?: { itemHeights: (number | null)[] }
}

function homeArgs(query = ''): Parameters<typeof loadHome>[0] {
  return {
    url: new URL(`https://coves.test/${query}`),
    fetch: globalThis.fetch,
    route: { id: '/' },
  } as Parameters<typeof loadHome>[0]
}

function communityArgs(query = ''): Parameters<typeof loadCommunity>[0] {
  return {
    params: { handle: 'gardening.test' },
    url: new URL(`https://coves.test/c/gardening.test${query}`),
    fetch: globalThis.fetch,
    route: { id: '/c/[handle=handle]' },
  } as unknown as Parameters<typeof loadCommunity>[0]
}

beforeEach(() => {
  feeds.clear()
  state.api.getDiscover.mockReset().mockResolvedValue({ feed: [] })
  state.api.getTimeline.mockReset().mockResolvedValue({ feed: [] })
  state.api.getCommunityFeed.mockReset().mockResolvedValue({ feed: [] })
  state.api.getCommunity.mockReset().mockResolvedValue({
    did: 'did:plc:gardening',
    handle: 'gardening.test',
  })
})

const loaders = [
  {
    name: 'home',
    load: async (query = '') => {
      const result = await loadHome(homeArgs(query))
      return (await result.feed.value) as RuntimeFeedValue
    },
  },
  {
    name: 'community',
    load: async (query = '') =>
      (await loadCommunity(communityArgs(query))) as RuntimeFeedValue,
  },
]

describe.each(loaders)(
  '$name cached feed restoration ownership',
  ({ load }) => {
    it('retains restoration on a cache hit and initializes it fresh after a refetch', async () => {
      const first = await load()
      expect(first.virtualList).toEqual({ itemHeights: [] })
      if (!first.virtualList) return
      const firstRestoration = first.virtualList
      firstRestoration.itemHeights.push(120)

      const cacheHit = await load()
      expect(cacheHit.virtualList).toBe(firstRestoration)
      expect(cacheHit.virtualList?.itemHeights).toEqual([120])

      const changed = await load('?sort=new')
      expect(changed.virtualList).toEqual({ itemHeights: [] })
      expect(changed.virtualList).not.toBe(firstRestoration)
    })
  },
)
