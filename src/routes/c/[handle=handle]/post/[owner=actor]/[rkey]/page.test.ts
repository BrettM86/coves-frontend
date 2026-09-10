import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
//
// The loader leans on three side-effecty modules: the Coves XRPC client, the
// feed cache/`feed()` factory, and `ReactiveState` (a `$state` rune wrapper).
// We replace all three with lightweight fakes so the load function can be
// exercised in a plain node test environment and so each branch's API calls
// can be asserted.
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

// `buildFreshPostView` reads the signed-in viewer off `profile.current`, whose
// real module touches localStorage at import time.
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: {
    current: {
      type: 'authenticated',
      did: 'did:plc:author',
      handle: 'mari.local.coves.dev',
      avatar: undefined,
    },
  },
}))

import type { AtUri, CID, CreatePostOutput } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import { XrpcError } from '$lib/api/coves/xrpc'
import CommunityCard from '$lib/feature/community/CommunityCard.svelte'
import { buildFreshPostView, stashFreshPost } from '$lib/feature/post/fresh-post'
import { createdPostLink } from '$lib/feature/post/owner'
import { load } from './+page'

const OWNER_DID = 'did:plc:author'
const OWNER_HANDLE = 'mari.local.coves.dev'
const COMMUNITY_DID = 'did:plc:comm'
const COMMUNITY_HANDLE = 'gardening.local.coves.dev'
const RKEY = 'abc123'

const POST_COLLECTION = 'social.coves.community.postv2'
const LEGACY_POST_COLLECTION = 'social.coves.community.post'

const POSTV2_URI = `at://${OWNER_DID}/${POST_COLLECTION}/${RKEY}`
const LEGACY_URI = `at://${OWNER_DID}/${LEGACY_POST_COLLECTION}/${RKEY}`

