import { error } from '@sveltejs/kit'
import { coves } from '$lib/api/client.svelte'
import { type AtUri, isHydratedPost, parseAtUri } from '$lib/api/coves/types'
import { XrpcError } from '$lib/api/coves/xrpc'
import type { Handle } from '$lib/types/atproto'
import { settings } from '$lib/app/settings.svelte'
import { mapSort } from '$lib/app/sort'
import { communityHandleFromSlug, ReactiveState } from '$lib/app/util.svelte'
import { MAX_INLINE_DEPTH } from '$lib/feature/comment/comments.svelte'
import CommunityCard from '$lib/feature/community/CommunityCard.svelte'
import { feed } from '$lib/feature/feeds/feed.svelte'
import { buildPostAtUri } from '$lib/feature/post/helpers'

/**
 * Depth of descendants fetched below the focused comment. The focused comment
 * renders at depth 0 and CommentTree routes nodes deeper than
 * MAX_INLINE_DEPTH to their own permalink pages, so this fills the inline
 * capacity plus the row that shows the "continue this thread" link.
 */
const SUBTREE_DEPTH = MAX_INLINE_DEPTH + 1

export async function load({ params, url, fetch, route }) {
  const communityHandle = communityHandleFromSlug(params.handle)
  const commentSort =
    url.searchParams.get('sort') ?? settings?.defaultSort?.comments ?? 'hot'
  const { sort } = mapSort(commentSort)

  const feedData = feed(route.id, async (p) => {
    const client = coves({ func: fetch })

    // Fetch the post and the focused comment's subtree in parallel. Unlike the
    // post page (which streams comments), the subtree is awaited here: the
    // focused comment IS the page's content, and an unknown rkey must surface
    // as a routable 404 — which is impossible after load has already returned
    // a streamed promise.
    const [postResult, subtree] = await Promise.all([
      client.getPost(p.postUri as AtUri),
      client.getComments(p.comments).catch((err: unknown) => {
        if (err instanceof XrpcError && err.errorName === 'ParentNotFound') {
          error(404, 'couldnt_find_comment')
        }
        throw err
      }),
    ])

    // Both unavailable sentinels (deleted/unindexed and blocked-author) 404
    // here: unlike the post page there is no partial page worth rendering
    // when the post itself cannot be shown on a single comment's thread.
    if (!isHydratedPost(postResult)) {
      error(404, 'couldnt_find_post')
    }

    // Contract: with `parentRkey` set, `comments` contains exactly one
    // top-level ThreadViewComment — the focused comment. An empty array means
    // it vanished between requests (or an indexing race); treat it as gone.
    const root = subtree.comments[0]
    if (!root) {
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
      params: p,
    }
  })

  // Prefer the DID-based `?uri=` override (rename-stable, no extra hop);
  // otherwise resolve the community handle → DID once and build the URI.
  let postUri = url.searchParams.get('uri') as AtUri | null
  if (!postUri) {
    const community = await coves({ func: fetch })
      .getCommunity({ community: communityHandle as Handle })
      .catch((err: unknown) => {
        // An unknown community slug (typo'd/stale pasted permalink) comes back
        // from the backend as HTTP 404 with error name "NotFound"
        // (internal/api/handlers/community/errors.go). Surface it as a
        // routable 404 rather than an unhandled rejection.
        if (
          err instanceof XrpcError &&
          err.status === 404 &&
          err.errorName === 'NotFound'
        ) {
          error(404, 'couldnt_find_community')
        }
        throw err
      })
    postUri = buildPostAtUri(community.did, params.rkey)
  }

  const loaded = new ReactiveState(
    await feedData.load({
      postUri: postUri as string,
      comments: {
        post: postUri,
        parentRkey: params.crkey,
        sort,
        depth: SUBTREE_DEPTH,
        limit: 50,
      },
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
