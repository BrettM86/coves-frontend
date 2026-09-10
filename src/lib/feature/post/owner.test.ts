import { describe, expect, it, vi } from 'vitest'
import type {
  AtUri,
  CID,
  CommunityRef,
  PostView,
  PostViewUnion,
} from '$lib/api/coves/types'
import type { CovesClient } from '$lib/api/coves/client'
import type { DID, Handle } from '$lib/types/atproto'
import type { PostSubmitResult } from './form/post-form.svelte'
import { buildLegacyPostAtUri, buildPostAtUri } from './helpers'
import {
  addressesRecord,
  createdPostLink,
  fetchPostByOwner,
  resolveOwnerDid,
} from './owner'

const OWNER_DID = 'did:plc:author' as DID
const OWNER_HANDLE = 'mari.local.coves.dev'
const RKEY = '3lrkey'

// Built through the helpers so this file cannot drift from the collection
// NSIDs the loader will actually request.
const postV2Uri = buildPostAtUri(OWNER_DID, RKEY)
const legacyUri = buildLegacyPostAtUri(OWNER_DID, RKEY)

// The two URIs above are derived, so pin them once: a regression in either
// builder would otherwise let every assertion below agree on a wrong string.
describe('probe URIs', () => {
  it('are the postv2 and legacy AT-URIs for the owner repo', () => {
    expect(postV2Uri).toBe(
      'at://did:plc:author/social.coves.community.postv2/3lrkey',
    )
    expect(legacyUri).toBe(
      'at://did:plc:author/social.coves.community.post/3lrkey',
    )
  })
})

// ---------------------------------------------------------------------------
// addressesRecord()
// ---------------------------------------------------------------------------