// The loader only destructures { params, url, fetch, route }; supplying those
// four is sufficient at runtime. Cast to the full LoadEvent for the type, the
// same way the repo's other load tests do (see u/[handle=handle]/page.test.ts).
function makeArgs(overrides?: {
  handle?: string
  owner?: string
  rkey?: string
  query?: string
}): Parameters<typeof load>[0] {
  const handle = overrides?.handle ?? COMMUNITY_HANDLE
  // The canonical owner form for the default fixture: its author carries a
  // handle and owns the record, so a DID here would now be a redirecting alias.
  const owner = overrides?.owner ?? OWNER_HANDLE
  const rkey = overrides?.rkey ?? RKEY
  const query = overrides?.query ?? ''
  return {
    params: { handle, owner, rkey },
    url: new URL(
      `https://coves.test/c/${encodeURIComponent(handle)}/post/${encodeURIComponent(owner)}/${encodeURIComponent(rkey)}${query}`,
    ),
    fetch: globalThis.fetch,
    route: { id: '/c/[handle=handle]/post/[owner=actor]/[rkey]' },
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
 * The same fixture with no author ref — nothing proves a handle for the repo
 * the record lives in, so the URI authority DID is its canonical owner segment.
 */
function authorlessPost(uri: string): Record<string, unknown> {
  const { author: _author, ...rest } = hydratedPost(uri)
  return rest
}

/** The one URL this fixture's post is canonically addressed by. */
const CANONICAL_PATH = `/c/${COMMUNITY_HANDLE}/post/${OWNER_HANDLE}/${RKEY}`

const PERMALINK_PATTERN = /^\/c\/([^/]+)\/post\/([^/]+)\/([^/]+)$/

/**
 * Turns a redirect `location` back into loader args, standing in for the
 * router. Used to prove a redirect target does not itself redirect.
 */
function argsFromLocation(location: string): Parameters<typeof load>[0] {
  const [path, query] = location.split('?')
  const match = PERMALINK_PATTERN.exec(path)
  if (!match) {
    throw new Error(`redirect location is not a post permalink: ${location}`)
  }
  const [, handle, owner, rkey] = match
  return makeArgs({
    handle: decodeURIComponent(handle),
    owner: decodeURIComponent(owner),
    rkey: decodeURIComponent(rkey),
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

/** The post URI the loader asked for comments on. */
function commentedOn(): unknown {
  const call = mockCovesMethods.getComments.mock.calls[0]
  return (call?.[0] as { post?: unknown })?.post
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
    mockCovesMethods.getProfile.mockReset()
    mockCovesMethods.getPosts.mockReset()
    mockCovesMethods.getComments.mockReset()
    mockCovesMethods.getCommunity.mockReset()
    mockFeeds.clear()

    // The owner segment replaces the community handle→DID hop entirely, so a
    // call here is a bug — fail loudly rather than answering it.
    mockCovesMethods.getCommunity.mockRejectedValue(
      new Error(
        'getCommunity must not be called: the owner segment supplies the post repo',
      ),
    )
    mockCovesMethods.getProfile.mockResolvedValue({
      did: OWNER_DID,
      handle: OWNER_HANDLE,
    })
    mockCovesMethods.getComments.mockResolvedValue({ comments: [] })
    serve({ [POSTV2_URI]: hydratedPost(POSTV2_URI) })
  })

  // -------------------------------------------------------------------------
  // Owner resolution
  // -------------------------------------------------------------------------

  it('probes both collections for a DID owner, with no profile lookup', async () => {
    // The post carries no author ref, so the DID owner segment is canonical
    // here and the load runs to completion instead of redirecting.
    const post = authorlessPost(POSTV2_URI)
    serve({ [POSTV2_URI]: post })

    const result = await load(makeArgs({ owner: OWNER_DID }))

    expect(mockCovesMethods.getProfile).not.toHaveBeenCalled()
    expect(mockCovesMethods.getCommunity).not.toHaveBeenCalled()
    expect(probes()).toEqual([[POSTV2_URI, LEGACY_URI]])

    const value = loadedValue(result)
    expect(value.post).toEqual(post)
    expect(value.unavailable).toBeUndefined()
    expect(commentedOn()).toBe(POSTV2_URI)

    const slots = result.slots as {
      sidebar: { component: unknown; props: { community: unknown } }
    }
    expect(slots.sidebar.component).toBe(CommunityCard)
    expect(slots.sidebar.props.community).toEqual(
      hydratedPost(POSTV2_URI).community,
    )
  })

  it('resolves a handle owner through getProfile and probes with its DID', async () => {
    await load(makeArgs({ owner: OWNER_HANDLE }))

    expect(mockCovesMethods.getProfile).toHaveBeenCalledTimes(1)
    expect(mockCovesMethods.getProfile).toHaveBeenCalledWith({
      actor: OWNER_HANDLE,
    })
    expect(probes()).toEqual([[POSTV2_URI, LEGACY_URI]])
  })

  it('falls back to the legacy community-owned record when postv2 is missing', async () => {
    const legacy = hydratedPost(LEGACY_URI)
    serve({ [LEGACY_URI]: legacy })

    const result = await load(makeArgs())

    expect(loadedValue(result).post).toEqual(legacy)
    expect(commentedOn()).toBe(LEGACY_URI)
  })

  // -------------------------------------------------------------------------
  // Unavailable sentinels
  // -------------------------------------------------------------------------

  it('returns unavailable=notFound and does NOT fetch comments when neither collection hydrates', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    serve({})

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
    serve({ [POSTV2_URI]: { uri: POSTV2_URI, blocked: true } })

    const result = await load(makeArgs())
    const value = loadedValue(result)

    expect(value.unavailable).toBe('blocked')
    expect(value.post).toBeUndefined()
    expect(mockCovesMethods.getComments).not.toHaveBeenCalled()
    expect(result.slots).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('blocked'))

    warn.mockRestore()
  })

  // -------------------------------------------------------------------------
  // Unresolvable owner
  // -------------------------------------------------------------------------

  it('404s with couldnt_find_post when the owner handle does not resolve', async () => {
    // An owner that no longer exists is indistinguishable from a post that
    // never existed, and it is the post the visitor asked for.
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
  // ?uri= candidate
  // -------------------------------------------------------------------------

  it('uses a ?uri= that belongs to the owner and rkey verbatim', async () => {
    // The param carries the exact collection, so there is nothing to probe.
    serve({ [LEGACY_URI]: hydratedPost(LEGACY_URI) })

    await load(makeArgs({ query: `?uri=${encodeURIComponent(LEGACY_URI)}` }))

    expect(probes()).toEqual([[LEGACY_URI]])
    expect(commentedOn()).toBe(LEGACY_URI)
  })

  it('ignores a ?uri= from a repo that is not the owner', async () => {
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
  // Feed cache candidate
  // -------------------------------------------------------------------------

  it('uses a feed-cache hit from the owner as preload and skips the fetch', async () => {
    const cachedPost = hydratedPost(POSTV2_URI)
    // `findInFeed` reads `feeds.get('/')?.peek()?.feed[].post`.
    mockFeeds.set('/', { peek: () => ({ feed: [{ post: cachedPost }] }) })

    const result = await load(makeArgs())

    expect(loadedValue(result).post).toEqual(cachedPost)
    expect(mockCovesMethods.getPosts).not.toHaveBeenCalled()
    expect(mockCovesMethods.getCommunity).not.toHaveBeenCalled()
  })

  it('ignores a feed-cache hit whose record lives in another repo', async () => {
    // Same rkey, different repo: a TID collision across two authors would
    // otherwise render someone else's post under this URL.
    const foreign = `at://did:plc:someoneelse/${POST_COLLECTION}/${RKEY}`
    mockFeeds.set('/', {
      peek: () => ({ feed: [{ post: hydratedPost(foreign) }] }),
    })

    const result = await load(makeArgs())

    expect(probes()).toEqual([[POSTV2_URI, LEGACY_URI]])
    expect(loadedValue(result).post).toEqual(hydratedPost(POSTV2_URI))
  })

  // -------------------------------------------------------------------------
  // Fresh-post retry
  // -------------------------------------------------------------------------

  it('re-probes both collections while a just-created post is still unindexed', async () => {
    vi.useFakeTimers()
    try {
      let attempt = 0
      mockCovesMethods.getPosts.mockImplementation(
        async ({ uris }: { uris: string[] }) => {
          attempt++
          const hydrated = attempt > 1
          return {
            posts: uris.map((uri) =>
              hydrated && uri === POSTV2_URI
                ? hydratedPost(POSTV2_URI)
                : { uri, notFound: true },
            ),
          }
        },
      )

      const pending = load(
        makeArgs({ query: `?uri=${encodeURIComponent(POSTV2_URI)}` }),
      )
      await vi.advanceTimersByTimeAsync(3000)
      const result = await pending

      expect(loadedValue(result).post).toEqual(hydratedPost(POSTV2_URI))
      expect(mockCovesMethods.getPosts.mock.calls.length).toBeGreaterThan(1)
      // The retry probes the pair, not just the URI the create flow guessed.
      expect(probes().at(-1)).toEqual([POSTV2_URI, LEGACY_URI])
    } finally {
      vi.useRealTimers()
    }
  })

  // -------------------------------------------------------------------------
  // Canonical URL enforcement
  //
  // Owner and rkey are checked against the record itself; the community
  // segment was not, so one post had unlimited working aliases. Once the post
  // hydrates, any non-canonical segment redirects to the single URL the link
  // builders emit, carrying the query string across untouched.
  // -------------------------------------------------------------------------

  it('redirects a wrong community slug to the canonical permalink', async () => {
    const location = `${CANONICAL_PATH}?sort=top`

    await expect(
      load(makeArgs({ handle: 'cooking.local.coves.dev', query: '?sort=top' })),
    ).rejects.toMatchObject({ status: 302, location })

    // The target is stable: the second hop renders instead of bouncing on.
    const result = await load(argsFromLocation(location))
    expect(loadedValue(result).post).toEqual(hydratedPost(POSTV2_URI))
  })

  it('preserves a ?uri= param across the canonical redirect', async () => {
    // The create flow's one-shot hand-off rides in the query string; dropping
    // it on the redirect would cost the fresh post its retry budget.
    serve({ [LEGACY_URI]: hydratedPost(LEGACY_URI) })
    const query = `?uri=${encodeURIComponent(LEGACY_URI)}`
    const location = `${CANONICAL_PATH}${query}`

    await expect(
      load(makeArgs({ handle: 'cooking.local.coves.dev', query })),
    ).rejects.toMatchObject({ status: 302, location })

    const result = await load(argsFromLocation(location))
    expect(loadedValue(result).post).toEqual(hydratedPost(LEGACY_URI))
  })

  it('redirects a DID-form community slug to the handle form', async () => {
    // The DID resolves and the matcher accepts it, so it is a working alias
    // rather than an error — which is exactly why it needs canonicalising.
    await expect(
      load(makeArgs({ handle: COMMUNITY_DID })),
    ).rejects.toMatchObject({ status: 302, location: CANONICAL_PATH })

    const result = await load(argsFromLocation(CANONICAL_PATH))
    expect(loadedValue(result).post).toEqual(hydratedPost(POSTV2_URI))
  })

  it('redirects a DID-form owner segment to the author handle form', async () => {
    await expect(load(makeArgs({ owner: OWNER_DID }))).rejects.toMatchObject({
      status: 302,
      location: CANONICAL_PATH,
    })

    const result = await load(argsFromLocation(CANONICAL_PATH))
    expect(loadedValue(result).post).toEqual(hydratedPost(POSTV2_URI))
  })

  it('does not redirect a URL that is already canonical', async () => {
    const result = await load(makeArgs({ query: '?sort=top' }))

    const value = loadedValue(result)
    expect(value.post).toEqual(hydratedPost(POSTV2_URI))
    expect(value.unavailable).toBeUndefined()
  })

  it('renders a just-created post on the URL the create flow redirects to', async () => {
    // The create flow writes the record, stashes an optimistic view, and
    // navigates to `createdPostLink`. That link is built from the community
    // the form was submitted against — which carries `origin`, so its
    // canonical segment is the bare name. If the stashed view canonicalises
    // to anything else the very first load redirects, and the one-shot stash
    // is spent on a URL nobody renders.
    const community = {
      did: COMMUNITY_DID as DID,
      handle: 'c-gardening.coves.social' as Handle,
      name: 'gardening',
      origin: 'coves.social',
    }
    const output: CreatePostOutput = {
      uri: POSTV2_URI as AtUri,
      cid: 'bafyreigh2akiscaildc' as CID,
    }

    const view = buildFreshPostView({ output, community })
    if (!view) throw new Error('buildFreshPostView returned no view')
    stashFreshPost(view)

    const link = createdPostLink({ ...output, community, post: view })
    const [path, query] = link.split('?')
    expect(path).toBe(`/c/gardening/post/${OWNER_HANDLE}/${RKEY}`)

    const result = await load(
      makeArgs({ handle: 'gardening', query: `?${query}` }),
    )

    expect(loadedValue(result).post).toEqual(view)
    // The stash answered the load outright; nothing was fetched.
    expect(mockCovesMethods.getPosts).not.toHaveBeenCalled()
  })

  it('does not leak an unhandled rejection when it redirects away from an alias', async () => {
    // The feed init fires the comments request and hands the promise back for
    // the page to stream. A redirect throws past that return value, so nobody
    // is left to observe a failure — and in Node an unobserved rejection is a
    // process-level warning (a crash under --unhandled-rejections=strict).
    mockCovesMethods.getComments.mockRejectedValue(new Error('comments down'))

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      await expect(
        load(
          makeArgs({ handle: 'cooking.local.coves.dev', query: '?sort=top' }),
        ),
      ).rejects.toMatchObject({
        status: 302,
        location: `${CANONICAL_PATH}?sort=top`,
      })

      // Node reports an unobserved rejection only once the microtask queue
      // has drained, so give it a turn of the event loop before asserting.
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('still hands the page a rejecting comments promise on a canonical URL', async () => {
    // The guard above must not become a blanket swallow: when the page does
    // render, a failed comments fetch has to reach its {#await} as an error
    // rather than an empty thread.
    mockCovesMethods.getComments.mockRejectedValue(new Error('comments down'))

    const result = await load(makeArgs())

    await expect(loadedValue(result).comments).rejects.toThrow('comments down')
  })

  it('redirects a remote community to its name@origin form, @ left literal', async () => {
    // A bridged Lemmy community. `@` is a legal path character, and encoding
    // it would make the canonical URL unreadable — and would not survive the
    // round trip back through the router as the same param.
    const remotePost = {
      ...hydratedPost(POSTV2_URI),
      community: {
        did: COMMUNITY_DID,
        handle: 'gaming.lemmy-world.tdpl.io',
        name: 'gaming',
        origin: 'lemmy.world',
      },
    }
    serve({ [POSTV2_URI]: remotePost })
    const location = `/c/gaming@lemmy.world/post/${OWNER_HANDLE}/${RKEY}`

    await expect(
      load(makeArgs({ handle: 'gaming.lemmy-world.tdpl.io' })),
    ).rejects.toMatchObject({ status: 302, location })

    // Replayed through the router, the `@` decodes back to itself, so the
    // target is canonical and does not bounce.
    const result = await load(argsFromLocation(location))
    expect(loadedValue(result).post).toEqual(remotePost)
  })

  it('does not redirect a community-owned legacy post addressed by the community DID', async () => {
    // The record lives in the community's repo, so the author's handle would
    // address a record that does not exist. The authority DID is canonical
    // here, and nothing needs resolving to know it.
    const communityOwnedUri = `at://${COMMUNITY_DID}/${LEGACY_POST_COLLECTION}/${RKEY}`
    const legacy = hydratedPost(communityOwnedUri)
    serve({ [communityOwnedUri]: legacy })

    const result = await load(makeArgs({ owner: COMMUNITY_DID }))

    const value = loadedValue(result)
    expect(value.post).toEqual(legacy)
    expect(value.unavailable).toBeUndefined()
    expect(mockCovesMethods.getProfile).not.toHaveBeenCalled()
  })

  it('does not redirect an unavailable post, whatever the slug', async () => {
    // There is no hydrated community ref to canonicalise against, so the
    // "post removed" state must render rather than bounce.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    serve({})

    const result = await load(makeArgs({ handle: 'cooking.local.coves.dev' }))

    expect(loadedValue(result).unavailable).toBe('notFound')

    warn.mockRestore()
  })
})
