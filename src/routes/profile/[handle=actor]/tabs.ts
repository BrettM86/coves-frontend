import type { CommentView, LikesFilter, PostView } from '$lib/api/coves/types'
import { commentLink } from '$lib/feature/post/helpers'

export type ProfileTab = 'posts' | 'comments' | 'likes'

/**
 * The profile tab a `?type=` value opens. Anything but `comments` or `likes`
 * opens posts, including `all`, the retired mixed view old links still carry.
 */
export function profileTab(type: string | null): ProfileTab {
  return type === 'comments' || type === 'likes' ? type : 'posts'
}

export type { LikesFilter }

/** The Likes filter a `?likes=` value selects. Anything unrecognised is All. */
export function likesFilter(value: string | null): LikesFilter {
  return value === 'posts' || value === 'comments' ? value : 'all'
}

/**
 * Where a profile comment leads: its permalink under the parent post. A parent
 * that getPosts could not hydrate has no community to route through, so the
 * comment gets no link.
 */
export function profileCommentHref(
  comment: CommentView,
  parent: PostView | undefined,
): string | undefined {
  if (!parent) return undefined
  return commentLink(parent, comment.uri, comment.author)
}
