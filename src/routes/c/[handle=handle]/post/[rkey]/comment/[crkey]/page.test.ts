import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
//
// Mirrors the post page's loader test (../..(rkey)/page.test.ts): the Coves
// XRPC client, the `feed()` factory, and `ReactiveState` (a `$state` rune
// wrapper) are replaced with lightweight fakes so the load function can be
// exercised in a plain node test environment.
// ---------------------------------------------------------------------------

const mockCovesMethods = vi.hoisted(() => ({
  getPost: vi.fn(),
  getComments: vi.fn(),
  getCommunity: vi.fn(),
}))

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

import { XrpcError } from '$lib/api/coves/xrpc'
import CommunityCard from '$lib/feature/community/CommunityCard.svelte'
import { load } from './+page'

const COMMUNITY_DID = 'did:plc:community123'
const COMMENTER_DID = 'did:plc:commenter456'
const POST_COLLECTION = 'social.coves.community.post'
const COMMENT_COLLECTION = 'social.coves.community.comment'

const POST_URI = `at://${COMMUNITY_DID}/${POST_COLLECTION}/abc123`

// The loader only destructures { params, url, fetch, route }; supplying those
// four is sufficient at runtime. Cast to the full LoadEvent for the type, the
// same way the post page's loader test does.
function makeArgs(overrides?: {
  handle?: string
  rkey?: string
  crkey?: string
  url?: string
}): Parameters<typeof load>[0] {
  const handle = overrides?.handle ?? 'testcommunity'
  const rkey = overrides?.rkey ?? 'abc123'
  const crkey = overrides?.crkey ?? 'comment1'
  return {
    params: { handle, rkey, crkey },
    url: new URL(
      overrides?.url ??
        `https://coves.test/c/${handle}/post/${rkey}/comment/${crkey}`,
    ),
    fetch: globalThis.fetch,
    route: { id: '/c/[handle=handle]/post/[rkey]/comment/[crkey]' },
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

/**
 * Builds the single-root subtree `getComments` returns for a `parentRkey`
 * request. `parentUri` controls the focused comment's parent ref: the post
 * URI models a top-level comment, a comment URI models a nested reply, and
 * undefined models a backend response with no parent ref at all.
 */
function subtree(crkey: string, parentUri?: string) {
  const uri = `at://${COMMENTER_DID}/${COMMENT_COLLECTION}/${crkey}`
  return {
    post: hydratedPost('abc123'),
    comments: [
      {
        comment: {
          uri,
          cid: 'bafyreicomment',
          createdAt: '2026-01-02T00:00:00.000Z',
          indexedAt: '2026-01-02T00:00:00.000Z',
          record: {
            $type: COMMENT_COLLECTION,
            content: 'A comment',
            reply: {
              root: { uri: POST_URI, cid: 'bafyreigh2akiscaildc' },
              parent: {
                uri: parentUri ?? POST_URI,
                cid: 'bafyreiparent',
              },
            },
            createdAt: '2026-01-02T00:00:00.000Z',
          },
          author: { did: COMMENTER_DID, handle: 'commenter.coves.test' },
          post: { uri: POST_URI, cid: 'bafyreigh2akiscaildc' },
          stats: { upvotes: 0, downvotes: 0, score: 0, replyCount: 0 },
          ...(parentUri === undefined
            ? {}
            : { parent: { uri: parentUri, cid: 'bafyreiparent' } }),
        },
        replies: [],
      },
    ],
  }
}

// The loaded `ReactiveState` is mocked to a plain `{ value }` holder; this
// narrows the unknown return for assertions.
function loadedValue(
  result: Awaited<ReturnType<typeof load>>,
): Record<string, unknown> {
  return (result.data as { value: Record<string, unknown> }).value
}

describe('comment permalink loader', () => {
  beforeEach(() => {
    mockCovesMethods.getPost.mockReset()
    mockCovesMethods.getComments.mockReset()
    mockCovesMethods.getCommunity.mockReset()

    // Sensible defaults; individual tests override as needed.
    mockCovesMethods.getCommunity.mockResolvedValue({ did: COMMUNITY_DID })
    mockCovesMethods.getPost.mockResolvedValue(hydratedPost('abc123'))
    mockCovesMethods.getComments.mockResolvedValue(
      subtree('comment1', POST_URI),
    )
  })

  it('returns the post, focused comment, subtree, and a CommunityCard slot on the happy path', async () => {
    const post = hydratedPost('abc123')
    const tree = subtree('comment1', POST_URI)
    mockCovesMethods.getPost.mockResolvedValue(post)
    mockCovesMethods.getComments.mockResolvedValue(tree)

    const result = await load(makeArgs())
    const value = loadedValue(result)

    expect(value.post).toEqual(post)
    await expect(value.comments).resolves.toEqual(tree.comments)
    expect(value.focused).toEqual({
      uri: `at://${COMMENTER_DID}/${COMMENT_COLLECTION}/comment1`,
      rkey: 'comment1',
      // Parent ref points at the post itself ⇒ top-level comment, no context hop.
      parentUri: undefined,
    })

    expect(mockCovesMethods.getComments).toHaveBeenCalledTimes(1)
    // Exact params object — dropping sort/depth/limit must fail this test.
    // depth pins SUBTREE_DEPTH (MAX_INLINE_DEPTH + 1); sort comes from the
    // mocked mapSort.
    expect(mockCovesMethods.getComments).toHaveBeenCalledWith({
      post: POST_URI,
      parentRkey: 'comment1',
      sort: 'hot',
      depth: 5,
      limit: 50,
    })

    const slots = result.slots as {
      sidebar: { component: unknown; props: { community: unknown } }
    }
    expect(slots.sidebar.component).toBe(CommunityCard)
    expect(slots.sidebar.props.community).toEqual(post.community)
  })

  it('exposes focused.parentUri when the focused comment replies to another comment', async () => {
    const parentUri = `at://${COMMENTER_DID}/${COMMENT_COLLECTION}/parentc`
    mockCovesMethods.getComments.mockResolvedValue(
      subtree('comment1', parentUri),
    )

    const result = await load(makeArgs())
    const value = loadedValue(result) as {
      focused: { parentUri?: string }
    }

    expect(value.focused.parentUri).toBe(parentUri)
  })

  it('leaves focused.parentUri undefined when the backend omits the parent ref', async () => {
    mockCovesMethods.getComments.mockResolvedValue(
      subtree('comment1', undefined),
    )

    const result = await load(makeArgs())
    const value = loadedValue(result) as {
      focused: { parentUri?: string }
    }

    expect(value.focused.parentUri).toBeUndefined()
  })

  it('404s with couldnt_find_comment on a ParentNotFound XRPC error', async () => {
    mockCovesMethods.getComments.mockRejectedValue(
      new XrpcError(404, 'ParentNotFound', 'parent comment not found'),
    )

    await expect(load(makeArgs())).rejects.toMatchObject({
      status: 404,
      body: { message: 'couldnt_find_comment' },
    })
  })

  it('propagates non-ParentNotFound getComments errors unchanged', async () => {
    const serverError = new XrpcError(500, 'InternalServerError', 'boom')
    mockCovesMethods.getComments.mockRejectedValue(serverError)

    await expect(load(makeArgs())).rejects.toBe(serverError)
  })

  it('404s with couldnt_find_post for a notFound post sentinel', async () => {
    mockCovesMethods.getPost.mockResolvedValue({
      uri: POST_URI,
      notFound: true,
    })

    await expect(load(makeArgs())).rejects.toMatchObject({
      status: 404,
      body: { message: 'couldnt_find_post' },
    })
  })

  it('404s with couldnt_find_post for a blocked post sentinel', async () => {
    mockCovesMethods.getPost.mockResolvedValue({
      uri: POST_URI,
      blocked: true,
    })

    await expect(load(makeArgs())).rejects.toMatchObject({
      status: 404,
      body: { message: 'couldnt_find_post' },
    })
  })

  it('404s with couldnt_find_comment when the subtree response is empty (contract violation / race)', async () => {
    mockCovesMethods.getComments.mockResolvedValue({
      post: hydratedPost('abc123'),
      comments: [],
    })

    await expect(load(makeArgs())).rejects.toMatchObject({
      status: 404,
      body: { message: 'couldnt_find_comment' },
    })
  })

  it('URI precedence: uses ?uri= verbatim and does NOT call getCommunity', async () => {
    const explicitUri = `at://${COMMUNITY_DID}/${POST_COLLECTION}/from-query`
    mockCovesMethods.getPost.mockResolvedValue(hydratedPost('from-query'))

    await load(
      makeArgs({
        url: `https://coves.test/c/testcommunity/post/abc123/comment/comment1?uri=${encodeURIComponent(explicitUri)}`,
      }),
    )

    expect(mockCovesMethods.getCommunity).not.toHaveBeenCalled()
    expect(mockCovesMethods.getPost).toHaveBeenCalledWith(explicitUri)
    expect(mockCovesMethods.getComments).toHaveBeenCalledWith(
      expect.objectContaining({ post: explicitUri, parentRkey: 'comment1' }),
    )
  })

  it('URI precedence: without ?uri=, resolves the community DID and builds the post URI', async () => {
    await load(makeArgs())

    expect(mockCovesMethods.getCommunity).toHaveBeenCalledTimes(1)
    expect(mockCovesMethods.getCommunity).toHaveBeenCalledWith({
      community: 'c-testcommunity',
    })
    expect(mockCovesMethods.getPost).toHaveBeenCalledWith(POST_URI)
  })

  it('404s with couldnt_find_community when the community lookup (no ?uri=) hits a NotFound XRPC error', async () => {
    // Backend contract: an unknown community slug yields HTTP 404 with error
    // name "NotFound" (internal/api/handlers/community/errors.go).
    mockCovesMethods.getCommunity.mockRejectedValue(
      new XrpcError(404, 'NotFound', 'community not found'),
    )

    await expect(load(makeArgs())).rejects.toMatchObject({
      status: 404,
      body: { message: 'couldnt_find_community' },
    })
  })

  it('propagates non-NotFound getCommunity errors unchanged', async () => {
    const serverError = new XrpcError(500, 'InternalServerError', 'boom')
    mockCovesMethods.getCommunity.mockRejectedValue(serverError)

    await expect(load(makeArgs())).rejects.toBe(serverError)
  })
})
