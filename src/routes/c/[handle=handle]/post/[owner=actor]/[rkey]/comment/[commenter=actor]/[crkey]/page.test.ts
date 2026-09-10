import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
//
// Mirrors the post page's loader test (../../page.test.ts): the Coves XRPC
// client, the `feed()` factory, and `ReactiveState` (a `$state` rune wrapper)
// are replaced with lightweight fakes so the load function can be exercised in
// a plain node test environment.
//
// The client exposes no `getPost`: the loader probes two collections in one
// batch call, so every fetch it makes must go through `getPosts`.
// ---------------------------------------------------------------------------

const mockCovesMethods = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getPosts: vi.fn(),
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

// `settings.svelte` and `sort` pull in env/runes side effects unrelated to the
// branches under test; stub them to the minimum the loader touches.
vi.mock('$lib/app/state/settings.svelte', () => ({
  settings: { defaultSort: { comments: 'hot' } },
}))

vi.mock('$lib/api/coves/sort', () => ({
  mapSort: () => ({ sort: 'hot' }),
}))

// Pinned so `LOCAL_INSTANCE_DOMAIN` is a real domain rather than null: the
// canonical community segment depends on it whenever a ref carries an origin.
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.social' },
}))

import { XrpcError } from '$lib/api/coves/xrpc'
import { INVALID_HANDLE } from '$lib/types/atproto'
import CommunityCard from '$lib/feature/community/CommunityCard.svelte'
import { load } from './+page'

const OWNER_DID = 'did:plc:author'
const OWNER_HANDLE = 'mari.local.coves.dev'
const COMMUNITY_DID = 'did:plc:community123'
const COMMUNITY_HANDLE = 'gardening.local.coves.dev'
const COMMENTER_DID = 'did:plc:commenter456'
const COMMENTER_HANDLE = 'commenter.coves.test'
const RKEY = 'abc123'
const CRKEY = 'comment1'

const POST_COLLECTION = 'social.coves.community.postv2'
const LEGACY_POST_COLLECTION = 'social.coves.community.post'
const COMMENT_COLLECTION = 'social.coves.community.comment'

const DIRECTORY: Record<string, string> = {
  [OWNER_HANDLE]: OWNER_DID,
  [COMMENTER_HANDLE]: COMMENTER_DID,
}

const POSTV2_URI = `at://${OWNER_DID}/${POST_COLLECTION}/${RKEY}`
const LEGACY_URI = `at://${OWNER_DID}/${LEGACY_POST_COLLECTION}/${RKEY}`

// The loader only destructures { params, url, fetch, route }; supplying those
// four is sufficient at runtime. Cast to the full LoadEvent for the type, the
// same way the post page's loader test does.
function makeArgs(overrides?: {
  handle?: string
  owner?: string
  rkey?: string
  commenter?: string
  crkey?: string
  query?: string
}): Parameters<typeof load>[0] {
  const handle = overrides?.handle ?? COMMUNITY_HANDLE
  // The canonical actor forms for the default fixture: both the post author
  // and the comment author carry handles and own their records, so a DID in
  // either segment is now a redirecting alias.
  const owner = overrides?.owner ?? OWNER_HANDLE
  const rkey = overrides?.rkey ?? RKEY
  const commenter = overrides?.commenter ?? COMMENTER_HANDLE
  const crkey = overrides?.crkey ?? CRKEY
  const query = overrides?.query ?? ''
  return {
    params: { handle, owner, rkey, commenter, crkey },
    url: new URL(
      `https://coves.test/c/${encodeURIComponent(handle)}/post/${encodeURIComponent(owner)}/${encodeURIComponent(rkey)}/comment/${encodeURIComponent(commenter)}/${encodeURIComponent(crkey)}${query}`,
    ),
    fetch: globalThis.fetch,
    route: {
      id: '/c/[handle=handle]/post/[owner=actor]/[rkey]/comment/[commenter=actor]/[crkey]',
    },
  } as unknown as Parameters<typeof load>[0]
}

