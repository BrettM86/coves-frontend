import type {
  AtUri,
  CID,
  CommentRecord,
  CommentView,
  StrongRef,
  ThreadViewComment,
} from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import { t } from '$lib/app/i18n'

/**
 * A CommentView whose record is guaranteed non-null. `buildCommentsTree`
 * normalizes server tombstones (null records) into synthesized placeholder
 * records, so everything downstream of the tree can read `record.*`
 * unconditionally.
 */
export type NormalizedCommentView = CommentView & { record: CommentRecord }

export interface CommentNodeI {
  comment: NormalizedCommentView
  children: Array<CommentNodeI>
  depth: number
  loading?: boolean
  expanded?: boolean
}

/**
 * The placeholder content rendered for deleted comments. Centralized so
 * pre-reload (in-place mutation) and post-reload (tree normalization)
 * rendering cannot drift.
 */
export function deletedContentPlaceholder(): string {
  return `*${t.get('post.badges.deleted')}*`
}

/**
 * Converts a server-provided comment tree (ThreadViewComment[]) into
 * the flat-depth CommentNodeI[] structure used by the UI.
 *
 * The server already computes the tree hierarchy via `replies`, so we
 * walk the tree recursively, assigning depth as we go.
 */
export function buildCommentsTree(
  threadComments: ThreadViewComment[],
  baseDepth: number = 0,
): CommentNodeI[] {
  function walk(thread: ThreadViewComment, depth: number): CommentNodeI {
    const cv = thread.comment

    // Annotate deleted comments with a placeholder message. The server
    // returns tombstones with a null record, so synthesize a complete
    // record — downstream components read record.* unconditionally.
    // `== null` (not `=== null`) is deliberate: it also guards against an
    // undefined record at runtime, which the type does not rule out.
    const record = cv.record
    let normalized: NormalizedCommentView
    if (record == null || (cv.isDeleted && record.content === '')) {
      if (record == null && !cv.isDeleted) {
        console.warn(
          `[comments] Comment ${cv.uri as string} has no record but is not marked deleted (backend data-integrity issue?); rendering as deleted.`,
        )
      }
      normalized = {
        ...cv,
        record: {
          // Preserve optional fields (facets, langs, embed, labels) from
          // non-null deleted records, then override the required fields.
          ...record,
          $type: 'social.coves.community.comment',
          content: deletedContentPlaceholder(),
          reply: record?.reply ?? {
            root: cv.post,
            parent: cv.parent ?? cv.post,
          },
          createdAt: record?.createdAt ?? cv.createdAt,
        },
      }
    } else {
      normalized = { ...cv, record }
    }

    const children: CommentNodeI[] = (thread.replies ?? []).map((reply) =>
      walk(reply, depth + 1),
    )

    return {
      comment: normalized,
      children,
      depth,
      expanded: true,
    }
  }

  return threadComments.map((thread) => walk(thread, baseDepth))
}

/**
 * Searches a CommentNodeI tree for a node matching the given AT-URI.
 * Returns the first match (depth-first), or undefined if not found.
 */
export function searchCommentTree(
  tree: CommentNodeI[],
  uri: AtUri,
): CommentNodeI | undefined {
  for (const node of tree) {
    if (node.comment.uri === uri) {
      return node
    }

    const found = searchCommentTree(node.children, uri)
    if (found) {
      return found
    }
  }
  return undefined
}

/**
 * Inserts a newly created CommentView into the tree at the correct
 * position. If the comment has a parent comment, it is prepended to the
 * parent's children. If it is a top-level comment (no parent, or a
 * parent ref pointing at the post itself) and `parentComment` is false,
 * it is prepended to the root of the tree.
 */
export function insertCommentIntoTree(
  tree: CommentNodeI[],
  cv: NormalizedCommentView,
  parentComment: boolean,
): boolean {
  const node: CommentNodeI = {
    comment: cv,
    children: [],
    depth: 0,
    expanded: true,
  }

  if (cv.parent && cv.parent.uri !== cv.post.uri) {
    const parentNode = searchCommentTree(tree, cv.parent.uri)
    if (parentNode) {
      node.depth = parentNode.depth + 1
      parentNode.children.unshift(node)
      return true
    } else {
      console.warn(
        `[comments] Parent node not found in tree for comment ${cv.uri as string}, parent: ${cv.parent.uri as string}. Comment was dropped.`,
      )
      return false
    }
  } else if (!parentComment) {
    tree.unshift(node)
    return true
  }
  return false
}

/**
 * Creates a CommentView for a newly posted comment, suitable for
 * optimistic insertion into the UI tree before server confirmation.
 */
export function createOptimisticCommentView(
  output: { uri: AtUri; cid: CID },
  content: string,
  postRef: StrongRef,
  parentRef: StrongRef,
  author: { did: string; handle: string; avatar?: string },
): NormalizedCommentView {
  const now = new Date().toISOString()
  return {
    uri: output.uri,
    cid: output.cid,
    createdAt: now,
    indexedAt: now,
    record: {
      $type: 'social.coves.community.comment',
      content,
      reply: {
        root: postRef,
        parent: parentRef,
      },
      createdAt: now,
    },
    author: {
      did: author.did as DID,
      handle: author.handle as Handle,
      avatar: author.avatar,
    },
    post: postRef,
    stats: {
      upvotes: 0,
      downvotes: 0,
      score: 0,
      replyCount: 0,
    },
    viewer: undefined,
    parent: parentRef,
  }
}
