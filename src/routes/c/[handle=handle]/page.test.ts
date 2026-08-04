import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
//
// Unlike the post-page loader test, this one runs against the *real* feed cache
// (`$lib/feature/feeds/feed.svelte`) with `browser` forced to `true`. That is
// the whole point: every community shares the route ID `/c/[handle=handle]`, so
// the cache hands the same `Feed` instance back on the next navigation, and the
// regression under test is the loader's init closure reading community/sort
// from the *first* load run instead of from the params it is handed.
// ---------------------------------------------------------------------------

vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
  version: 'test',
}))

const mockCovesMethods = vi.hoisted(() => ({
  getCommunityFeed: vi.fn(),
  getCommunity: vi.fn(),
}))

// Every `func` the loader builds a client with, in call order. The loader calls
// `coves({ func: fetch })` inside its init closure, so this records which
// navigation's `fetch` each refetch actually ran through.
const clientFetchArgs = vi.hoisted(() => [] as unknown[])

vi.mock('$lib/api/client.svelte', () => ({
  coves: ({ func }: { func: unknown }) => {
    clientFetchArgs.push(func)
    return mockCovesMethods
  },
}))

// `feed.svelte.ts` imports `profile` purely for its cache-clearing effect; the
// real module reads localStorage at import time, which node has no notion of.
vi.mock('$lib/app/auth.svelte', () => ({
  profile: { meta: { profile: undefined } },
}))

// Mutable so a test can stand in a different saved default; reset per test.
const mockSettings = vi.hoisted(() => ({
  defaultSort: { sort: 'hot', timeframe: 'all' },
}))

vi.mock('$lib/app/settings.svelte', () => ({ settings: mockSettings }))

// `$lib/app/sort` is deliberately NOT mocked: `resolveFeedSort` is pure and
// dependency-free, so running the real one exercises the URL-vs-saved-defaults
// precedence end to end rather than re-implementing it here.

import { XrpcError } from '$lib/api/coves/xrpc'
import { feeds } from '$lib/feature/feeds/feed.svelte'
import { load } from './+page'

// The loader only destructures { params, fetch, url, route }; supplying those
// four is sufficient at runtime. Cast to the full LoadEvent for the type, the
// same way the repo's other load tests do.
function makeArgs(
  handle: string,
  query = '',
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Parameters<typeof load>[0] {
  return {
    params: { handle },
    url: new URL(`https://coves.test/c/${handle}${query}`),
    fetch: fetchFn,
    route: { id: '/c/[handle=handle]' },
  } as unknown as Parameters<typeof load>[0]
}

/** A distinguishable stand-in for a single navigation's `fetch`. */
function sentinelFetch(): typeof globalThis.fetch {
  return vi.fn() as unknown as typeof globalThis.fetch
}

function feedResponse(community: string) {
  return {
    feed: [{ post: { rkey: `post-in-${community}` } }],
    cursor: `cursor-${community}`,
  }
}

describe('community loader', () => {
  beforeEach(() => {
    mockCovesMethods.getCommunityFeed.mockReset()
    mockCovesMethods.getCommunity.mockReset()
    clientFetchArgs.length = 0
    mockSettings.defaultSort = { sort: 'hot', timeframe: 'all' }
    // The cache is module-level state shared across tests.
    feeds.clear()

    mockCovesMethods.getCommunityFeed.mockImplementation(
      ({ community }: { community: string }) =>
        Promise.resolve(feedResponse(community)),
    )
    mockCovesMethods.getCommunity.mockImplementation(
      ({ community }: { community: string }) =>
        Promise.resolve({ did: `did:plc:${community}`, handle: community }),
    )
  })

  it('fetches the requested community and returns its feed', async () => {
    const result = await load(makeArgs('news.coves.social'))

    expect(mockCovesMethods.getCommunityFeed).toHaveBeenCalledWith(
      expect.objectContaining({ community: 'news.coves.social', sort: 'hot' }),
    )
    expect(result.community).toMatchObject({ handle: 'news.coves.social' })
    expect(result.feed).toEqual(feedResponse('news.coves.social').feed)
  })

  it('refetches the new community when navigating between communities on the cached feed', async () => {
    await load(makeArgs('news.coves.social'))
    const result = await load(makeArgs('linux.coves.social'))

    // Regression: the cached Feed's init closure used to have captured the
    // first navigation's handle, so this refetched `news.coves.social`.
    expect(mockCovesMethods.getCommunityFeed).toHaveBeenLastCalledWith(
      expect.objectContaining({ community: 'linux.coves.social' }),
    )
    expect(mockCovesMethods.getCommunity).toHaveBeenLastCalledWith({
      community: 'linux.coves.social',
    })
    expect(result.community).toMatchObject({ handle: 'linux.coves.social' })
    expect(result.feed).toEqual(feedResponse('linux.coves.social').feed)
  })

  it('refetches with the new sort when the sort changes on the same community', async () => {
    await load(makeArgs('news.coves.social'))
    await load(makeArgs('news.coves.social', '?sort=top&timeframe=week'))

    expect(mockCovesMethods.getCommunityFeed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        community: 'news.coves.social',
        sort: 'top',
        timeframe: 'week',
      }),
    )
  })

  it("applies the viewer's saved timeframe when the URL names no sort", async () => {
    mockSettings.defaultSort = { sort: 'top', timeframe: 'week' }

    await load(makeArgs('news.coves.social'))

    // The saved timeframe only rides along when the sort itself came from
    // settings, so a bare URL must reach the API as top/week.
    expect(mockCovesMethods.getCommunityFeed).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'top', timeframe: 'week' }),
    )
  })

  it('refetches through the newest navigation fetch, not the first one', async () => {
    const firstFetch = sentinelFetch()
    const secondFetch = sentinelFetch()

    await load(makeArgs('news.coves.social', '', firstFetch))
    await load(makeArgs('linux.coves.social', '', secondFetch))

    // The cached Feed reruns an init closure, and that closure captures its
    // navigation's `fetch`. Without `setFetch` the stale first closure runs,
    // so the refetch would go out through a fetch belonging to a navigation
    // SvelteKit has already torn down.
    expect(clientFetchArgs.at(-1)).toBe(secondFetch)
    expect(clientFetchArgs).toContain(firstFetch)
  })

  it('surfaces an XRPC 404 as a routable 404', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCovesMethods.getCommunityFeed.mockRejectedValue(
      new XrpcError(404, 'NotFound', 'Community not found'),
    )

    await expect(load(makeArgs('ghost.coves.social'))).rejects.toMatchObject({
      status: 404,
    })

    consoleError.mockRestore()
  })
})