function hydratedPost(uri: string) {
  return {
    uri,
    cid: 'bafyreigh2akiscaildc',
    rkey: RKEY,
    indexedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    author: { did: OWNER_DID, handle: OWNER_HANDLE },
    community: {
      did: COMMUNITY_DID,
      handle: COMMUNITY_HANDLE,
      name: 'gardening',
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
function subtree(
  crkey: string,
  parentUri?: string,
  postUri: string = POSTV2_URI,
) {
  const uri = `at://${COMMENTER_DID}/${COMMENT_COLLECTION}/${crkey}`
  return {
    post: hydratedPost(postUri),
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
              root: { uri: postUri, cid: 'bafyreigh2akiscaildc' },
              parent: {
                uri: parentUri ?? postUri,
                cid: 'bafyreiparent',
              },
            },
            createdAt: '2026-01-02T00:00:00.000Z',
          },
          author: { did: COMMENTER_DID, handle: COMMENTER_HANDLE },
          post: { uri: postUri, cid: 'bafyreigh2akiscaildc' },
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

/**
 * The same two fixtures with an author whose handle no longer resolves —
 * `handle.invalid` is what ATProto serves for one, and it is the shape the
 * API types actually admit (the handle field is not optional).
 *
 * `repoSegment` treats it as absent, so nothing proves a handle for either
 * repo and the URI authority DIDs are the canonical actor segments. That is
 * what lets a DID-segment test load without redirecting, and it exercises the
 * unresolved-handle guard on the way through.
 */
function unresolvedAuthorPost(uri: string): ReturnType<typeof hydratedPost> {
  return {
    ...hydratedPost(uri),
    author: { did: OWNER_DID, handle: INVALID_HANDLE },
  }
}

function unresolvedCommenterSubtree(
  crkey: string,
  parentUri?: string,
  postUri: string = POSTV2_URI,
): ReturnType<typeof subtree> {
  const tree = subtree(crkey, parentUri, postUri)
  return {
    ...tree,
    comments: tree.comments.map((entry) => ({
      ...entry,
      comment: {
        ...entry.comment,
        author: { did: COMMENTER_DID, handle: INVALID_HANDLE },
      },
    })),
  }
}

/** The one URL this fixture's comment is canonically addressed by. */
const CANONICAL_COMMENT_PATH =
  `/c/${COMMUNITY_HANDLE}/post/${OWNER_HANDLE}/${RKEY}` +
  `/comment/${COMMENTER_HANDLE}/${CRKEY}`

const COMMENT_PERMALINK_PATTERN =
  /^\/c\/([^/]+)\/post\/([^/]+)\/([^/]+)\/comment\/([^/]+)\/([^/]+)$/

/**
 * Turns a redirect `location` back into loader args, standing in for the
 * router. Used to prove a redirect target does not itself redirect.
 */
function argsFromLocation(location: string): Parameters<typeof load>[0] {
  const [path, query] = location.split('?')
  const match = COMMENT_PERMALINK_PATTERN.exec(path)
  if (!match) {
    throw new Error(`redirect location is not a comment permalink: ${location}`)
  }
  const [, handle, owner, rkey, commenter, crkey] = match
  return makeArgs({
    handle: decodeURIComponent(handle),
    owner: decodeURIComponent(owner),
    rkey: decodeURIComponent(rkey),
    commenter: decodeURIComponent(commenter),
    crkey: decodeURIComponent(crkey),
    query: query ? `?${query}` : '',
  })
}

/**
 * Answers `getPosts` from a URI→entry table, preserving request order and
 * filling every unknown URI with the notFound sentinel — the batch endpoint's
 * documented contract.
 */
function serve(available: Record<string, unknown>): void {
  mockCovesMethods.getPosts.mockImplementation(
    async ({ uris }: { uris: string[] }) => ({
      posts: uris.map((uri) => available[uri] ?? { uri, notFound: true }),
    }),
  )
}

/** Every batch of URIs the loader asked the backend for, in call order. */
function probes(): string[][] {
  return mockCovesMethods.getPosts.mock.calls.map(
    ([params]) => (params as { uris: string[] }).uris,
  )
}

/** The post URI the loader asked for the comment subtree of. */
function commentedOn(): unknown {
  const call = mockCovesMethods.getComments.mock.calls[0]
  return (call?.[0] as { post?: unknown })?.post
}

/** The post URI of the most recent comment-subtree request. */
function lastCommentedOn(): unknown {
  const call = mockCovesMethods.getComments.mock.calls.at(-1)
  return (call?.[0] as { post?: unknown })?.post
}

/** A promise this test settles by hand, to hold a fetch mid-flight. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: ((value: T) => void) | undefined
  const promise = new Promise<T>((res) => {
    settle = res
  })
  if (!settle) {
    throw new Error('Promise executor did not run synchronously')
  }
  return { promise, resolve: settle }
}

/** Lets every already-scheduled continuation run before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
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
    mockCovesMethods.getProfile.mockReset()
    mockCovesMethods.getPosts.mockReset()
    mockCovesMethods.getComments.mockReset()
    mockCovesMethods.getCommunity.mockReset()

    // The owner segment replaces the community handle→DID hop entirely, so a
    // call here is a bug — fail loudly rather than answering it.
    mockCovesMethods.getCommunity.mockRejectedValue(
      new Error(
        'getCommunity must not be called: the owner segment supplies the post repo',
      ),
    )
    // Both the owner and the commenter segments resolve through this one
    // endpoint, so the fake has to answer per actor rather than per call.
    mockCovesMethods.getProfile.mockImplementation(
      async ({ actor }: { actor: string }) => {
        const did = DIRECTORY[actor]
        if (!did) {
          throw new XrpcError(404, 'ActorNotFound', `no such actor: ${actor}`)
        }
        return { did, handle: actor }
      },
    )
    serve({ [POSTV2_URI]: hydratedPost(POSTV2_URI) })
    mockCovesMethods.getComments.mockResolvedValue(subtree(CRKEY, POSTV2_URI))
  })

  // -------------------------------------------------------------------------
  // Owner resolution
  // -------------------------------------------------------------------------

  it('returns the post, focused comment, subtree, and a CommunityCard slot on the happy path', async () => {
    // Neither ref carries a usable handle, so both DID segments are canonical
    // here and the load runs to completion with no profile lookup at all.
    const post = unresolvedAuthorPost(POSTV2_URI)
    const tree = unresolvedCommenterSubtree(CRKEY, POSTV2_URI)
    serve({ [POSTV2_URI]: post })
    mockCovesMethods.getComments.mockResolvedValue(tree)

    // Hold the probe open so the two requests can be told apart in time.
    const probe = deferred<{ posts: unknown[] }>()
    mockCovesMethods.getPosts.mockReturnValue(probe.promise)

    const pending = load(
      makeArgs({ owner: OWNER_DID, commenter: COMMENTER_DID }),
    )
    await flush()

    // The subtree is asked for on the postv2 URI without waiting for the
    // probe: the overwhelmingly common case hydrates there, and serialising
    // the two costs every thread page a round trip.
    expect(mockCovesMethods.getComments).toHaveBeenCalledWith({
      post: POSTV2_URI,
      parentRkey: CRKEY,
      sort: 'hot',
      depth: 5,
      limit: 50,
    })

    probe.resolve({ posts: [post, { uri: LEGACY_URI, notFound: true }] })
    const result = await pending
    const value = loadedValue(result)

    expect(mockCovesMethods.getProfile).not.toHaveBeenCalled()
    expect(mockCovesMethods.getCommunity).not.toHaveBeenCalled()
    expect(probes()).toEqual([[POSTV2_URI, LEGACY_URI]])

    expect(value.post).toEqual(post)
    await expect(value.comments).resolves.toEqual(tree.comments)
    expect(value.focused).toEqual({
      uri: `at://${COMMENTER_DID}/${COMMENT_COLLECTION}/${CRKEY}`,
      rkey: CRKEY,
      // Parent ref points at the post itself ⇒ top-level comment, no context hop.
      parentUri: undefined,
    })

    expect(mockCovesMethods.getComments).toHaveBeenCalledTimes(1)
    // Exact params object — dropping sort/depth/limit must fail this test.
    // depth pins SUBTREE_DEPTH (MAX_INLINE_DEPTH + 1); sort comes from the
    // mocked mapSort.
    expect(mockCovesMethods.getComments).toHaveBeenCalledWith({
      post: POSTV2_URI,
      parentRkey: CRKEY,
      sort: 'hot',
      depth: 5,
      limit: 50,
    })

    const slots = result.slots as {
      sidebar: { component: unknown; props: { community: unknown } }
    }
    expect(slots.sidebar.component).toBe(CommunityCard)
    expect(slots.sidebar.props.community).toEqual(
      hydratedPost(POSTV2_URI).community,
    )
  })

  it('resolves a handle owner through getProfile and probes with its DID', async () => {
    // A DID commenter over an unresolved comment author, so the one profile
    // lookup this asserts is unambiguously the owner's.
    mockCovesMethods.getComments.mockResolvedValue(
      unresolvedCommenterSubtree(CRKEY, POSTV2_URI),
    )

    await load(makeArgs({ owner: OWNER_HANDLE, commenter: COMMENTER_DID }))

    expect(mockCovesMethods.getProfile).toHaveBeenCalledTimes(1)
    expect(mockCovesMethods.getProfile).toHaveBeenCalledWith({
      actor: OWNER_HANDLE,
    })
    expect(probes()).toEqual([[POSTV2_URI, LEGACY_URI]])
  })

  it('asks for the subtree of the legacy URI when only that collection hydrates', async () => {
    serve({ [LEGACY_URI]: hydratedPost(LEGACY_URI) })
    // Answers whichever post URI is asked about, so the page can only show
    // the legacy thread if it actually re-asked for it.
    mockCovesMethods.getComments.mockImplementation(
      async ({ post }: { post: string }) => subtree(CRKEY, post, post),
    )

    const result = await load(makeArgs())
    const value = loadedValue(result)

    expect(value.post).toEqual(hydratedPost(LEGACY_URI))
    // The optimistic postv2 request may have gone out first; what the page
    // renders must come from the URI that actually hydrated.
    expect(lastCommentedOn()).toBe(LEGACY_URI)
    await expect(value.comments).resolves.toEqual(
      subtree(CRKEY, LEGACY_URI, LEGACY_URI).comments,
    )
  })

  // -------------------------------------------------------------------------
  // Focused comment shape
  // -------------------------------------------------------------------------

  it('exposes focused.parentUri when the focused comment replies to another comment', async () => {
    const parentUri = `at://${COMMENTER_DID}/${COMMENT_COLLECTION}/parentc`
    mockCovesMethods.getComments.mockResolvedValue(subtree(CRKEY, parentUri))

    const result = await load(makeArgs())
    const value = loadedValue(result) as { focused: { parentUri?: string } }

    expect(value.focused.parentUri).toBe(parentUri)
  })

  it('leaves focused.parentUri undefined when the backend omits the parent ref', async () => {
    mockCovesMethods.getComments.mockResolvedValue(subtree(CRKEY, undefined))

    const result = await load(makeArgs())
    const value = loadedValue(result) as { focused: { parentUri?: string } }

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

  it('404s with couldnt_find_comment when the subtree response is empty (contract violation / race)', async () => {
    mockCovesMethods.getComments.mockResolvedValue({
      post: hydratedPost(POSTV2_URI),
      comments: [],
    })

    await expect(load(makeArgs())).rejects.toMatchObject({
      status: 404,
      body: { message: 'couldnt_find_comment' },
    })
  })

  // -------------------------------------------------------------------------
  // Unavailable post
  // -------------------------------------------------------------------------

  it('404s with couldnt_find_post when neither collection hydrates', async () => {
    serve({})

    await expect(load(makeArgs())).rejects.toMatchObject({
      status: 404,
      body: { message: 'couldnt_find_post' },
    })
  })

  it('404s with couldnt_find_post for a blocked post sentinel', async () => {
    serve({ [POSTV2_URI]: { uri: POSTV2_URI, blocked: true } })

    await expect(load(makeArgs())).rejects.toMatchObject({
      status: 404,
      body: { message: 'couldnt_find_post' },
    })
  })

  it('reports the missing post even when the parallel subtree request fails', async () => {
    // The speculative comments call is fired before the post's fate is known,
    // so its failure is expected noise here. It must neither win the race nor
    // escape as an unhandled rejection.
    serve({})
    mockCovesMethods.getComments.mockRejectedValue(
      new XrpcError(404, 'ParentNotFound', 'parent comment not found'),
    )

    await expect(load(makeArgs())).rejects.toMatchObject({
      status: 404,
      body: { message: 'couldnt_find_post' },
    })
  })

  // -------------------------------------------------------------------------
  // Unresolvable owner
  // -------------------------------------------------------------------------

  it('404s with couldnt_find_post when the owner handle does not resolve', async () => {
    mockCovesMethods.getProfile.mockRejectedValue(
      new XrpcError(404, 'ActorNotFound', 'Actor not found'),
    )

    await expect(
      load(makeArgs({ owner: 'ghost.local.coves.dev' })),
    ).rejects.toMatchObject({
      status: 404,
      body: { message: 'couldnt_find_post' },
    })
    expect(mockCovesMethods.getPosts).not.toHaveBeenCalled()
  })

  it('propagates a non-404 profile failure instead of masking it as a 404', async () => {
    const outage = new XrpcError(500, 'InternalServerError', 'upstream down')
    mockCovesMethods.getProfile.mockRejectedValue(outage)

    await expect(load(makeArgs({ owner: OWNER_HANDLE }))).rejects.toBe(outage)
  })

  // -------------------------------------------------------------------------
  // Commenter segment
  // -------------------------------------------------------------------------

  it('resolves a handle commenter through getProfile', async () => {
    await load(makeArgs({ commenter: COMMENTER_HANDLE }))

    expect(mockCovesMethods.getProfile).toHaveBeenCalledWith({
      actor: COMMENTER_HANDLE,
    })
  })

  it('404s with couldnt_find_comment when the comment is not in the commenter repo', async () => {
    // crkeys are TIDs: unique per repo, not across repos. Without this check
    // any commenter segment would render any comment on the post.
    await expect(
      load(makeArgs({ commenter: 'did:plc:someoneelse' })),
    ).rejects.toMatchObject({
      status: 404,
      body: { message: 'couldnt_find_comment' },
    })
  })

  // -------------------------------------------------------------------------
  // ?uri= candidate
  // -------------------------------------------------------------------------

  it('uses a ?uri= that belongs to the owner and rkey verbatim', async () => {
    // The param carries the exact collection, so there is nothing to probe.
    serve({ [LEGACY_URI]: hydratedPost(LEGACY_URI) })
    mockCovesMethods.getComments.mockResolvedValue(
      subtree(CRKEY, LEGACY_URI, LEGACY_URI),
    )

    const fetchExact = deferred<{ posts: unknown[] }>()
    mockCovesMethods.getPosts.mockReturnValue(fetchExact.promise)

    const pending = load(
      makeArgs({ query: `?uri=${encodeURIComponent(LEGACY_URI)}` }),
    )
    await flush()

    // A trusted `?uri=` names the collection outright, so the subtree request
    // goes out against it without waiting for the post to come back.
    expect(mockCovesMethods.getComments).toHaveBeenCalledWith(
      expect.objectContaining({ post: LEGACY_URI, parentRkey: CRKEY }),
    )

    fetchExact.resolve({ posts: [hydratedPost(LEGACY_URI)] })
    await pending

    expect(probes()).toEqual([[LEGACY_URI]])
  })

  it('ignores a ?uri= from a repo that is not the owner', async () => {
    // rkeys are TIDs: unique per repo, not across repos. A pasted URI from
    // another author would otherwise render their post under this permalink.
    const foreign = `at://did:plc:someoneelse/${POST_COLLECTION}/${RKEY}`
    serve({
      [POSTV2_URI]: hydratedPost(POSTV2_URI),
      [foreign]: hydratedPost(foreign),
    })

    await load(makeArgs({ query: `?uri=${encodeURIComponent(foreign)}` }))

    expect(probes()).toEqual([[POSTV2_URI, LEGACY_URI]])
    expect(commentedOn()).toBe(POSTV2_URI)
  })

  it('ignores a ?uri= whose rkey is not the one in the path', async () => {
    const otherRkey = `at://${OWNER_DID}/${POST_COLLECTION}/zzz999`
    serve({
      [POSTV2_URI]: hydratedPost(POSTV2_URI),
      [otherRkey]: hydratedPost(otherRkey),
    })

    await load(makeArgs({ query: `?uri=${encodeURIComponent(otherRkey)}` }))

    expect(probes()).toEqual([[POSTV2_URI, LEGACY_URI]])
    expect(commentedOn()).toBe(POSTV2_URI)
  })

  // -------------------------------------------------------------------------
  // Canonical URL enforcement
  //
  // Same rule as the post page, extended to the commenter segment: once the
  // post and the focused comment are in hand, a non-canonical segment
  // redirects to the single URL `commentLink` emits. Ordering is unchanged —
  // the 404s above still fire first, so a bad crkey never becomes a redirect.
  // -------------------------------------------------------------------------

  it('redirects a wrong community slug to the canonical comment permalink', async () => {
    const location = `${CANONICAL_COMMENT_PATH}?sort=top`

    await expect(
      load(makeArgs({ handle: 'cooking.local.coves.dev', query: '?sort=top' })),
    ).rejects.toMatchObject({ status: 302, location })

    // The target is stable: the second hop renders the comment.
    const result = await load(argsFromLocation(location))
    expect(loadedValue(result).focused).toMatchObject({ rkey: CRKEY })
  })

  it('redirects a DID-form commenter segment to the handle form', async () => {
    await expect(
      load(makeArgs({ commenter: COMMENTER_DID })),
    ).rejects.toMatchObject({
      status: 302,
      location: CANONICAL_COMMENT_PATH,
    })

    const result = await load(argsFromLocation(CANONICAL_COMMENT_PATH))
    expect(loadedValue(result).focused).toMatchObject({ rkey: CRKEY })
  })

  it('redirects a DID-form owner segment to the author handle form', async () => {
    await expect(load(makeArgs({ owner: OWNER_DID }))).rejects.toMatchObject({
      status: 302,
      location: CANONICAL_COMMENT_PATH,
    })

    const result = await load(argsFromLocation(CANONICAL_COMMENT_PATH))
    expect(loadedValue(result).focused).toMatchObject({ rkey: CRKEY })
  })

  it('does not redirect a comment URL that is already canonical', async () => {
    const result = await load(makeArgs({ query: '?sort=top' }))

    expect(loadedValue(result).focused).toEqual({
      uri: `at://${COMMENTER_DID}/${COMMENT_COLLECTION}/${CRKEY}`,
      rkey: CRKEY,
      parentUri: undefined,
    })
  })

  it('404s a missing comment under a wrong slug instead of redirecting', async () => {
    // The comment is what the page is; an unknown crkey is a dead URL whether
    // or not the community segment happens to be wrong, so the 404 wins.
    mockCovesMethods.getComments.mockResolvedValue({
      post: hydratedPost(POSTV2_URI),
      comments: [],
    })

    await expect(
      load(makeArgs({ handle: 'cooking.local.coves.dev' })),
    ).rejects.toMatchObject({
      status: 404,
      body: { message: 'couldnt_find_comment' },
    })
  })
})
