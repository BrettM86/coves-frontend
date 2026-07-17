import {
  type CreatePostOutput,
  type PostView,
  parseAtUri,
} from '$lib/api/coves/types'
import { profile } from '$lib/app/auth.svelte'
import type { DID, Handle } from '$lib/types/atproto'

/**
 * One-shot hand-off of a just-created post from the create flow to the post
 * page. The AppView indexer can lag behind the record write, so the post page
 * would otherwise show "Post unavailable" (or wait on its retry poll) for a
 * post the client already knows everything about.
 */
let fresh: PostView | undefined

/** Stash the optimistic view of a just-created post before navigating to it. */
export function stashFreshPost(post: PostView): void {
  fresh = post
}

/**
 * Take the stashed post if it matches `rkey`. Single-use: the stash is
 * cleared on a hit so later visits re-fetch real (indexed) data.
 */
export function takeFreshPost(rkey: string): PostView | undefined {
  if (fresh?.rkey !== rkey) return undefined
  const post = fresh
  fresh = undefined
  return post
}

/**
 * Assembles a PostView for a just-created post from the create output and the
 * form data. Stats start at zero — true for a brand-new post — and the next
 * real fetch replaces this view entirely. Returns undefined when the viewer
 * or community lacks the fields a PostView requires (e.g. no handle yet).
 */
export function buildFreshPostView(args: {
  output: CreatePostOutput
  community: { did: DID; handle?: Handle; name: string; avatar?: string }
  title?: string
  content?: string
  url?: string
}): PostView | undefined {
  const viewer = profile.current
  if (viewer.type !== 'authenticated') return undefined

  const { output, community } = args
  if (!community.handle) return undefined

  const createdAt = new Date().toISOString()

  return {
    uri: output.uri,
    cid: output.cid,
    rkey: parseAtUri(output.uri).rkey,
    indexedAt: createdAt,
    createdAt,
    author: {
      did: viewer.did,
      handle: viewer.handle,
      avatar: viewer.avatar,
    },
    community: {
      did: community.did,
      handle: community.handle,
      name: community.name,
      avatar: community.avatar,
    },
    record: {
      $type: 'social.coves.community.post',
      community: community.did,
      author: viewer.did,
      createdAt,
      title: args.title,
      content: args.content,
    },
    embed: args.url
      ? { $type: 'social.coves.embed.external', external: { uri: args.url } }
      : undefined,
    stats: { upvotes: 0, downvotes: 0, score: 0, commentCount: 0 },
    viewer: { saved: false },
  }
}
