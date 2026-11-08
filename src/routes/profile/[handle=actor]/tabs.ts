import type { CommentView, PostView } from '$lib/api/coves/types'
import { commentLink } from '$lib/feature/post/helpers'

export type ProfileTab = 'posts' | 'comments'

/**
 * The profile tab a `?type=` value opens. Anything but `comments` opens
 * posts, including `all`, the retired mixed view old links still carry.
 */
export function profileTab(type: string | null): ProfileTab {
  return type === 'comments' ? 'comments' : 'posts'
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
