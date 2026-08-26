import type {
  CommentStats,
  CommentViewerState,
  PostStats,
  PostViewerState,
} from '$lib/api/coves/types'

/**
 * Zero-valued bases for subjects that carry no stats/viewer yet — a freshly
 * created post or comment, or a view the server returned without them.
 * `castUpvote` spreads its counters over these so type-specific fields
 * (`commentCount`, `replyCount`, `saved`) survive the optimistic write.
 */
export const EMPTY_POST_STATS: PostStats = {
  upvotes: 0,
  downvotes: 0,
  score: 0,
  commentCount: 0,
}
export const EMPTY_POST_VIEWER: PostViewerState = { saved: false }

export const EMPTY_COMMENT_STATS: CommentStats = {
  upvotes: 0,
  downvotes: 0,
  score: 0,
  replyCount: 0,
}
export const EMPTY_COMMENT_VIEWER: CommentViewerState = {}
