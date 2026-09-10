import { error } from '@sveltejs/kit'
import { coves } from '$lib/api/client.svelte'
import {
  type AtUri,
  type GetCommentsParams,
  isHydratedPost,
  parseAtUri,
} from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'
import { settings } from '$lib/app/state/settings.svelte'
import { mapSort } from '$lib/api/coves/sort'
import { ReactiveState } from '$lib/app/util/reactive.svelte'
import { MAX_INLINE_DEPTH } from '$lib/feature/comment/comments.svelte'
import CommunityCard from '$lib/feature/community/CommunityCard.svelte'
import { feed } from '$lib/feature/feeds/feed.svelte'
import { buildPostAtUri } from '$lib/feature/post/helpers'
import {
  addressesRecord,
  fetchExactPost,
  fetchPostByOwner,
  isNotFoundError,
  resolveOwnerDid,
} from '$lib/feature/post/owner'

/**
 * Depth of descendants fetched below the focused comment. The focused comment
 * renders at depth 0 and CommentTree routes nodes deeper than
 * MAX_INLINE_DEPTH to their own permalink pages, so this fills the inline
 * capacity plus the row that shows the "continue this thread" link.
 */
const SUBTREE_DEPTH = MAX_INLINE_DEPTH + 1

export async function load({ params, url, fetch, route }) {
  const communityHandle = params.handle
  const client = coves({ func: fetch })
  const commentSort =
    url.searchParams.get('sort') ?? settings?.defaultSort?.comments ?? 'hot'
  const { sort } = mapSort(commentSort)

  // The two actor segments name the repos the post and the comment records
  // live in. A DID answers itself; a handle costs one lookup, and the two
  // lookups have nothing to say to each other, so they go out together.
  const [ownerDid, commenterDid] = await Promise.all([
    resolveOwnerDid(client, params.owner).catch((err: unknown) => {
      // An owner nobody can resolve means the post this URL names cannot
      // exist. Anything else (an outage, a bad request) is a real failure.
      if (isNotFoundError(err)) {
        error(404, 'couldnt_find_post')
      }
      throw err
    }),
    resolveOwnerDid(client, params.commenter).catch((err: unknown) => {
      if (isNotFoundError(err)) {
        error(404, 'couldnt_find_comment')
      }
      throw err
    }),
  ])

  // A `?uri=` that addresses this record names its collection outright and
  // needs a single fetch; otherwise one batch call probes the current and
  // legacy collections in the owner's repo.
  const explicitUri = url.searchParams.get('uri')
  const uriParam = addressesRecord(explicitUri, ownerDid, params.rkey)
    ? (explicitUri as AtUri)
    : null

  const commentParams = (post: AtUri): GetCommentsParams => ({
    post,
    parentRkey: params.crkey,
    sort,
    depth: SUBTREE_DEPTH,
    limit: 50,
  })

  // Every request lives inside this callback: the feed cache serves a
  // repeated identical load straight from `#data`, and anything fetched
  // outside would go out again on each of those navigations.
  const feedData = feed(route.id, async (p) => {
    const expectedUri = p.postUri as AtUri

    // Ask for the post and its subtree at the same time. The subtree request
    // has to name a post URI before the probe has answered, so it goes out
    // against the one the post is overwhelmingly likely to live at: the
    // `?uri=` when there is a trusted one, else the current collection.
    // Waiting for the probe instead would cost every thread page a round trip.
    const postPromise = uriParam
      ? fetchExactPost(client, uriParam).then((result) => ({
          uri: uriParam,
          result,
        }))
      : fetchPostByOwner(client, ownerDid, params.rkey)
    const speculativeSubtree = client.getComments(p.comments)
    // The guess is abandoned when the post is unavailable or lives in the
    // other collection. Claim its rejection now so an abandoned failure
    // cannot escape as an unhandled rejection.
    void speculativeSubtree.catch(() => undefined)

    const { uri: postUri, result: postResult } = await postPromise

    // Both unavailable sentinels (deleted/unindexed and blocked-author) 404
    // here: unlike the post page there is no partial page worth rendering
    // when the post itself cannot be shown on a single comment's thread.
    if (!isHydratedPost(postResult)) {
      error(404, 'couldnt_find_post')
    }

    // The guess only stands if the post hydrated where it predicted; a legacy
    // fallback has to be asked again, since a subtree is keyed by post URI.
    const comments = commentParams(postUri)
    const subtreePromise =
      postUri === expectedUri
        ? speculativeSubtree
        : client.getComments(comments)

    // Unlike the post page (which streams comments), the subtree is awaited
    // here: the focused comment IS the page's content, and an unknown rkey
    // must surface as a routable 404 — which is impossible after load has
    // already returned a streamed promise.
    const subtree = await subtreePromise.catch((err: unknown) => {
      if (err instanceof XrpcError && err.errorName === 'ParentNotFound') {
        error(404, 'couldnt_find_comment')
      }
      throw err
    })

    // Contract: with `parentRkey` set, `comments` contains exactly one
    // top-level ThreadViewComment — the focused comment. An empty array means
    // it vanished between requests (or an indexing race); treat it as gone.
    const root = subtree.comments[0]
    if (!root) {
      error(404, 'couldnt_find_comment')
    }

    // crkeys are TIDs: unique within a repo, not across repos. Without this
    // the commenter segment would be decoration, and any commenter would
    // address any comment on the post.
    if (parseAtUri(root.comment.uri).did !== commenterDid) {
      error(404, 'couldnt_find_comment')
    }

    const parent = root.comment.parent
    return {
      post: postResult,
      // Already resolved, but kept as a promise so the page shares the post
      // page's {#await}/reload shape.
      comments: Promise.resolve(subtree.comments),
      focused: {
        uri: root.comment.uri,
        rkey: parseAtUri(root.comment.uri).rkey,
        // Only a comment parent yields a "show context" hop — a parent ref
        // pointing at the post itself means the focused comment is top-level.
        parentUri:
          parent && parent.uri !== root.comment.post.uri
            ? parent.uri
            : undefined,
      },
      params: { postUri, comments },
    }
  })

  // Where the post is expected to live, and the cache key for this load.
  const expectedUri = uriParam ?? buildPostAtUri(ownerDid, params.rkey)

  const loaded = new ReactiveState(
    await feedData.load({
      postUri: expectedUri as string,
      comments: commentParams(expectedUri),
    }),
  )

  return {
    data: loaded,
    communityHandle,
    slots: {
      sidebar: {
        component: CommunityCard,
        props: { community: loaded.value.post.community },
      },
    },
  }
}
