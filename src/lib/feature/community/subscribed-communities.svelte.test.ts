import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CommunityView,
  ListCommunitiesParams,
  ListCommunitiesResponse,
} from '$lib/api/coves/types'
import type { DID } from '$lib/types/atproto'
import {
  fetchAllSubscribedCommunities,
  isFavorite,
  isFavoritePending,
  orderSidebarCommunities,
  resetSubscribedCommunitiesState,
  subscribedCommunities,
  toggleFavorite,
  SUBSCRIBED_PAGE_LIMIT,
  type FavoriteApi,
  type SubscribedListApi,
} from './subscribed-communities.svelte'
import {
  resetSubscriptionState,
  toggleSubscription,
} from './subscription.svelte'

function did(n: string): DID {
  return `did:plc:${n.padEnd(24, 'x')}` as DID
}

function community(
  name: string,
  viewer: CommunityView['viewer'] = { subscribed: true },
): CommunityView {
  return {
    did: did(name.toLowerCase()),
    name,
    subscriberCount: 0,
    memberCount: 0,
    postCount: 0,
    viewer,
  }
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function listApi(pages: ListCommunitiesResponse[]): SubscribedListApi & {
  listCommunities: ReturnType<typeof vi.fn>
} {
  let index = 0
  return {
    listCommunities: vi.fn(async (_params: ListCommunitiesParams) => {
      const page = pages[index] ?? { communities: [] }
      index += 1
      return page
    }),
  }
}

function favoriteApi(overrides: Partial<FavoriteApi> = {}): FavoriteApi {
  return { subscribe: vi.fn(async () => undefined), ...overrides }
}

beforeEach(() => {
  resetSubscribedCommunitiesState()
  resetSubscriptionState()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('fetchAllSubscribedCommunities', () => {
  it('asks for subscribed communities alphabetically at the page limit', async () => {
    const api = listApi([{ communities: [community('a')] }])
    await fetchAllSubscribedCommunities(api)
    expect(SUBSCRIBED_PAGE_LIMIT).toBe(100)
    expect(api.listCommunities).toHaveBeenCalledTimes(1)
    expect(api.listCommunities).toHaveBeenCalledWith({
      subscribed: true,
      sort: 'alphabetical',
      limit: 100,
    })
  })

  it('follows the cursor until the server stops returning one', async () => {
    const api = listApi([
      { communities: [community('a'), community('b')], cursor: 'c1' },
      { communities: [community('c')], cursor: 'c2' },
      { communities: [community('d')] },
    ])
    const result = await fetchAllSubscribedCommunities(api)
    expect(result.map((c) => c.name)).toEqual(['a', 'b', 'c', 'd'])
    expect(api.listCommunities).toHaveBeenCalledTimes(3)
    expect(api.listCommunities.mock.calls[1]?.[0]).toMatchObject({
      cursor: 'c1',
    })
    expect(api.listCommunities.mock.calls[2]?.[0]).toMatchObject({
      cursor: 'c2',
    })
  })

  it('stops on an empty cursor', async () => {
    const api = listApi([
      { communities: [community('a')], cursor: '' },
      { communities: [community('b')] },
    ])
    const result = await fetchAllSubscribedCommunities(api)
    expect(result.map((c) => c.name)).toEqual(['a'])
    expect(api.listCommunities).toHaveBeenCalledTimes(1)
  })

  it('stops when the server repeats a cursor instead of looping forever', async () => {
    const api = listApi([
      { communities: [community('a')], cursor: 'same' },
      { communities: [community('b')], cursor: 'same' },
      { communities: [community('c')], cursor: 'same' },
    ])
    const result = await fetchAllSubscribedCommunities(api)
    expect(api.listCommunities).toHaveBeenCalledTimes(2)
    expect(result.map((c) => c.name)).toEqual(['a', 'b'])
  })

  it('drops a community that appears on two pages', async () => {
    const api = listApi([
      { communities: [community('a'), community('b')], cursor: 'c1' },
      { communities: [community('b'), community('c')] },
    ])
    const result = await fetchAllSubscribedCommunities(api)
    expect(result.map((c) => c.name)).toEqual(['a', 'b', 'c'])
  })

  it('rejects when a page fails', async () => {
    const error = new Error('boom')
    const api: SubscribedListApi = {
      listCommunities: vi
        .fn()
        .mockResolvedValueOnce({ communities: [community('a')], cursor: 'c1' })
        .mockRejectedValueOnce(error),
    }
    await expect(fetchAllSubscribedCommunities(api)).rejects.toBe(error)
  })
})

describe('orderSidebarCommunities', () => {
  it('puts favorites first, each group alphabetical ignoring case', () => {
    const input = [
      community('nba'),
      community('Android'),
      community('WritingPrompts', { subscribed: true, favorite: true }),
      community('announcements'),
      community('Fitness', { subscribed: true, favorite: true }),
      community('dataengineering', { subscribed: true, favorite: true }),
    ]
    const { favorites, others } = orderSidebarCommunities(input, isFavorite)
    expect(favorites.map((c) => c.name)).toEqual([
      'dataengineering',
      'Fitness',
      'WritingPrompts',
    ])
    expect(others.map((c) => c.name)).toEqual([
      'Android',
      'announcements',
      'nba',
    ])
  })

  it('does not reorder the input array', () => {
    const input = [community('b'), community('a')]
    orderSidebarCommunities(input, isFavorite)
    expect(input.map((c) => c.name)).toEqual(['b', 'a'])
  })

  it('orders same-named communities from different origins deterministically', () => {
    const lemmy = {
      ...community('nba'),
      did: did('lemmy'),
      origin: 'lemmy.world',
    }
    const local = { ...community('nba'), did: did('local') }
    const forward = orderSidebarCommunities([lemmy, local], isFavorite).others
    const backward = orderSidebarCommunities([local, lemmy], isFavorite).others
    expect(forward.map((c) => c.did)).toEqual(backward.map((c) => c.did))
  })
})

describe('isFavorite', () => {
  it('reads viewer.favorite', () => {
    expect(
      isFavorite(community('a', { subscribed: true, favorite: true })),
    ).toBe(true)
    expect(
      isFavorite(community('a', { subscribed: true, favorite: false })),
    ).toBe(false)
  })

  it('treats a backend without the favorite field as not favorite', () => {
    expect(isFavorite(community('a', { subscribed: true }))).toBe(false)
    expect(isFavorite({ ...community('a'), viewer: undefined })).toBe(false)
  })
})

describe('toggleFavorite', () => {
  it('stars optimistically and sends favorite: true through subscribe', async () => {
    const gate = deferred()
    const api = favoriteApi({ subscribe: vi.fn(() => gate.promise) })
    const c = community('a')

    const run = toggleFavorite(c, api)
    expect(isFavorite(c)).toBe(true)
    expect(isFavoritePending(c)).toBe(true)

    gate.resolve()
    await expect(run).resolves.toEqual({ kind: 'ok', favorite: true })
    expect(api.subscribe).toHaveBeenCalledWith({
      community: c.did,
      favorite: true,
    })
    expect(isFavorite(c)).toBe(true)
    expect(isFavoritePending(c)).toBe(false)
  })

  it('unstars with favorite: false', async () => {
    const api = favoriteApi()
    const c = community('a', { subscribed: true, favorite: true })
    await expect(toggleFavorite(c, api)).resolves.toEqual({
      kind: 'ok',
      favorite: false,
    })
    expect(api.subscribe).toHaveBeenCalledWith({
      community: c.did,
      favorite: false,
    })
    expect(isFavorite(c)).toBe(false)
  })

  it('rolls back and reports the error when the request fails', async () => {
    const error = new Error('nope')
    const api = favoriteApi({
      subscribe: vi.fn(async () => Promise.reject(error)),
    })
    const c = community('a')

    await expect(toggleFavorite(c, api)).resolves.toEqual({
      kind: 'error',
      error,
    })
    expect(isFavorite(c)).toBe(false)
    expect(isFavoritePending(c)).toBe(false)
  })

  it('rolls back to the earlier optimistic value, not the server value', async () => {
    const c = community('a')
    await toggleFavorite(c, favoriteApi())
    expect(isFavorite(c)).toBe(true)

    await toggleFavorite(
      c,
      favoriteApi({
        subscribe: vi.fn(async () => Promise.reject(new Error())),
      }),
    )
    expect(isFavorite(c)).toBe(true)
  })

  it('ignores a second press while one is in flight', async () => {
    const gate = deferred()
    const api = favoriteApi({ subscribe: vi.fn(() => gate.promise) })
    const c = community('a')

    const first = toggleFavorite(c, api)
    await expect(toggleFavorite(c, api)).resolves.toEqual({ kind: 'pending' })
    expect(api.subscribe).toHaveBeenCalledTimes(1)
    expect(isFavorite(c)).toBe(true)

    gate.resolve()
    await first
  })

  it('keeps the optimistic value while the index still reports the press-time value', async () => {
    const c = community('a', { subscribed: true, favorite: false })
    await toggleFavorite(c, favoriteApi())
    // A reload before the firehose catches up returns the old value.
    expect(
      isFavorite({ ...c, viewer: { subscribed: true, favorite: false } }),
    ).toBe(true)
  })
})

describe('subscribedCommunities store', () => {
  const OWNER = did('owner')
  const OTHER = did('other')

  it('starts idle and empty', () => {
    expect(subscribedCommunities.status).toBe('idle')
    expect(subscribedCommunities.communities).toEqual([])
  })

  it('loads every page for the owner', async () => {
    const api = listApi([
      { communities: [community('a')], cursor: 'c1' },
      { communities: [community('b')] },
    ])
    const run = subscribedCommunities.load(api, OWNER)
    expect(subscribedCommunities.status).toBe('loading')
    await run
    expect(subscribedCommunities.status).toBe('loaded')
    expect(subscribedCommunities.owner).toBe(OWNER)
    expect(subscribedCommunities.communities.map((c) => c.name)).toEqual([
      'a',
      'b',
    ])
  })

  it('reports an error and keeps nothing stale from another owner', async () => {
    await subscribedCommunities.load(
      listApi([{ communities: [community('a')] }]),
      OWNER,
    )
    const failing: SubscribedListApi = {
      listCommunities: vi.fn(async () => Promise.reject(new Error('down'))),
    }
    await subscribedCommunities.load(failing, OTHER)
    expect(subscribedCommunities.status).toBe('error')
    expect(subscribedCommunities.communities).toEqual([])
  })

  it('does not let a superseded load overwrite a newer one', async () => {
    const slow = deferred<ListCommunitiesResponse>()
    const slowApi: SubscribedListApi = {
      listCommunities: vi.fn(() => slow.promise),
    }
    const first = subscribedCommunities.load(slowApi, OWNER)
    await subscribedCommunities.load(
      listApi([{ communities: [community('fresh')] }]),
      OTHER,
    )

    slow.resolve({ communities: [community('stale')] })
    await first
    expect(subscribedCommunities.owner).toBe(OTHER)
    expect(subscribedCommunities.status).toBe('loaded')
    expect(subscribedCommunities.communities.map((c) => c.name)).toEqual([
      'fresh',
    ])
  })

  it('hides a community the viewer unsubscribes from in this session', async () => {
    const a = community('a')
    await subscribedCommunities.load(
      listApi([{ communities: [a, community('b')] }]),
      OWNER,
    )
    await toggleSubscription(a, {
      subscribe: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
    })
    expect(subscribedCommunities.communities.map((c) => c.name)).toEqual(['b'])
  })

  it('shows a community subscribed to in this session before the index catches up', async () => {
    await subscribedCommunities.load(
      listApi([{ communities: [community('b')] }]),
      OWNER,
    )
    const fresh = community('a', { subscribed: false })
    await toggleSubscription(fresh, {
      subscribe: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
    })
    subscribedCommunities.remember(fresh)
    expect(subscribedCommunities.communities.map((c) => c.name)).toContain('a')
  })

  it('does not list a remembered community twice once the server has it', async () => {
    const fresh = community('a', { subscribed: false })
    await toggleSubscription(fresh, {
      subscribe: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
    })
    subscribedCommunities.remember(fresh)
    await subscribedCommunities.load(
      listApi([{ communities: [community('a')] }]),
      OWNER,
    )
    expect(subscribedCommunities.communities.map((c) => c.name)).toEqual(['a'])
  })

  it('reset clears the list, owner and status', async () => {
    await subscribedCommunities.load(
      listApi([{ communities: [community('a')] }]),
      OWNER,
    )
    subscribedCommunities.reset()
    expect(subscribedCommunities.status).toBe('idle')
    expect(subscribedCommunities.owner).toBeUndefined()
    expect(subscribedCommunities.communities).toEqual([])
  })

  it('forgets remembered communities when the owner changes', async () => {
    const fresh = community('a', { subscribed: false })
    await toggleSubscription(fresh, {
      subscribe: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
    })
    await subscribedCommunities.load(listApi([{ communities: [] }]), OWNER)
    subscribedCommunities.remember(fresh)
    await subscribedCommunities.load(listApi([{ communities: [] }]), OTHER)
    expect(subscribedCommunities.communities).toEqual([])
  })
})
