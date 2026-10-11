import { isHydratedPost } from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'
import { userLink } from '$lib/app/util/links'
import { log } from '$lib/server/log'
import type { RssItem } from '$lib/server/rss/document'
import { commentsToRssItems, postToRssItem } from '$lib/server/rss/items'
import {
  FeedSourceNotFoundError,
  RSS_ITEM_LIMIT,
  anonymousCovesClient,
  feedErrorResponse,
  serveRssFeed,
} from '$lib/server/rss/respond'
import type { DID, Handle } from '$lib/types/atproto'
import type { RequestHandler } from './$types'

/**
 * The user's posts as RSS, or with `?type=comments` the user's comments on
 * posts that still exist.
 */
export const GET: RequestHandler = (event) => {
  const type = event.url.searchParams.get('type')
  if (type !== null && type !== 'posts' && type !== 'comments') {
    return feedErrorResponse(400, 'Unknown feed type')
  }

  return serveRssFeed(async () => {
    const api = anonymousCovesClient(event)
    // The `actor` matcher admits only a DID or a handle.
    const actor = event.params.handle as DID | Handle
    const origin = event.url.origin

    // The backend answers a missing user with 404 ProfileNotFound from
    // getProfile and 404 ActorNotFound from getActorPosts and
    // getActorComments, and whichever settles first decides Promise.all, so
    // each request maps its own not-found error to a missing user. Any other
    // 404 (a misrouted or unimplemented endpoint) propagates, since the user
    // may well exist.
    const actorRequest = <T>(
      request: Promise<T>,
      notFoundError: 'ProfileNotFound' | 'ActorNotFound',
    ): Promise<T> =>
      request.catch((err: unknown) => {
        if (
          err instanceof XrpcError &&
          err.status === 404 &&
          err.errorName === notFoundError
        ) {
          throw new FeedSourceNotFoundError({ cause: err })
        }
        throw err
      })
    const profileRequest = actorRequest(
      api.getProfile({ actor }),
      'ProfileNotFound',
    )

    const loadItems = async (): Promise<RssItem[]> => {
      if (type !== 'comments') {
        const { feed = [] } = await actorRequest(
          api.getActorPosts({ actor, limit: RSS_ITEM_LIMIT }),
          'ActorNotFound',
        )
        return feed.map(({ post }) => postToRssItem(post, origin))
      }
      const { comments = [] } = await actorRequest(
        api.getActorComments({ actor, limit: RSS_ITEM_LIMIT }),
        'ActorNotFound',
      )
      const uris = [...new Set(comments.map((comment) => comment.post.uri))]
      // getPosts takes 1–25 URIs, so a user without comments skips it.
      if (uris.length === 0) return []
      const { posts } = await api.getPosts({ uris })
      const hydrated = posts.filter(isHydratedPost)
      const hydratedUris = new Set(hydrated.map((post) => post.uri))
      const dropped = comments.filter(
        (comment) => !hydratedUris.has(comment.post.uri),
      ).length
      if (dropped > 0) {
        // LogContext carries only request fields, so the counts go in the message.
        log.warn(
          `[rss] comments dropped: parent post not hydrated (${dropped} of ${comments.length})`,
        )
      }
      return commentsToRssItems(comments, hydrated, origin)
    }

    const [profile, items] = await Promise.all([profileRequest, loadItems()])

    const name = profile.displayName || profile.handle || profile.did
    const title =
      type === 'comments' ? `Comments by ${name}` : `Posts by ${name}`
    return {
      channel: {
        title,
        link: userLink(profile, origin),
        description: profile.description || title,
        selfUrl: event.url.href,
      },
      items,
    }
  })
}
