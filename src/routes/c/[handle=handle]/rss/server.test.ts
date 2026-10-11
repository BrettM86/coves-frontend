/**
 * `/c/<community>/rss` wiring: which upstream calls the route makes (through
 * the same-origin proxy, anonymously), how it frames the RSS response, and how
 * upstream failures become HTTP statuses. Item and HTML mapping are owned by
 * `$lib/server/rss/*.test.ts`; this file only checks that the feed's posts
 * arrive as items.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockEvent } from '$lib/test-utils/request-event'
import {
  TEST_ORIGIN,
  jsonResponse as json,
  parseRssChannel,
  stubProxyFetch,
  testPost,
  type ProxyAnswer,
} from '$lib/test-utils/rss-route'

// `gaming` with origin coves.test is a local community, so its URL is `/c/gaming`.
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.test' },
}))

import { GET } from './+server'

const FEED_NSID = 'social.coves.communityFeed.getCommunity'
const COMMUNITY_NSID = 'social.coves.community.get'

const COMMUNITY = {
  did: 'did:plc:gaming',
  handle: 'c-gaming.coves.test',
  name: 'gaming',
  origin: 'coves.test',
  displayName: 'Gaming Hub',
  description: 'All about games',
  subscriberCount: 3,
  memberCount: 3,
  postCount: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  allowExternalDiscovery: true,
}

const healthyUpstream: ProxyAnswer = (nsid) => {
  if (nsid === FEED_NSID) {
    return json({
      feed: [{ post: testPost('3kaaa') }, { post: testPost('3kbbb') }],
    })
  }
  if (nsid === COMMUNITY_NSID) return json(COMMUNITY)
  return json({ error: 'NotFound', message: `unexpected ${nsid}` }, 404)
}

async function get(query: string, answer: ProxyAnswer) {
  const upstream = stubProxyFetch(answer)
  const event = createMockEvent({
    url: `${TEST_ORIGIN}/c/gaming/rss${query}`,
    params: { handle: 'gaming' },
    routeId: '/c/[handle=handle]/rss',
  })
  Object.assign(event, { fetch: upstream.fetch })
  const response = await GET(event as unknown as Parameters<typeof GET>[0])
  return { response, calls: upstream.calls }
}

beforeEach(() => {
  vi.stubGlobal('__VERSION__', 'test')
})

describe('GET /c/[handle]/rss', () => {
  it('serves the community feed as cacheable RSS', async () => {
    const { response } = await get('', healthyUpstream)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/rss+xml; charset=utf-8',
    )
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(parseRssChannel(await response.text())).toEqual({
      title: 'Gaming Hub',
      link: 'https://coves.test/c/gaming',
      self: 'https://coves.test/c/gaming/rss',
      guids: [
        'at://did:plc:alice/social.coves.community.post/3kaaa',
        'at://did:plc:alice/social.coves.community.post/3kbbb',
      ],
    })
  })

  it('asks the proxy anonymously for the newest 25 posts by default', async () => {
    const { calls } = await get('', healthyUpstream)

    const feedCall = calls.find((call) => call.nsid === FEED_NSID)
    expect(feedCall).toBeDefined()
    expect(calls.map((call) => call.credentials)).toEqual(
      calls.map(() => 'omit'),
    )
    expect({
      community: feedCall?.params.get('community'),
      sort: feedCall?.params.get('sort'),
      timeframe: feedCall?.params.get('timeframe'),
      limit: feedCall?.params.get('limit'),
    }).toEqual({
      community: 'gaming',
      sort: 'new',
      timeframe: null,
      limit: '25',
    })
  })

  it('forwards the page sort and timeframe and keeps them in the self link', async () => {
    const { response, calls } = await get(
      '?sort=top&timeframe=week',
      healthyUpstream,
    )

    const feedCall = calls.find((call) => call.nsid === FEED_NSID)
    expect({
      sort: feedCall?.params.get('sort'),
      timeframe: feedCall?.params.get('timeframe'),
    }).toEqual({ sort: 'top', timeframe: 'week' })
    expect(parseRssChannel(await response.text()).self).toBe(
      'https://coves.test/c/gaming/rss?sort=top&timeframe=week',
    )
  })

  it.each([
    [
      'unknown community (404 CommunityNotFound)',
      404,
      null,
      () => json({ error: 'CommunityNotFound', message: 'no' }, 404),
    ],
    [
      'unparseable community (400 InvalidRequest)',
      404,
      null,
      () => json({ error: 'InvalidRequest', message: 'bad' }, 400),
    ],
    [
      'rate limited (429 with retry-after)',
      429,
      '30',
      () =>
        json({ error: 'RateLimitExceeded', message: 'slow down' }, 429, {
          'retry-after': '30',
        }),
    ],
    [
      'rate limited without retry-after (429)',
      429,
      '300',
      () => json({ error: 'RateLimitExceeded', message: 'slow down' }, 429),
    ],
    [
      'feed call rate limited while the community loads (429)',
      429,
      '30',
      ((nsid, params) =>
        nsid === FEED_NSID
          ? json({ error: 'RateLimitExceeded', message: 'slow down' }, 429, {
              'retry-after': '30',
            })
          : healthyUpstream(nsid, params)) satisfies ProxyAnswer,
    ],
    [
      'feed call unavailable while the community loads (503)',
      503,
      null,
      ((nsid, params) =>
        nsid === FEED_NSID
          ? json({ error: 'ServiceUnavailable', message: 'down' }, 503)
          : healthyUpstream(nsid, params)) satisfies ProxyAnswer,
    ],
    [
      'backend unavailable (503)',
      503,
      null,
      () => json({ error: 'ServiceUnavailable', message: 'down' }, 503),
    ],
    [
      'backend unreachable (fetch failed)',
      503,
      null,
      () => Promise.reject(new TypeError('fetch failed')),
    ],
  ])('%s → %i, never cached', async (_case, status, retryAfter, answer) => {
    const { response } = await get('', answer)

    expect({
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      retryAfter: response.headers.get('retry-after'),
    }).toEqual({ status, cacheControl: 'no-store', retryAfter })
  })

  it('a 400 InvalidRequest from the feed call propagates when the community exists', async () => {
    // The backend also answers 400 InvalidRequest for a bad sort, timeframe or
    // limit, so only getCommunity decides that the community is missing.
    const answer: ProxyAnswer = (nsid, params) =>
      nsid === FEED_NSID
        ? json({ error: 'InvalidRequest', message: 'bad sort' }, 400)
        : healthyUpstream(nsid, params)

    // A handler that throws is served by Kit as a 500.
    const outcome = await get('', answer).then(
      ({ response }) => ({ status: response.status }),
      (err: unknown) => ({ thrown: err }),
    )

    expect(outcome).toEqual({
      thrown: expect.objectContaining({
        status: 400,
        errorName: 'InvalidRequest',
      }),
    })
  })

  it('an unknown community → 404 even when the feed call fails first with 400', async () => {
    // getCommunity's answer is held back one macrotask so the feed call's
    // rejection settles first.
    const answer: ProxyAnswer = async (nsid) => {
      if (nsid === FEED_NSID) {
        return json({ error: 'InvalidRequest', message: 'bad' }, 400)
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
      return json({ error: 'CommunityNotFound', message: 'no' }, 404)
    }

    const outcome = await get('', answer).then(
      ({ response }) => ({
        status: response.status,
        cacheControl: response.headers.get('cache-control'),
      }),
      (err: unknown) => ({ thrown: String(err) }),
    )

    expect(outcome).toEqual({ status: 404, cacheControl: 'no-store' })
  })

  it('a 404 from getCommunity that is not a not-found error propagates', async () => {
    // A misrouted or unimplemented endpoint also answers 404, but the
    // community may well exist.
    const answer: ProxyAnswer = (nsid, params) =>
      nsid === COMMUNITY_NSID
        ? json(
            { error: 'MethodNotImplemented', message: 'Method not found' },
            404,
          )
        : healthyUpstream(nsid, params)

    const outcome = await get('', answer).then(
      ({ response }) => ({ status: response.status }),
      (err: unknown) => ({ thrown: err }),
    )

    expect(outcome).toEqual({
      thrown: expect.objectContaining({
        status: 404,
        errorName: 'MethodNotImplemented',
      }),
    })
  })
})
