import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
//
// The loader leans on three side-effecty modules: the Coves XRPC client, the
// feed cache/`feed()` factory, and `ReactiveState` (a `$state` rune wrapper).
// We replace all three with lightweight fakes so the load function can be
// exercised in a plain node test environment and so each branch's API calls
// can be asserted.
// ---------------------------------------------------------------------------

const mockCovesMethods = vi.hoisted(() => ({
  getPost: vi.fn(),
  getComments: vi.fn(),
  getCommunity: vi.fn(),
}))

// The feed cache the loader's `findInFeed` reads via `feeds.get(id)?.peek()`.
const mockFeeds = vi.hoisted(() => new Map<string, { peek: () => unknown }>())

vi.mock('$lib/api/client.svelte', () => ({
  coves: () => mockCovesMethods,
}))

// `feed(id, init)` returns an object whose `.load(params)` simply runs `init`.
// This makes the loader's init callback the unit under test.
vi.mock('$lib/feature/feeds/feed.svelte', () => ({
  feed: (
    _id: string,
    init: (params: unknown) => Promise<unknown>,
  ): { load: (params: unknown) => Promise<unknown> } => ({
    load: async (params: unknown) => init(params),
  }),
  feeds: mockFeeds,
}))

// `ReactiveState` is a `$state`-backed wrapper; in a plain `.test.ts` (node env,
// no runes transform) we stub it with a trivial value holder.
vi.mock('$lib/app/util.svelte', async () => {
  const actual = await vi.importActual<typeof import('$lib/app/util.svelte')>(
    '$lib/app/util.svelte',
  )
  return {
    ...actual,
    ReactiveState: class<T> {
      value: T
      constructor(initialValue: T) {
        this.value = initialValue
      }
    },
  }
})

// `settings.svelte` and `sort` pull in env/runes side effects unrelated to the
// branches under test; stub them to the minimum the loader touches.
vi.mock('$lib/app/settings.svelte', () => ({
  settings: { defaultSort: { comments: 'hot' } },
}))

vi.mock('$lib/app/sort', () => ({
  mapSort: () => ({ sort: 'hot' }),
}))

import CommunityCard from '$lib/feature/community/CommunityCard.svelte'
import { load } from './+page'

const COMMUNITY_DID = 'did:plc:community123'
const POST_COLLECTION = 'social.coves.community.post'

// The loader only destructures { params, url, fetch, route }; supplying those
// four is sufficient at runtime. Cast to the full LoadEvent for the type, the
// same way the repo's other load tests do (see u/[handle=handle]/page.test.ts).
function makeArgs(overrides?: {
  handle?: string
  rkey?: string
  url?: string
}): Parameters<typeof load>[0] {
  return {
    params: {
      handle: overrides?.handle ?? 'testcommunity',
      rkey: overrides?.rkey ?? 'abc123',
    },
    url: new URL(
      overrides?.url ??
        `https://coves.test/c/${overrides?.handle ?? 'testcommunity'}/post/${overrides?.rkey ?? 'abc123'}`,
    ),
    fetch: globalThis.fetch,
    route: { id: '/c/[handle=handle]/post/[rkey]' },
  } as unknown as Parameters<typeof load>[0]
}

function hydratedPost(rkey: string) {
  const uri = `at://${COMMUNITY_DID}/${POST_COLLECTION}/${rkey}`
  return {
    uri,
    cid: 'bafyreigh2akiscaildc',
    rkey,
    indexedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    author: { did: 'did:plc:author', handle: 'author.coves.test' },
    community: {
      did: COMMUNITY_DID,
      handle: 'c-testcommunity',
      name: 'testcommunity',
    },
    record: { title: 'Hello', content: 'World' },
  }
}

// The loaded `ReactiveState` is mocked to a plain `{ value }` holder; this
// narrows the unknown return for assertions.
function loadedValue(
  result: Awaited<ReturnType<typeof load>>,
): Record<string, unknown> {
  return (result.data as { value: Record<string, unknown> }).value
}

