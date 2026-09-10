import { error } from '@sveltejs/kit'
import { coves } from '$lib/api/client.svelte'
import {
  type AtUri,
  type PostView as CovesPostView,
  type GetCommentsParams,
  type PostViewUnion,
  isHydratedPost,
} from '$lib/api/coves/types'
import type { DID } from '$lib/types/atproto'
import { settings } from '$lib/app/state/settings.svelte'
import { mapSort } from '$lib/api/coves/sort'
import { ReactiveState } from '$lib/app/util/reactive.svelte'
import { log } from '$lib/app/util/log'
import CommunityCard from '$lib/feature/community/CommunityCard.svelte'
import {
  type Feed,
  feed,
  feeds,
  type FeedTypes,
} from '$lib/feature/feeds/feed.svelte'
import { takeFreshPost } from '$lib/feature/post/fresh-post'
import { buildPostAtUri } from '$lib/feature/post/helpers'
import {
  addressesRecord,
  fetchExactPost,
  fetchPostByOwner,
  isNotFoundError,
  resolveOwnerDid,
} from '$lib/feature/post/owner'

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
  const communityHandle = params.handle
  const client = coves({ func: fetch })
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

  // The owner segment names the repo the post record lives in. A DID answers
  // itself; a handle costs one lookup, and an unresolvable one means the post
  // this URL names cannot exist.
  let ownerDid: DID
  try {
    ownerDid = await resolveOwnerDid(client, params.owner)
  } catch (err) {
    // An owner nobody can resolve means the post this URL names cannot exist.
    if (isNotFoundError(err)) {
      error(404, 'couldnt_find_post')
    }
    throw err
  }

  // Instant display sources, best first: the optimistic view handed off by
  // the create flow (the AppView may not have indexed the record yet), then
  // the feed caches when the user navigated from a feed page. Each is kept
  // only if it actually addresses this URL's record.
  const stashed = takeFreshPost(params.rkey)
  const freshPost = addressesRecord(stashed?.uri, ownerDid, params.rkey)
    ? stashed
    : undefined
  const cachedPost =
    freshPost ??
    [
      findInFeed('/', params.rkey),
      findInFeed('/c/[handle=handle]', params.rkey),
    ].find((candidate) =>
      addressesRecord(candidate?.uri, ownerDid, params.rkey),
    )

  // The `?uri=` param names a record's collection outright, so a trusted one
  // is fetched as-is instead of probed.
  const explicitUri = url.searchParams.get('uri')
  const uriParam = addressesRecord(explicitUri, ownerDid, params.rkey)
    ? (explicitUri as AtUri)
    : null

  const commentParams = (post: AtUri): GetCommentsParams => ({
    post,
    sort,
    depth: maxDepth,
    limit: 50,
  })

  // Every request lives inside this callback: the feed cache serves a
  // repeated identical load straight from `#data`, and anything fetched
  // outside would go out again on each of those navigations.
  const feedData = feed(route.id, async (p) => {
    // `p.postUri` is where the record is expected to live. An instant-display
    // candidate already knows; otherwise the probe may answer from the legacy
    // collection instead, and `postUri` then tracks whichever URI hydrated.
    let postUri = p.postUri as AtUri
    let result: PostViewUnion | undefined = p.preload

    if (!result) {
      if (uriParam) {
        result = await fetchExactPost(client, uriParam)
      } else {
        const probe = await fetchPostByOwner(client, ownerDid, params.rkey)
        postUri = probe.uri
        result = probe.result
      }
    }

    // A brand-new post can beat the AppView indexer here — the create flow
    // redirects immediately after the record is written. When the navigation
    // carries the fresh-post signal (`?uri=`), poll briefly instead of
    // declaring the post unavailable. The retry re-probes both collections
    // rather than only the URI the create flow guessed.
    if (!isHydratedPost(result) && p.retryUnavailable) {
      for (let attempt = 0; attempt < 6 && !isHydratedPost(result); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        const probe = await fetchPostByOwner(client, ownerDid, params.rkey)
        postUri = probe.uri
        result = probe.result
      }
    }

    // The batch endpoint returns a union: a hydrated post, or an unavailable
    // sentinel (deleted/unindexed/unresolvable/blocked). Surface the latter as
    // an "unavailable" state instead of throwing into the error page. We log
    // which discriminator fired so that a wrongly resolved owner or rkey, or
    // indexing lag, is discoverable rather than silently rendering as "this
    // post was removed".
    if (!isHydratedPost(result)) {
      const reason: 'notFound' | 'blocked' =
        result != null && 'blocked' in result ? 'blocked' : 'notFound'
      log.warn(`[post-loader] Post unavailable (${reason}) for ${postUri}`)
      return {
        unavailable: reason,
        comments: Promise.resolve([]),
        params: p,
      }
    }

    // Fetch comments in parallel (returned as a promise for streaming). A
    // just-created post definitionally has none — and asking before the
    // AppView indexes the post 404s into "Failed to load comments" — so skip
    // straight to the empty state.
    // Comments are keyed by the URI that actually hydrated, which the legacy
    // fallback and the retry above can both change.
    const comments = commentParams(postUri)
    const commentsPromise = p.freshPost
      ? Promise.resolve([])
      : client.getComments(comments).then((r) => r.comments)

    return {
      post: result,
      comments: commentsPromise,
      params: { ...p, postUri, comments },
    }
  })

  // Where the record is expected to live, and the cache key for this load: an
  // instant-display candidate carries its own URI, a trusted `?uri=` names
  // one, and otherwise it is the current collection in the owner's repo.
  const expectedUri =
    (cachedPost?.uri as AtUri | undefined) ??
    uriParam ??
    buildPostAtUri(ownerDid, params.rkey)

  const loaded = new ReactiveState(
    await feedData.load({
      postUri: expectedUri as string,
      comments: commentParams(expectedUri),
      preload: cachedPost,
      freshPost: !!freshPost,
      retryUnavailable: uriParam !== null,
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
