import { resolveFeedSort } from '$lib/api/coves/sort'
import { XrpcError } from '$lib/api/coves/xrpc'
import { communityLink } from '$lib/app/util/links'
import { communityDisplayName } from '$lib/feature/community/helpers'
import { postToRssItem } from '$lib/server/rss/items'
import {
  FeedSourceNotFoundError,
  RSS_ITEM_LIMIT,
  anonymousCovesClient,
  serveRssFeed,
} from '$lib/server/rss/respond'
import type { Handle } from '$lib/types/atproto'
import type { RequestHandler } from './$types'

/**
 * "No such community", as the community page's loader reads it: the AppView
 * cannot find it (404) or cannot parse the identifier (400). Only the
 * AppView's own error names count; the proxy's own 400s mean something else.
 */
function isCommunityNotFound(err: unknown): boolean {
  return (
    err instanceof XrpcError &&
    (err.status === 404
      ? err.errorName === 'NotFound' || err.errorName === 'CommunityNotFound'
      : err.status === 400 && err.errorName === 'InvalidRequest')
  )
}

/**
 * The community's posts as RSS, newest first unless the URL names the
 * community page's `sort` / `timeframe`.
 */
export const GET: RequestHandler = (event) =>
  serveRssFeed(async () => {
    const api = anonymousCovesClient(event)
    const community = event.params.handle as Handle
    const sort = resolveFeedSort(event.url, { sort: 'new', timeframe: 'all' })
    const origin = event.url.origin

    // Only getCommunity decides that the community is missing: the feed call
    // also answers 400 InvalidRequest for a bad sort, timeframe or limit, and
    // under Promise.all its rejection could settle first.
    const [feedResult, detailsResult] = await Promise.allSettled([
      api.getCommunityFeed({ community, ...sort, limit: RSS_ITEM_LIMIT }),
      api.getCommunity({ community }),
    ])
    if (detailsResult.status === 'rejected') {
      if (isCommunityNotFound(detailsResult.reason)) {
        throw new FeedSourceNotFoundError({ cause: detailsResult.reason })
      }
      throw detailsResult.reason
    }
    if (feedResult.status === 'rejected') throw feedResult.reason
    const feed = feedResult.value
    const details = detailsResult.value

    const title = communityDisplayName(details)
    return {
      channel: {
        title,
        link: communityLink(details, origin),
        description: details.description || `Posts in ${title}`,
        selfUrl: event.url.href,
      },
      items: (feed.feed ?? []).map(({ post }) => postToRssItem(post, origin)),
    }
  })
