import { coves } from '$lib/api/client.svelte'
import {
  type AtUri,
  type PostView as CovesPostView,
  isHydratedPost,
} from '$lib/api/coves/types'
import type { Handle } from '$lib/types/atproto'
import { settings } from '$lib/app/settings.svelte'
import { mapSort } from '$lib/app/sort'
import { communityHandleFromSlug, ReactiveState } from '$lib/app/util.svelte'
import CommunityCard from '$lib/feature/community/CommunityCard.svelte'
import {
  type Feed,
  feed,
  feeds,
  type FeedTypes,
} from '$lib/feature/feeds/feed.svelte'
import { buildPostAtUri } from '$lib/feature/post/helpers'

/**
 * Searches the feed cache for a post matching the given rkey.
 * This provides instant display when the user navigated from a feed page.
 */
function findInFeed(
  id: '/' | '/c/[handle=handle]',
  rkey: string,
): CovesPostView | undefined {
  const cached = (
    feeds.get(id) as Feed<FeedTypes[typeof id][0], FeedTypes[typeof id][1]>
  )?.peek()
  if (!cached) return undefined
  // The feed response has a `feed` array of FeedViewPost items
  const found = (cached as { feed?: { post: CovesPostView }[] })?.feed?.find(
    (fp) => fp.post.rkey === rkey,
  )
  return found?.post
}

export async function load({ params, url, fetch, route }) {
  const communityHandle = communityHandleFromSlug(params.handle)
  const commentSort =
    url.searchParams.get('sort') ?? settings?.defaultSort?.comments ?? 'hot'
  const { sort } = mapSort(commentSort)
  const thread = url.searchParams.get('thread')

  // Parse thread context for comment navigation
  let showContext = false
  let singleThread = false
  let focus: string | undefined
  let maxDepth = 3
  if (thread) {
    const parts = thread.split('.')
    if (parts[0] === '0') {
      singleThread = true
      focus = parts[1]
    } else {
      showContext = true
      maxDepth = 5
      focus = parts.at(-1)
      singleThread = true
    }
  }

  // Try feed cache for instant display
  const cachedPost =
    findInFeed('/', params.rkey) ??
    findInFeed('/c/[handle=handle]', params.rkey)

  const feedData = feed(route.id, async (p) => {
    // If we have a preloaded post from cache, use it. Otherwise fetch from API.
    const result =
      p.preload ?? (await coves({ func: fetch }).getPost(p.postUri as AtUri))

    // The batch endpoint returns a union: a hydrated post, or an unavailable
    // sentinel (deleted/unindexed/unresolvable/blocked). Surface the latter as
    // an "unavailable" state instead of throwing into the error page. We log
    // which discriminator fired so that a real bug in buildPostAtUri (wrong
    // DID/rkey) or indexing lag is discoverable rather than silently rendering
    // as "this post was removed".
    if (!isHydratedPost(result)) {
      const reason: 'notFound' | 'blocked' =
        result != null && 'blocked' in result ? 'blocked' : 'notFound'
      console.warn(
        `[post-loader] Post unavailable (${reason}) for ${p.postUri}`,
      )
      return {
        unavailable: reason,
        comments: Promise.resolve([]),
        params: p,
      }
    }

    // Fetch comments in parallel (returned as a promise for streaming)
    const commentsPromise = coves({ func: fetch })
      .getComments(p.comments)
      .then((r) => r.comments)

    return {
      post: result,
      comments: commentsPromise,
      params: p,
    }
  })

  // Build the canonical DID-based post URI. Prefer sources that are already
  // DID-based and rename-stable: the explicit `?uri=` param (set on post
  // creation) and the feed-cache hit (the backend emits DID-based URIs).
  // Otherwise resolve the community handle → DID once and build it ourselves.
  let postUri = (url.searchParams.get('uri') as AtUri | null) ?? cachedPost?.uri
  if (!postUri) {
    const community = await coves({ func: fetch }).getCommunity({
      community: communityHandle as Handle,
    })
    postUri = buildPostAtUri(community.did, params.rkey)
  }

  const loaded = new ReactiveState(
    await feedData.load({
      postUri: postUri as string,
      comments: {
        post: postUri,
        sort,
        depth: maxDepth,
        limit: 50,
      },
      preload: cachedPost,
      thread: { showContext, singleThread, focus },
    }),
  )

  // The community ref rides along on the post. When the post is unavailable
  // there's nothing to populate the card with, so fall back to the default
  // sidebar (omitting the slot) rather than rendering a broken CommunityCard.
  const community = loaded.value?.post?.community

  return {
    data: loaded,
    communityHandle,
    slots: community
      ? {
          sidebar: {
            component: CommunityCard,
            props: { community },
          },
        }
      : undefined,
  }
}
