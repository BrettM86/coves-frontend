/**
 * `/profile/<handle>/rss` wiring: the user's posts by default, the user's
 * comments with `?type=comments` (parent posts hydrated in one batch), fetched
 * anonymously through the same-origin proxy. Item and HTML mapping are owned
 * by `$lib/server/rss/*.test.ts`; this file only checks which items arrive.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AtUri, CID, CommentView, PostView } from '$lib/api/coves/types'
import { createMockEvent } from '$lib/test-utils/request-event'
import type { DID, Handle } from '$lib/types/atproto'
import {
  TEST_ORIGIN,
  jsonResponse as json,
  parseRssChannel,
  stubProxyFetch,
  testPost,
  type ProxyAnswer,
} from '$lib/test-utils/rss-route'

vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.test' },
}))

import { GET } from './+server'

const PROFILE_NSID = 'social.coves.actor.getProfile'
const ACTOR_POSTS_NSID = 'social.coves.actor.getPosts'
const ACTOR_COMMENTS_NSID = 'social.coves.actor.getComments'
const GET_POSTS_NSID = 'social.coves.community.post.get'

const PROFILE = {
  did: 'did:plc:alice',
  handle: 'alice.coves.test',
  displayName: 'Alice',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const HYDRATED_PARENT = testPost('3kp1')
const MISSING_PARENT = testPost('3kp2')

function comment(rkey: string, parent: PostView): CommentView {
  const ref = { uri: parent.uri, cid: parent.cid }
  return {
    uri: `at://did:plc:alice/social.coves.community.comment/${rkey}` as AtUri,
    cid: `bafy${rkey}` as CID,
    createdAt: '2026-05-06T07:08:09.000Z',
    indexedAt: '2026-05-06T07:08:10.000Z',
    record: {
      $type: 'social.coves.community.comment',
      content: 'A reply',
      reply: { root: ref, parent: ref },
      createdAt: '2026-05-06T07:08:09.000Z',
    },
    author: {
      did: 'did:plc:alice' as DID,
      handle: 'alice.coves.test' as Handle,
      displayName: 'Alice',
    },
    post: ref,
    stats: { upvotes: 0, downvotes: 0, score: 0, replyCount: 0 },
  }
}

/** Three comments over two parents; only the first parent still exists. */
const COMMENTS = [
  comment('3kc1', HYDRATED_PARENT),
  comment('3kc2', MISSING_PARENT),
  comment('3kc3', HYDRATED_PARENT),
]

function upstreamWith(comments: CommentView[]): ProxyAnswer {
  return (nsid, params) => {
    switch (nsid) {
      case PROFILE_NSID:
        return json(PROFILE)
      case ACTOR_POSTS_NSID:
        return json({ feed: [{ post: testPost('3kaaa') }] })
      case ACTOR_COMMENTS_NSID:
        return json({ comments })
      case GET_POSTS_NSID:
        // Mirrors the requested order 1:1, as the real endpoint does.
        return json({
          posts: params
            .getAll('uris')
            .map((uri) =>
              uri === HYDRATED_PARENT.uri
                ? HYDRATED_PARENT
                : { uri, notFound: true },
            ),
        })
      default:
        return json({ error: 'NotFound', message: `unexpected ${nsid}` }, 404)
    }
  }
}

async function get(query: string, answer: ProxyAnswer) {
  const upstream = stubProxyFetch(answer)
  const event = createMockEvent({
    url: `${TEST_ORIGIN}/profile/alice.coves.test/rss${query}`,
    params: { handle: 'alice.coves.test' },
    routeId: '/profile/[handle=actor]/rss',
  })
  Object.assign(event, { fetch: upstream.fetch })
  const response = await GET(event as unknown as Parameters<typeof GET>[0])
  return { response, calls: upstream.calls }
}

beforeEach(() => {
  vi.stubGlobal('__VERSION__', 'test')
})

