import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Feed-cache gating
//
// Deliberately a separate file from `page.test.ts`: that one replaces the
// `feed()` factory with a fake that always runs its init, which is what makes
// the per-branch API assertions readable. Here the real cache is the subject,
// so only the client and the rune wrappers are faked.
//
// `feed.svelte.ts` reads `browser` and imports `profile`, whose real module
// touches localStorage at import time. The cache only reuses an instance when
// `browser` is true, which is the mode this file cares about.
// ---------------------------------------------------------------------------

vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
  version: 'test',
}))

vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: { meta: { profile: undefined } },
}))

const mockCovesMethods = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getPosts: vi.fn(),
  getComments: vi.fn(),
  getCommunity: vi.fn(),
}))

vi.mock('$lib/api/client.svelte', () => ({
  coves: () => mockCovesMethods,
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

import { feeds } from '$lib/feature/feeds/feed.svelte'
import { load } from './+page'

const OWNER_DID = 'did:plc:author'
const OWNER_HANDLE = 'mari.local.coves.dev'
const COMMUNITY_DID = 'did:plc:comm'
const COMMUNITY_HANDLE = 'gardening.local.coves.dev'
const COMMENTER_DID = 'did:plc:commenter456'
const RKEY = 'abc123'
const CRKEY = 'comment1'

const POST_COLLECTION = 'social.coves.community.postv2'
const LEGACY_POST_COLLECTION = 'social.coves.community.post'
const COMMENT_COLLECTION = 'social.coves.community.comment'

const POSTV2_URI = `at://${OWNER_DID}/${POST_COLLECTION}/${RKEY}`
const LEGACY_URI = `at://${OWNER_DID}/${LEGACY_POST_COLLECTION}/${RKEY}`

function makeArgs(): Parameters<typeof load>[0] {
  return {
    params: {
      handle: COMMUNITY_HANDLE,
      owner: OWNER_DID,
      rkey: RKEY,
      commenter: COMMENTER_DID,
      crkey: CRKEY,
    },
    url: new URL(
      `https://coves.test/c/${COMMUNITY_HANDLE}/post/${OWNER_DID}/${RKEY}/comment/${COMMENTER_DID}/${CRKEY}`,
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

function subtree(postUri: string) {
  const uri = `at://${COMMENTER_DID}/${COMMENT_COLLECTION}/${CRKEY}`
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
              parent: { uri: postUri, cid: 'bafyreiparent' },
            },
            createdAt: '2026-01-02T00:00:00.000Z',
          },
          author: { did: COMMENTER_DID, handle: 'commenter.coves.test' },
          post: { uri: postUri, cid: 'bafyreigh2akiscaildc' },
          stats: { upvotes: 0, downvotes: 0, score: 0, replyCount: 0 },
        },
        replies: [],
      },
    ],
  }
}

function serve(available: Record<string, unknown>): void {
  mockCovesMethods.getPosts.mockImplementation(
    async ({ uris }: { uris: string[] }) => ({
      posts: uris.map((uri) => available[uri] ?? { uri, notFound: true }),
    }),
  )
}

describe('comment permalink loader feed cache', () => {
  beforeEach(() => {
    mockCovesMethods.getProfile.mockReset()
    mockCovesMethods.getPosts.mockReset()
    mockCovesMethods.getComments.mockReset()
    mockCovesMethods.getCommunity.mockReset()
    // The cache is module state shared by every test in the process.
    feeds.clear()

    serve({ [POSTV2_URI]: hydratedPost(POSTV2_URI) })
    mockCovesMethods.getComments.mockImplementation(
      async ({ post }: { post: string }) => subtree(post),
    )
  })

  it('serves a repeated identical load without re-fetching', async () => {
    // Two navigations to the same permalink — a back button, a re-render, an
    // invalidation with unchanged params. Anything the loader does outside the
    // feed init escapes the cache and costs a request every time.
    await load(makeArgs())
    await load(makeArgs())

    expect(mockCovesMethods.getPosts).toHaveBeenCalledTimes(1)
    expect(mockCovesMethods.getComments).toHaveBeenCalledTimes(1)
  })

  it('serves a repeated load of a legacy post without re-fetching or a stray rejection', async () => {
    // The legacy path also abandons a speculative subtree request. Repeating
    // it outside the cache both re-fetches and leaves that rejection loose.
    serve({ [LEGACY_URI]: hydratedPost(LEGACY_URI) })
    mockCovesMethods.getComments.mockImplementation(
      async ({ post }: { post: string }) => {
        if (post !== LEGACY_URI) {
          throw new Error(`no subtree for ${post}`)
        }
        return subtree(post)
      },
    )

    await load(makeArgs())
    const callsAfterFirst = mockCovesMethods.getComments.mock.calls.length

    await load(makeArgs())

    expect(mockCovesMethods.getPosts).toHaveBeenCalledTimes(1)
    expect(mockCovesMethods.getComments.mock.calls.length).toBe(callsAfterFirst)
  })
})