describe('post loader', () => {
  beforeEach(() => {
    mockCovesMethods.getPost.mockReset()
    mockCovesMethods.getComments.mockReset()
    mockCovesMethods.getCommunity.mockReset()
    mockFeeds.clear()

    // Sensible defaults; individual tests override as needed.
    mockCovesMethods.getCommunity.mockResolvedValue({ did: COMMUNITY_DID })
    mockCovesMethods.getComments.mockResolvedValue({ comments: [] })
  })

  it('returns unavailable=notFound and does NOT fetch comments for a notFound sentinel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockCovesMethods.getPost.mockResolvedValue({
      uri: `at://${COMMUNITY_DID}/${POST_COLLECTION}/abc123`,
      notFound: true,
    })

    const result = await load(makeArgs())
    const value = loadedValue(result)

    expect(value.unavailable).toBe('notFound')
    expect(value.post).toBeUndefined()
    expect(mockCovesMethods.getComments).not.toHaveBeenCalled()
    expect(result.slots).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('notFound'))

    warn.mockRestore()
  })

  it('returns unavailable=blocked and does NOT fetch comments for a blocked sentinel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockCovesMethods.getPost.mockResolvedValue({
      uri: `at://${COMMUNITY_DID}/${POST_COLLECTION}/abc123`,
      blocked: true,
    })

    const result = await load(makeArgs())
    const value = loadedValue(result)

    expect(value.unavailable).toBe('blocked')
    expect(value.post).toBeUndefined()
    expect(mockCovesMethods.getComments).not.toHaveBeenCalled()
    expect(result.slots).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('blocked'))

    warn.mockRestore()
  })

  it('returns the hydrated post, fetches comments, and builds a CommunityCard slot on the happy path', async () => {
    const post = hydratedPost('abc123')
    mockCovesMethods.getPost.mockResolvedValue(post)

    const result = await load(makeArgs())
    const value = loadedValue(result)

    expect(value.post).toEqual(post)
    expect(value.unavailable).toBeUndefined()
    expect(mockCovesMethods.getComments).toHaveBeenCalledTimes(1)

    expect(result.slots).toBeDefined()
    const slots = result.slots as {
      sidebar: { component: unknown; props: { community: unknown } }
    }
    expect(slots.sidebar.component).toBe(CommunityCard)
    expect(slots.sidebar.props.community).toEqual(post.community)
  })

  it('URI precedence: uses ?uri= verbatim and does NOT call getCommunity', async () => {
    const explicitUri = `at://${COMMUNITY_DID}/${POST_COLLECTION}/from-query`
    mockCovesMethods.getPost.mockResolvedValue(hydratedPost('from-query'))

    await load(
      makeArgs({
        url: `https://coves.test/c/testcommunity/post/abc123?uri=${encodeURIComponent(explicitUri)}`,
      }),
    )

    expect(mockCovesMethods.getCommunity).not.toHaveBeenCalled()
    expect(mockCovesMethods.getPost).toHaveBeenCalledWith(explicitUri)
  })

  it('URI precedence: uses a feed-cache hit as preload and calls neither getPost nor getCommunity', async () => {
    const cachedPost = hydratedPost('abc123')
    // `findInFeed` reads `feeds.get('/')?.peek()?.feed[].post`.
    mockFeeds.set('/', {
      peek: () => ({ feed: [{ post: cachedPost }] }),
    })

    const result = await load(makeArgs({ rkey: 'abc123' }))
    const value = loadedValue(result)

    expect(value.post).toEqual(cachedPost)
    expect(mockCovesMethods.getPost).not.toHaveBeenCalled()
    expect(mockCovesMethods.getCommunity).not.toHaveBeenCalled()
  })

  it('URI precedence: with neither ?uri= nor cache, resolves community DID and builds the post URI', async () => {
    mockCovesMethods.getCommunity.mockResolvedValue({ did: COMMUNITY_DID })
    mockCovesMethods.getPost.mockResolvedValue(hydratedPost('abc123'))

    await load(makeArgs({ rkey: 'abc123' }))

    expect(mockCovesMethods.getCommunity).toHaveBeenCalledTimes(1)
    const builtUri = `at://${COMMUNITY_DID}/${POST_COLLECTION}/abc123`
    expect(mockCovesMethods.getPost).toHaveBeenCalledWith(builtUri)
  })
})
