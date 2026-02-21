import { coves } from '$lib/api/client.svelte'
import type { AtUri, PostView as CovesPostView } from '$lib/api/coves/types'
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

const POST_COLLECTION = 'social.coves.community.post'

/**
 * Constructs an AT-URI for a post from the community handle and record key.
 * Used as a fallback when navigating directly to a post URL without a cache hit.
 * The handle-based AT-URI is resolved by the backend to the canonical DID-based form.
 */
function buildPostAtUri(communityHandle: string, rkey: string): AtUri {
  return `at://${communityHandle}/${POST_COLLECTION}/${rkey}` as AtUri
}

/**
 * Searches the feed cache for a post matching the given rkey.
 * This provides instant display when the user navigated from a feed page.
 */
function findInFeed(
  id: '/' | '/c/[handle]',
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
  const legacySort =
    url.searchParams.get('sort') ?? settings?.defaultSort?.comments ?? 'Hot'
  const { sort } = mapSort(legacySort)
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
    findInFeed('/', params.rkey) ?? findInFeed('/c/[handle]', params.rkey)

  const feedData = feed(route.id, async (p) => {
    // If we have a preloaded post from cache, use it. Otherwise fetch from API.
    const post: CovesPostView =
      p.preload ??
      (await coves({ func: fetch }).getPost({ uri: p.postUri as AtUri }))

    // Fetch comments in parallel (returned as a promise for streaming)
    const commentsPromise = coves({ func: fetch })
      .getComments(p.comments)
      .then((r) => r.comments)

    return {
      post,
      comments: commentsPromise,
      params: p,
    }
  })

  // Build the post URI. If we have a cache hit, use the real URI.
  // Otherwise, construct a handle-based AT-URI from route params that the
  // backend can resolve to the canonical DID-based form.
  const postUri =
    cachedPost?.uri ?? buildPostAtUri(communityHandle, params.rkey)

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

  return {
    data: loaded,
    communityHandle,
    slots: {
      sidebar: {
        component: CommunityCard,
        props: {
          community: loaded.value?.post?.community,
        },
      },
    },
  }
}
