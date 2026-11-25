import type { CommentView, LikedComment } from '$lib/api/coves/types'
import {
  normalizeCommentView,
  type CommentNodeI,
  type NormalizedCommentView,
} from '$lib/feature/comment/comments.svelte'

/**
 * The comment as a thread comment reads it. A live comment with its record
 * passes through unchanged, so a vote cast on the row writes to the page's
 * state. A deleted comment always gets the placeholder record: its retained
 * body, facets and images are never shown.
 */
function threadComment(comment: CommentView): NormalizedCommentView {
  if (comment.isDeleted) {
    return normalizeCommentView({ ...comment, record: null })
  }
  return comment.record
    ? (comment as NormalizedCommentView)
    : normalizeCommentView(comment)
}

/**
 * A liked comment's row as a reactive thread node. The comment reads through
 * to the liked item, so writes to it land on the page's state; replies
 * created on the row collect in `children`.
 */
export class LikedCommentNode implements CommentNodeI {
  readonly #item: () => LikedComment
  readonly #comment = $derived.by(() => threadComment(this.#item().comment))
  children = $state<CommentNodeI[]>([])
  expanded = $state(true)
  loading = $state(false)
  readonly depth = 1

  constructor(item: () => LikedComment) {
    this.#item = item
  }

  get comment(): NormalizedCommentView {
    return this.#comment
  }

  set comment(value: NormalizedCommentView) {
    this.#item().comment = value
  }
}
