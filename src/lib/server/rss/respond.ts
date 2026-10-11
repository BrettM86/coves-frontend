import type { RequestEvent } from '@sveltejs/kit'
import { coves } from '$lib/api/client.svelte'
import type { CovesClient } from '$lib/api/coves'
import { XrpcError } from '$lib/api/coves/xrpc'
import { isBackendUnavailable } from '$lib/app/util/error'
import { log } from '$lib/server/log'
import { buildRssDocument, type RssFeed } from './document'

/** Items per feed. */
export const RSS_ITEM_LIMIT = 25

/** Retry-After sent on a feed 429 when the upstream gave none, in seconds. */
const DEFAULT_RETRY_AFTER_SECONDS = 300

/** Thrown by a feed route when the community or user it serves does not exist. */
export class FeedSourceNotFoundError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('RSS feed source not found', options)
    this.name = 'FeedSourceNotFoundError'
  }
}

/**
 * A Coves client that reaches the AppView through the same-origin proxy as an
 * anonymous visitor. `credentials: 'omit'` keeps Kit from forwarding the
 * reader's session cookie to the proxy, so a feed is the same document for
 * everyone and safe to cache publicly.
 */
export function anonymousCovesClient(
  event: Pick<RequestEvent, 'fetch'>,
): CovesClient {
  return coves({
    func: (input, init) => event.fetch(input, { ...init, credentials: 'omit' }),
  })
}

/** A never-cached error response for a feed request. */
export function feedErrorResponse(
  status: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

/**
 * Builds the feed and frames it as a publicly cacheable RSS response. Known
 * upstream failures become never-cached HTTP errors: a missing source is 404,
 * upstream rate limiting is 429 (with the upstream's `retry-after`, or 300
 * seconds when it gave none), and an unreachable or failing backend is 503. Anything else is
 * rethrown for Kit's error handling.
 */
export async function serveRssFeed(
  build: () => Promise<RssFeed>,
): Promise<Response> {
  let feed: RssFeed
  try {
    feed = await build()
  } catch (err) {
    if (err instanceof FeedSourceNotFoundError) {
      return feedErrorResponse(404, 'Not found')
    }
    if (err instanceof XrpcError && err.status === 429) {
      log.warn('[rss] upstream rate limited the feed request', undefined, err)
      return feedErrorResponse(429, 'Too many requests', {
        'retry-after': String(
          err.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS,
        ),
      })
    }
    if (isBackendUnavailable(err)) {
      log.warn('[rss] backend unavailable for the feed request', undefined, err)
      return feedErrorResponse(503, 'Service unavailable')
    }
    throw err
  }
  return new Response(buildRssDocument(feed.channel, feed.items), {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  })
}
