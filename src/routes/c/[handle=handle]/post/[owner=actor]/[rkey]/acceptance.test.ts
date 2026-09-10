import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Outer acceptance test: owner-carrying permalinks round-trip.
//
// One behaviour, end to end: the link `postLink` emits for a post must be a
// URL the post loader can resolve on its own — no feed cache, no `?uri=`, no
// community lookup. The test therefore never hand-builds route params; it
// parses them back out of the generated path, exactly as SvelteKit would.
//
// Mocks mirror the sibling `page.test.ts`: the Coves XRPC client, the feed
// cache/`feed()` factory, `ReactiveState`, settings and sort.
// ---------------------------------------------------------------------------

const mockCovesMethods = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getPosts: vi.fn(),
  getComments: vi.fn(),
  getCommunity: vi.fn(),
}))

// The feed cache the loader's `findInFeed` reads via `feeds.get(id)?.peek()`.
// Left empty for the whole file: the acceptance path has no cache hit.
const mockFeeds = vi.hoisted(() => new Map<string, { peek: () => unknown }>())

vi.mock('$lib/api/client.svelte', () => ({
  coves: () => mockCovesMethods,
}))

vi.mock('$lib/feature/feeds/feed.svelte', () => ({
  feed: (
    _id: string,
    init: (params: unknown) => Promise<unknown>,
  ): { load: (params: unknown) => Promise<unknown> } => ({
    load: async (params: unknown) => init(params),
  }),
  feeds: mockFeeds,
}))

vi.mock('$lib/app/util/reactive.svelte', () => {
  return {
    ReactiveState: class<T> {
      value: T
      constructor(initialValue: T) {
        this.value = initialValue
      }
    },
  }
})

vi.mock('$lib/app/state/settings.svelte', () => ({
  settings: { defaultSort: { comments: 'hot' } },
}))

vi.mock('$lib/api/coves/sort', () => ({
  mapSort: () => ({ sort: 'hot' }),
}))

import { postLink } from '$lib/feature/post/helpers'
import { load } from './+page'

const AUTHOR_DID = 'did:plc:author'
const AUTHOR_HANDLE = 'mari.local.coves.dev'
const COMMUNITY_DID = 'did:plc:comm'
const COMMUNITY_HANDLE = 'gardening.local.coves.dev'
const RKEY = '3lrkey'

const POST_COLLECTION = 'social.coves.community.postv2'
const LEGACY_POST_COLLECTION = 'social.coves.community.post'

const POSTV2_URI = `at://${AUTHOR_DID}/${POST_COLLECTION}/${RKEY}`
const LEGACY_URI = `at://${AUTHOR_DID}/${LEGACY_POST_COLLECTION}/${RKEY}`

const EXPECTED_LINK = `/c/${COMMUNITY_HANDLE}/post/${AUTHOR_HANDLE}/${RKEY}`

// An author-owned post: the URI authority is the author's DID, not the
// community's. Assigned to a variable (not passed as a fresh object literal)
// so the extra `PostView` fields do not trip excess-property checking.
const post = {
  uri: POSTV2_URI,
  cid: 'bafyreigh2akiscaildc',
  rkey: RKEY,
  indexedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  author: { did: AUTHOR_DID, handle: AUTHOR_HANDLE },
  community: {
    did: COMMUNITY_DID,
    handle: COMMUNITY_HANDLE,
    name: 'gardening',
  },
  record: { title: 'Companion planting', content: 'Basil next to tomatoes.' },
}

// `/c/<community>/post/<owner>/<rkey>` — the shape SvelteKit's
// `[handle=handle]/post/[owner=actor]/[rkey]` route matches.
const PERMALINK_PATTERN = /^\/c\/([^/]+)\/post\/([^/]+)\/([^/]+)$/

/**
 * Recovers the route params from a generated permalink, standing in for
 * SvelteKit's router. Deliberately the only source of params in this test:
 * hand-building them would let the link and the loader drift apart.
 */
function routeParamsFromLink(link: string): {
  handle: string
  owner: string
  rkey: string
} {
  const match = PERMALINK_PATTERN.exec(link)
  if (!match) {
    throw new Error(
      `postLink() produced a path the post route cannot match: ${link}`,
    )
  }
  const [, handle, owner, rkey] = match
  return {
    handle: decodeURIComponent(handle),
    owner: decodeURIComponent(owner),
    rkey: decodeURIComponent(rkey),
  }
}

// The loader only destructures { params, url, fetch, route }; supplying those
// four is sufficient at runtime. Cast to the full LoadEvent for the type, the
// same way the repo's other load tests do.
function makeArgs(
  params: { handle: string; owner: string; rkey: string },
  path: string,
): Parameters<typeof load>[0] {
  return {
    params,
    url: new URL(`https://coves.test${path}`),
    fetch: globalThis.fetch,
    route: { id: '/c/[handle=handle]/post/[owner=actor]/[rkey]' },
  } as unknown as Parameters<typeof load>[0]
}

function loadedValue(
  result: Awaited<ReturnType<typeof load>>,
): Record<string, unknown> {
  return (result.data as { value: Record<string, unknown> }).value
}

describe('owner-carrying post permalink (acceptance)', () => {
  beforeEach(() => {
    mockCovesMethods.getProfile.mockReset()
    mockCovesMethods.getPosts.mockReset()
    mockCovesMethods.getComments.mockReset()
    mockCovesMethods.getCommunity.mockReset()
    mockFeeds.clear()

    // Handle → DID resolution for the owner segment.
    mockCovesMethods.getProfile.mockResolvedValue({
      did: AUTHOR_DID,
      handle: AUTHOR_HANDLE,
    })

    // The batch endpoint hydrates only the postv2 URI; every other URI comes
    // back as the notFound sentinel, in the requested order.
    mockCovesMethods.getPosts.mockImplementation(
      async ({ uris }: { uris: string[] }) => ({
        posts: uris.map((uri) =>
          uri === POSTV2_URI ? post : { uri, notFound: true },
        ),
      }),
    )

    mockCovesMethods.getComments.mockResolvedValue({ comments: [] })
  })

  it('round-trips postLink → route params → loader without a community lookup', async () => {
    // 1. The link carries the post owner, not just the community and rkey.
    const link = postLink(post)
    expect(link).toBe(EXPECTED_LINK)

    // 2. Parse the params back out of the link and load that URL cold.
    const params = routeParamsFromLink(link)
    expect(params).toEqual({
      handle: COMMUNITY_HANDLE,
      owner: AUTHOR_HANDLE,
      rkey: RKEY,
    })

    const result = await load(makeArgs(params, link))

    // 3. One batch probe, postv2 first and the legacy collection as fallback.
    expect(mockCovesMethods.getPosts).toHaveBeenCalledTimes(1)
    expect(mockCovesMethods.getPosts).toHaveBeenCalledWith(
      expect.objectContaining({ uris: [POSTV2_URI, LEGACY_URI] }),
    )

    // 4. The owner segment replaces the community handle→DID hop entirely.
    expect(mockCovesMethods.getCommunity).not.toHaveBeenCalled()

    // 5. The hydrated post reaches the page.
    const value = loadedValue(result)
    expect(value.post).toEqual(post)
    expect(value.unavailable).toBeUndefined()
  })
})