describe('GET /profile/[handle]/rss', () => {
  it("serves the user's posts as cacheable RSS", async () => {
    const { response } = await get('', upstreamWith(COMMENTS))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/rss+xml; charset=utf-8',
    )
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    const channel = parseRssChannel(await response.text())
    expect(channel).toMatchObject({
      link: 'https://coves.test/profile/alice.coves.test',
      self: 'https://coves.test/profile/alice.coves.test/rss',
      guids: ['at://did:plc:alice/social.coves.community.post/3kaaa'],
    })
    expect(channel.title).toContain('Alice')
  })

  it("asks the proxy anonymously for the user's newest 25 posts", async () => {
    const { calls } = await get('', upstreamWith(COMMENTS))

    const postsCall = calls.find((call) => call.nsid === ACTOR_POSTS_NSID)
    expect(postsCall).toBeDefined()
    expect(calls.map((call) => call.credentials)).toEqual(
      calls.map(() => 'omit'),
    )
    expect({
      actor: postsCall?.params.get('actor'),
      limit: postsCall?.params.get('limit'),
    }).toEqual({ actor: 'alice.coves.test', limit: '25' })
  })

  it('with ?type=comments, serves the comments whose parent post still exists', async () => {
    const { response, calls } = await get(
      '?type=comments',
      upstreamWith(COMMENTS),
    )
    const posts = await get('', upstreamWith(COMMENTS))

    expect(response.status).toBe(200)
    const channel = parseRssChannel(await response.text())
    expect(channel).toMatchObject({
      link: 'https://coves.test/profile/alice.coves.test',
      self: 'https://coves.test/profile/alice.coves.test/rss?type=comments',
      guids: [
        'at://did:plc:alice/social.coves.community.comment/3kc1',
        'at://did:plc:alice/social.coves.community.comment/3kc3',
      ],
    })
    expect(channel.title).toContain('Alice')
    // A reader subscribed to both feeds must be able to tell them apart.
    expect(channel.title).not.toBe(
      parseRssChannel(await posts.response.text()).title,
    )

    const commentsCall = calls.find((call) => call.nsid === ACTOR_COMMENTS_NSID)
    expect({
      actor: commentsCall?.params.get('actor'),
      limit: commentsCall?.params.get('limit'),
    }).toEqual({ actor: 'alice.coves.test', limit: '25' })
    const hydrateCalls = calls.filter((call) => call.nsid === GET_POSTS_NSID)
    expect(hydrateCalls).toHaveLength(1)
    expect(hydrateCalls[0]?.params.getAll('uris').sort()).toEqual([
      'at://did:plc:alice/social.coves.community.post/3kp1',
      'at://did:plc:alice/social.coves.community.post/3kp2',
    ])
  })

  it('with ?type=comments and no comments, serves an empty channel without hydrating posts', async () => {
    const { response, calls } = await get('?type=comments', upstreamWith([]))

    expect(response.status).toBe(200)
    expect(parseRssChannel(await response.text()).guids).toEqual([])
    expect(calls.map((call) => call.nsid)).not.toContain(GET_POSTS_NSID)
  })

  it.each([
    ['an unknown ?type', '?type=bogus', upstreamWith(COMMENTS), 400],
    [
      'an unknown user (getProfile 404)',
      '',
      ((nsid, params) =>
        nsid === PROFILE_NSID
          ? json({ error: 'ProfileNotFound', message: 'user not found' }, 404)
          : upstreamWith(COMMENTS)(nsid, params)) satisfies ProxyAnswer,
      404,
    ],
    [
      'an unreachable backend',
      '',
      (() =>
        Promise.reject(new TypeError('fetch failed'))) satisfies ProxyAnswer,
      503,
    ],
  ])('%s → never-cached error', async (_case, query, answer, status) => {
    const { response } = await get(query, answer)

    expect({
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
    }).toEqual({ status, cacheControl: 'no-store' })
  })

  it.each([
    ['posts', 'getProfile', '', PROFILE_NSID],
    ['posts', 'the items call', '', ACTOR_POSTS_NSID],
    ['comments', 'getProfile', '?type=comments', PROFILE_NSID],
    ['comments', 'the items call', '?type=comments', ACTOR_COMMENTS_NSID],
  ])(
    'an unknown user → 404 for the %s feed when %s settles last',
    async (_feed, _delayed, query, delayedNsid) => {
      // The real backend answers a missing user with ProfileNotFound from
      // getProfile and ActorNotFound from actor.getPosts/getComments. The
      // delayed call is held back one macrotask so the other one's rejection
      // settles first.
      const answer: ProxyAnswer = async (nsid) => {
        if (nsid === delayedNsid) {
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
        return nsid === PROFILE_NSID
          ? json({ error: 'ProfileNotFound', message: 'user not found' }, 404)
          : json({ error: 'ActorNotFound', message: 'Actor not found' }, 404)
      }

      // A handler that throws is served by Kit as a 500.
      const outcome = await get(query, answer).then(
        ({ response }) => ({
          status: response.status,
          cacheControl: response.headers.get('cache-control'),
        }),
        (err: unknown) => ({ thrown: String(err) }),
      )

      expect(outcome).toEqual({ status: 404, cacheControl: 'no-store' })
    },
  )

  it.each([
    ['getProfile', '', PROFILE_NSID],
    ['getActorPosts', '', ACTOR_POSTS_NSID],
    ['getActorComments', '?type=comments', ACTOR_COMMENTS_NSID],
  ])(
    'a 404 from %s without a not-found error name propagates instead of serving a not-found feed',
    async (_endpoint, query, failingNsid) => {
      // A misrouted or unimplemented endpoint also answers 404, but the user
      // exists; only a not-found error name (ProfileNotFound, ActorNotFound)
      // means a missing user.
      const answer: ProxyAnswer = (nsid, params) =>
        nsid === failingNsid
          ? json(
              { error: 'MethodNotImplemented', message: 'Method not found' },
              404,
            )
          : upstreamWith(COMMENTS)(nsid, params)

      const outcome = await get(query, answer).then(
        ({ response }) => ({ status: response.status }),
        (err: unknown) => ({ thrown: err }),
      )

      expect(outcome).toEqual({
        thrown: expect.objectContaining({
          status: 404,
          errorName: 'MethodNotImplemented',
        }),
      })
    },
  )
})