describe('addressesRecord', () => {
  it('accepts a postv2 URI in the owner repo with the same rkey', () => {
    expect(addressesRecord(postV2Uri, OWNER_DID, RKEY)).toBe(true)
  })

  it('accepts the legacy community-owned collection too', () => {
    expect(addressesRecord(legacyUri, OWNER_DID, RKEY)).toBe(true)
  })

  it('rejects a record in another repo', () => {
    expect(
      addressesRecord(
        'at://did:plc:someoneelse/social.coves.community.postv2/3lrkey',
        OWNER_DID,
        RKEY,
      ),
    ).toBe(false)
  })

  it('rejects a different rkey in the owner repo', () => {
    expect(
      addressesRecord(
        'at://did:plc:author/social.coves.community.postv2/zzz999',
        OWNER_DID,
        RKEY,
      ),
    ).toBe(false)
  })

  it.each([null, undefined, ''])('rejects %p', (candidate) => {
    expect(addressesRecord(candidate, OWNER_DID, RKEY)).toBe(false)
  })

  it('rejects a candidate missing the at:// scheme', () => {
    // `?uri=` is user input. Splitting on "/" alone reads this as a valid
    // triple, and the bare string would then be sent to the backend as a URI.
    expect(
      addressesRecord(
        'did:plc:author/social.coves.community.postv2/3lrkey',
        OWNER_DID,
        RKEY,
      ),
    ).toBe(false)
  })

  it('rejects a candidate carrying extra path segments', () => {
    expect(
      addressesRecord(
        'at://did:plc:author/social.coves.community.postv2/3lrkey/extra',
        OWNER_DID,
        RKEY,
      ),
    ).toBe(false)
  })

  it('rejects a record from a collection that does not hold posts', () => {
    // Same repo, same rkey, but a comment record. Trusting it would send the
    // post endpoint a URI it can never hydrate.
    expect(
      addressesRecord(
        'at://did:plc:author/social.coves.community.comment/3lrkey',
        OWNER_DID,
        RKEY,
      ),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolveOwnerDid()
// ---------------------------------------------------------------------------

function profileClient(): {
  client: Pick<CovesClient, 'getProfile'>
  getProfile: ReturnType<typeof vi.fn>
} {
  const getProfile = vi.fn()
  return {
    client: { getProfile } as unknown as Pick<CovesClient, 'getProfile'>,
    getProfile,
  }
}

describe('resolveOwnerDid', () => {
  it('returns a DID owner unchanged, without touching the network', async () => {
    const { client, getProfile } = profileClient()

    await expect(resolveOwnerDid(client, OWNER_DID)).resolves.toBe(OWNER_DID)
    expect(getProfile).not.toHaveBeenCalled()
  })

  it('resolves a handle owner through getProfile', async () => {
    const { client, getProfile } = profileClient()
    getProfile.mockResolvedValue({ did: OWNER_DID, handle: OWNER_HANDLE })

    await expect(resolveOwnerDid(client, OWNER_HANDLE)).resolves.toBe(OWNER_DID)
    expect(getProfile).toHaveBeenCalledTimes(1)
    expect(getProfile).toHaveBeenCalledWith({ actor: OWNER_HANDLE })
  })

  it('propagates a getProfile rejection instead of swallowing it', async () => {
    // An unknown handle must reach the loader, which turns it into a 404.
    // Returning the raw handle here would build an unroutable AT-URI.
    const { client, getProfile } = profileClient()
    const failure = new Error('actor not found')
    getProfile.mockRejectedValue(failure)

    await expect(resolveOwnerDid(client, OWNER_HANDLE)).rejects.toBe(failure)
  })
})

// ---------------------------------------------------------------------------
// fetchPostByOwner()
// ---------------------------------------------------------------------------

function hydrated(uri: AtUri): PostViewUnion {
  return {
    uri,
    cid: 'bafyreigh2akiscaildc',
    rkey: RKEY,
    indexedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    author: { did: OWNER_DID, handle: OWNER_HANDLE },
    community: { did: 'did:plc:comm', handle: 'gardening.local.coves.dev' },
  } as unknown as PostViewUnion
}

function notFound(uri: AtUri): PostViewUnion {
  return { uri, notFound: true } as PostViewUnion
}

function blocked(uri: AtUri): PostViewUnion {
  return { uri, blocked: true } as PostViewUnion
}

/** A client whose single batch call answers with `posts`, in request order. */
function postsClient(posts: PostViewUnion[]): {
  client: Pick<CovesClient, 'getPosts'>
  getPosts: ReturnType<typeof vi.fn>
} {
  const getPosts = vi.fn().mockResolvedValue({ posts })
  return {
    client: { getPosts } as unknown as Pick<CovesClient, 'getPosts'>,
    getPosts,
  }
}

describe('fetchPostByOwner', () => {
  it('probes postv2 and the legacy collection in a single batch call', async () => {
    const { client, getPosts } = postsClient([
      hydrated(postV2Uri),
      notFound(legacyUri),
    ])

    await fetchPostByOwner(client, OWNER_DID, RKEY)

    expect(getPosts).toHaveBeenCalledTimes(1)
    expect(getPosts).toHaveBeenCalledWith({ uris: [postV2Uri, legacyUri] })
  })

  it('prefers the postv2 entry when both collections hydrate', async () => {
    const postV2 = hydrated(postV2Uri)
    const { client } = postsClient([postV2, hydrated(legacyUri)])

    await expect(fetchPostByOwner(client, OWNER_DID, RKEY)).resolves.toEqual({
      uri: postV2Uri,
      result: postV2,
    })
  })

  it('falls back to the legacy entry when postv2 is notFound', async () => {
    const legacy = hydrated(legacyUri)
    const { client } = postsClient([notFound(postV2Uri), legacy])

    await expect(fetchPostByOwner(client, OWNER_DID, RKEY)).resolves.toEqual({
      uri: legacyUri,
      result: legacy,
    })
  })

  it('reports the postv2 notFound sentinel when neither collection hydrates', async () => {
    const { client } = postsClient([notFound(postV2Uri), notFound(legacyUri)])

    await expect(fetchPostByOwner(client, OWNER_DID, RKEY)).resolves.toEqual({
      uri: postV2Uri,
      result: { uri: postV2Uri, notFound: true },
    })
  })

  it('surfaces a blocked sentinel in preference to a notFound one', async () => {
    // "Blocked" is a real answer about a real record; "not found" is the
    // absence of one. Reporting notFound here would tell the reader the post
    // was deleted when it was actually withheld.
    const legacyBlocked = blocked(legacyUri)
    const { client } = postsClient([notFound(postV2Uri), legacyBlocked])

    await expect(fetchPostByOwner(client, OWNER_DID, RKEY)).resolves.toEqual({
      uri: legacyUri,
      result: legacyBlocked,
    })
  })

  it('throws when the batch endpoint returns fewer entries than requested', async () => {
    // The endpoint contract is 1:1 and order-preserving (see CovesClient.getPost).
    // A short array is a backend bug, not a missing post.
    const { client } = postsClient([hydrated(postV2Uri)])

    await expect(fetchPostByOwner(client, OWNER_DID, RKEY)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// createdPostLink()
// ---------------------------------------------------------------------------

describe('createdPostLink', () => {
  const community: CommunityRef = {
    did: 'did:plc:comm' as DID,
    handle: 'gardening.local.coves.dev' as Handle,
    name: 'gardening',
  }

  const optimisticPost = {
    uri: postV2Uri,
    cid: 'bafyreigh2akiscaildc' as CID,
    rkey: RKEY,
    indexedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    author: { did: OWNER_DID, handle: OWNER_HANDLE as Handle },
    community,
  } satisfies PostView

  function submitResult(post?: PostView): PostSubmitResult {
    return {
      uri: postV2Uri,
      cid: 'bafyreigh2akiscaildc' as CID,
      community,
      post,
    }
  }

  it('addresses a just-created post by its author handle', () => {
    const [path, query] = createdPostLink(submitResult(optimisticPost)).split(
      '?',
    )

    expect(path).toBe(
      '/c/gardening.local.coves.dev/post/mari.local.coves.dev/3lrkey',
    )
    // The create flow redirects before the AppView has indexed the record, so
    // the page needs the exact URI to load it without a probe or cache hit.
    expect(new URLSearchParams(query).get('uri')).toBe(postV2Uri)
  })

  it('falls back to the repo DID when the optimistic view is missing', () => {
    const [path, query] = createdPostLink(submitResult(undefined)).split('?')

    expect(path).toBe(
      '/c/gardening.local.coves.dev/post/did%3Aplc%3Aauthor/3lrkey',
    )
    expect(new URLSearchParams(query).get('uri')).toBe(postV2Uri)
  })
})
