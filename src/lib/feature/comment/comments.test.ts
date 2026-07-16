import { describe, it, expect, vi } from 'vitest'
import type {
  AtUri,
  CID,
  CommentRecord,
  CommentRef,
  CommentStats,
  CommentView,
  AuthorView,
  ThreadViewComment,
} from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import {
  MAX_INLINE_DEPTH,
  buildCommentsTree,
  buildSubtreeChildren,
  findTopLevelIndexByRkey,
  insertCommentIntoTree,
  searchCommentTree,
  subtreeFetchDepth,
  type CommentNodeI,
  type NormalizedCommentView,
} from './comments.svelte'

// ---------------------------------------------------------------------------
// Mock i18n
// ---------------------------------------------------------------------------

vi.mock('$lib/app/i18n', () => ({
  t: {
    get: (key: string) => key,
  },
}))

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const testDid = 'did:plc:testauthor1' as DID
const testHandle = 'alice.coves.social' as Handle

function makeAuthor(overrides?: Partial<AuthorView>): AuthorView {
  return {
    did: testDid,
    handle: testHandle,
    displayName: 'Alice',
    ...overrides,
  }
}

function makeCommentRecord(
  content: string = 'Test comment content',
): CommentRecord {
  return {
    $type: 'social.coves.community.comment',
    content,
    reply: {
      root: {
        uri: 'at://did:plc:post/social.coves.community.post/root1' as AtUri,
        cid: 'bafyroot1' as CID,
      },
      parent: {
        uri: 'at://did:plc:post/social.coves.community.post/root1' as AtUri,
        cid: 'bafyroot1' as CID,
      },
    },
    createdAt: '2024-06-01T12:00:00Z',
  }
}

function makeStats(overrides?: Partial<CommentStats>): CommentStats {
  return {
    upvotes: 5,
    downvotes: 1,
    score: 4,
    replyCount: 0,
    ...overrides,
  }
}

function makeCommentView(
  overrides?: Partial<NormalizedCommentView>,
): NormalizedCommentView {
  return {
    uri: 'at://did:plc:testauthor1/social.coves.community.comment/c1' as AtUri,
    cid: 'bafycomment1' as CID,
    createdAt: '2024-06-01T12:00:00Z',
    indexedAt: '2024-06-01T12:00:01Z',
    record: makeCommentRecord(),
    author: makeAuthor(),
    post: {
      uri: 'at://did:plc:post/social.coves.community.post/root1' as AtUri,
      cid: 'bafypost1' as CID,
    },
    stats: makeStats(),
    ...overrides,
  }
}

function makeThreadComment(
  cv: CommentView,
  replies?: ThreadViewComment[],
  hasMore?: boolean,
): ThreadViewComment {
  return {
    comment: cv,
    replies,
    hasMore,
  }
}

// ---------------------------------------------------------------------------
// buildCommentsTree()
// ---------------------------------------------------------------------------

describe('buildCommentsTree', () => {
  it('returns an empty array for empty input', () => {
    const result = buildCommentsTree([])
    expect(result).toEqual([])
  })

  it('converts a single ThreadViewComment into a single CommentNodeI', () => {
    const cv = makeCommentView()
    const thread = makeThreadComment(cv)

    const result = buildCommentsTree([thread])

    expect(result).toHaveLength(1)
    expect(result[0].comment.uri).toBe(cv.uri)
    expect(result[0].depth).toBe(0)
    expect(result[0].children).toEqual([])
    expect(result[0].expanded).toBe(true)
  })

  it('converts multiple top-level ThreadViewComments', () => {
    const cv1 = makeCommentView({
      uri: 'at://did:plc:testauthor1/social.coves.community.comment/c1' as AtUri,
    })
    const cv2 = makeCommentView({
      uri: 'at://did:plc:testauthor1/social.coves.community.comment/c2' as AtUri,
    })

    const result = buildCommentsTree([
      makeThreadComment(cv1),
      makeThreadComment(cv2),
    ])

    expect(result).toHaveLength(2)
    expect(result[0].comment.uri).toBe(cv1.uri)
    expect(result[1].comment.uri).toBe(cv2.uri)
    expect(result[0].depth).toBe(0)
    expect(result[1].depth).toBe(0)
  })

  it('recursively builds children with increasing depth', () => {
    const grandchild = makeCommentView({
      uri: 'at://did:plc:testauthor1/social.coves.community.comment/c3' as AtUri,
    })
    const child = makeCommentView({
      uri: 'at://did:plc:testauthor1/social.coves.community.comment/c2' as AtUri,
    })
    const root = makeCommentView({
      uri: 'at://did:plc:testauthor1/social.coves.community.comment/c1' as AtUri,
    })

    const thread = makeThreadComment(root, [
      makeThreadComment(child, [makeThreadComment(grandchild)]),
    ])

    const result = buildCommentsTree([thread])

    expect(result).toHaveLength(1)
    expect(result[0].depth).toBe(0)
    expect(result[0].children).toHaveLength(1)
    expect(result[0].children[0].depth).toBe(1)
    expect(result[0].children[0].children).toHaveLength(1)
    expect(result[0].children[0].children[0].depth).toBe(2)
    expect(result[0].children[0].children[0].comment.uri).toBe(grandchild.uri)
  })

  it('applies baseDepth offset to all nodes', () => {
    const child = makeCommentView({
      uri: 'at://did:plc:testauthor1/social.coves.community.comment/c2' as AtUri,
    })
    const root = makeCommentView({
      uri: 'at://did:plc:testauthor1/social.coves.community.comment/c1' as AtUri,
    })

    const thread = makeThreadComment(root, [makeThreadComment(child)])

    const result = buildCommentsTree([thread], 3)

    expect(result[0].depth).toBe(3)
    expect(result[0].children[0].depth).toBe(4)
  })

  it('annotates deleted comments with empty content', () => {
    const cv = makeCommentView({
      isDeleted: true,
      record: makeCommentRecord(''),
    })
    const thread = makeThreadComment(cv)

    const result = buildCommentsTree([thread])

    expect(result[0].comment.record.content).toBe('*post.badges.deleted*')
  })

  it('synthesizes a record for tombstones with null records', () => {
    // The server returns deleted-comment tombstones with a null record
    const cv: CommentView = {
      ...makeCommentView(),
      isDeleted: true,
      record: null,
    }
    const reply = makeCommentView({
      uri: 'at://did:plc:testauthor1/social.coves.community.comment/c2' as AtUri,
    })
    const thread = makeThreadComment(cv, [makeThreadComment(reply)])

    const result = buildCommentsTree([thread])

    expect(result[0].comment.record).toEqual({
      $type: 'social.coves.community.comment',
      content: '*post.badges.deleted*',
      reply: {
        root: cv.post,
        parent: cv.post,
      },
      createdAt: cv.createdAt,
    })
    expect(result[0].children).toHaveLength(1)
    expect(result[0].children[0].comment.uri).toBe(reply.uri)
  })

  it('synthesizes a record for tombstones with undefined records', () => {
    // The server omits `record` entirely for tombstones (undefined at
    // runtime; older backends sent an explicit null)
    const cv: CommentView = {
      ...makeCommentView(),
      isDeleted: true,
      record: undefined,
    }
    const thread = makeThreadComment(cv)

    const result = buildCommentsTree([thread])

    expect(result[0].comment.record.content).toBe('*post.badges.deleted*')
    expect(result[0].comment.record.reply).toEqual({
      root: cv.post,
      parent: cv.post,
    })
    expect(result[0].comment.record.createdAt).toBe(cv.createdAt)
  })

  it('handles tombstones with author and record keys absent entirely', () => {
    // Current backend tombstone shape: both `author` and `record` are
    // omitted (keys absent, not null) to keep deleted-comment authors
    // anonymous. Everything else (uri, cid, post, stats, isDeleted,
    // timestamps) is present.
    const base = makeCommentView()
    const {
      author: _author,
      record: _record,
      ...rest
    } = { ...base, isDeleted: true as const }
    const cv: CommentView = rest
    const reply = makeCommentView({
      uri: 'at://did:plc:testauthor1/social.coves.community.comment/c2' as AtUri,
    })
    const thread = makeThreadComment(cv, [makeThreadComment(reply)])

    const result = buildCommentsTree([thread])

    expect(result[0].comment.author).toBeUndefined()
    expect(result[0].comment.isDeleted).toBe(true)
    expect(result[0].comment.record).toEqual({
      $type: 'social.coves.community.comment',
      content: '*post.badges.deleted*',
      reply: {
        root: cv.post,
        parent: cv.post,
      },
      createdAt: cv.createdAt,
    })
    expect(result[0].children).toHaveLength(1)
    expect(result[0].children[0].comment.uri).toBe(reply.uri)
    expect(result[0].children[0].comment.author).toEqual(makeAuthor())
  })

  it('warns when a non-deleted comment has a null record', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cv: CommentView = {
      ...makeCommentView(),
      isDeleted: false,
      record: null,
    }
    const thread = makeThreadComment(cv)

    const result = buildCommentsTree([thread])

    expect(result[0].comment.record.content).toBe('*post.badges.deleted*')
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toContain(cv.uri as string)
    warnSpy.mockRestore()
  })

  it('does not warn for null records on deleted comments', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cv: CommentView = {
      ...makeCommentView(),
      isDeleted: true,
      record: null,
    }

    buildCommentsTree([makeThreadComment(cv)])

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('preserves reply, createdAt, and optional fields when annotating deleted comments', () => {
    const record: CommentRecord = {
      ...makeCommentRecord(''),
      facets: [{ index: { byteStart: 0, byteEnd: 4 } }],
      langs: ['en'],
      embed: { $type: 'social.coves.embed.external' },
      labels: { $type: 'com.atproto.label.defs#selfLabels', values: [] },
    }
    const cv = makeCommentView({
      isDeleted: true,
      record,
    })
    const thread = makeThreadComment(cv)

    const result = buildCommentsTree([thread])

    expect(result[0].comment.record).toEqual({
      ...record,
      content: '*post.badges.deleted*',
    })
    expect(result[0].comment.record.reply).toEqual(record.reply)
    expect(result[0].comment.record.createdAt).toBe(record.createdAt)
  })

  it('does not annotate deleted comments that have content', () => {
    const cv = makeCommentView({
      isDeleted: true,
      record: makeCommentRecord('This comment was deleted but had content'),
    })
    const thread = makeThreadComment(cv)

    const result = buildCommentsTree([thread])

    expect(result[0].comment.record.content).toBe(
      'This comment was deleted but had content',
    )
  })

  it('does not annotate non-deleted comments with empty content', () => {
    const cv = makeCommentView({
      isDeleted: false,
      record: makeCommentRecord(''),
    })
    const thread = makeThreadComment(cv)

    const result = buildCommentsTree([thread])

    expect(result[0].comment.record.content).toBe('')
  })

  it('handles ThreadViewComments with undefined replies', () => {
    const cv = makeCommentView()
    const thread: ThreadViewComment = {
      comment: cv,
      // replies is undefined
    }

    const result = buildCommentsTree([thread])

    expect(result).toHaveLength(1)
    expect(result[0].children).toEqual([])
  })

  it('handles ThreadViewComments with empty replies', () => {
    const cv = makeCommentView()
    const thread = makeThreadComment(cv, [])

    const result = buildCommentsTree([thread])

    expect(result).toHaveLength(1)
    expect(result[0].children).toEqual([])
  })

  it('preserves hasMore on the source data without affecting CommentNodeI', () => {
    const cv = makeCommentView()
    const thread = makeThreadComment(cv, [], true)

    const result = buildCommentsTree([thread])

    expect(result).toHaveLength(1)
    // CommentNodeI does not carry hasMore; that comes from ThreadViewComment
    expect(result[0].children).toEqual([])
  })

  it('handles a complex tree with multiple branches', () => {
    const c1 = makeCommentView({
      uri: 'at://did:plc:a/social.coves.community.comment/c1' as AtUri,
    })
    const c1a = makeCommentView({
      uri: 'at://did:plc:a/social.coves.community.comment/c1a' as AtUri,
    })
    const c1b = makeCommentView({
      uri: 'at://did:plc:a/social.coves.community.comment/c1b' as AtUri,
    })
    const c2 = makeCommentView({
      uri: 'at://did:plc:a/social.coves.community.comment/c2' as AtUri,
    })
    const c2a = makeCommentView({
      uri: 'at://did:plc:a/social.coves.community.comment/c2a' as AtUri,
    })

    const threads: ThreadViewComment[] = [
      makeThreadComment(c1, [makeThreadComment(c1a), makeThreadComment(c1b)]),
      makeThreadComment(c2, [makeThreadComment(c2a)]),
    ]

    const result = buildCommentsTree(threads)

    expect(result).toHaveLength(2)
    expect(result[0].children).toHaveLength(2)
    expect(result[0].children[0].comment.uri).toBe(c1a.uri)
    expect(result[0].children[1].comment.uri).toBe(c1b.uri)
    expect(result[1].children).toHaveLength(1)
    expect(result[1].children[0].comment.uri).toBe(c2a.uri)
  })

  it('does not mutate the input ThreadViewComment data', () => {
    const cv = makeCommentView({
      isDeleted: true,
      record: makeCommentRecord(''),
    })
    const thread = makeThreadComment(cv)
    const originalContent = cv.record.content

    buildCommentsTree([thread])

    // The original input should not be mutated
    expect(cv.record.content).toBe(originalContent)
  })
})

// ---------------------------------------------------------------------------
// subtreeFetchDepth()
// ---------------------------------------------------------------------------

describe('subtreeFetchDepth', () => {
  it('pins the inline depth cutoff at 4', () => {
    // The permalink loader's SUBTREE_DEPTH and CommentTree's expand-vs-
    // permalink split both derive from this value; changing it is a
    // deliberate product decision, not a refactor.
    expect(MAX_INLINE_DEPTH).toBe(4)
  })

  // Pins the depth expression for every inline-expandable parent depth:
  // remaining inline capacity plus one level for the continue-thread row.
  it.each([
    [0, 5],
    [1, 4],
    [2, 3],
    [3, 2],
    [4, 1],
  ])('parent at depth %i requests a subtree of depth %i', (parent, depth) => {
    expect(subtreeFetchDepth(parent)).toBe(depth)
  })

  it('requests at least one level for every inline-expandable depth', () => {
    for (let depth = 0; depth <= MAX_INLINE_DEPTH; depth++) {
      expect(subtreeFetchDepth(depth)).toBeGreaterThanOrEqual(1)
    }
  })
})

// ---------------------------------------------------------------------------
// buildSubtreeChildren()
// ---------------------------------------------------------------------------

describe('buildSubtreeChildren', () => {
  const parentUri =
    'at://did:plc:a/social.coves.community.comment/parent1' as AtUri

  function makeParent(depth: number): CommentNodeI {
    return {
      comment: makeCommentView({
        uri: parentUri,
        stats: makeStats({ replyCount: 2 }),
      }),
      children: [],
      depth,
    }
  }

  /** A subtree response: the parent as sole root, with two direct replies,
   * the second of which has a nested reply. */
  function makeResponseComments(): ThreadViewComment[] {
    const reply1 = makeCommentView({
      uri: 'at://did:plc:a/social.coves.community.comment/r1' as AtUri,
    })
    const reply2 = makeCommentView({
      uri: 'at://did:plc:a/social.coves.community.comment/r2' as AtUri,
    })
    const nested = makeCommentView({
      uri: 'at://did:plc:a/social.coves.community.comment/r2a' as AtUri,
    })
    return [
      makeThreadComment(makeCommentView({ uri: parentUri }), [
        makeThreadComment(reply1),
        makeThreadComment(reply2, [makeThreadComment(nested)]),
      ]),
    ]
  }

  it('grafts direct replies at parent.depth + 1', () => {
    const parent = makeParent(2)

    const children = buildSubtreeChildren(makeResponseComments(), parent)

    expect(children).not.toBeNull()
    expect(children).toHaveLength(2)
    expect(children![0].depth).toBe(3)
    expect(children![1].depth).toBe(3)
    expect(children![1].children[0].depth).toBe(4)
  })

  it('grafts at depth 1 for a top-level parent', () => {
    const parent = makeParent(0)

    const children = buildSubtreeChildren(makeResponseComments(), parent)

    expect(children).not.toBeNull()
    expect(children![0].depth).toBe(1)
  })

  it('returns the parent replies, not the parent itself', () => {
    const parent = makeParent(1)

    const children = buildSubtreeChildren(makeResponseComments(), parent)

    expect(children).not.toBeNull()
    expect(children!.map((c) => c.comment.uri)).toEqual([
      'at://did:plc:a/social.coves.community.comment/r1',
      'at://did:plc:a/social.coves.community.comment/r2',
    ])
  })

  it('returns an empty array when the parent has no replies in the response', () => {
    const parent = makeParent(1)
    const response = [makeThreadComment(makeCommentView({ uri: parentUri }))]

    expect(buildSubtreeChildren(response, parent)).toEqual([])
  })

  it('returns null for an empty response (missing root)', () => {
    const parent = makeParent(1)

    expect(buildSubtreeChildren([], parent)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// findTopLevelIndexByRkey()
// ---------------------------------------------------------------------------

describe('findTopLevelIndexByRkey', () => {
  function makeNode(rkey: string, children: CommentNodeI[] = []): CommentNodeI {
    return {
      comment: makeCommentView({
        uri: `at://did:plc:a/social.coves.community.comment/${rkey}` as AtUri,
      }),
      children,
      depth: 0,
    }
  }

  it('finds a top-level node by its own rkey', () => {
    const tree = [makeNode('top1'), makeNode('top2')]
    expect(findTopLevelIndexByRkey(tree, 'top2')).toBe(1)
  })

  it('returns the containing top-level index for a nested match', () => {
    const tree = [
      makeNode('top1'),
      makeNode('top2', [makeNode('child', [makeNode('grandchild')])]),
    ]
    expect(findTopLevelIndexByRkey(tree, 'grandchild')).toBe(1)
  })

  it('returns -1 when the rkey is not in the tree', () => {
    const tree = [makeNode('top1')]
    expect(findTopLevelIndexByRkey(tree, 'absent')).toBe(-1)
  })

  it('returns -1 for an empty tree', () => {
    expect(findTopLevelIndexByRkey([], 'anything')).toBe(-1)
  })
})

// ---------------------------------------------------------------------------
// searchCommentTree()
// ---------------------------------------------------------------------------

describe('searchCommentTree', () => {
  const c1Uri = 'at://did:plc:a/social.coves.community.comment/c1' as AtUri
  const c2Uri = 'at://did:plc:a/social.coves.community.comment/c2' as AtUri
  const c3Uri = 'at://did:plc:a/social.coves.community.comment/c3' as AtUri
  const missingUri =
    'at://did:plc:a/social.coves.community.comment/missing' as AtUri

  function makeTree(): CommentNodeI[] {
    return [
      {
        comment: makeCommentView({ uri: c1Uri }),
        children: [
          {
            comment: makeCommentView({ uri: c2Uri }),
            children: [
              {
                comment: makeCommentView({ uri: c3Uri }),
                children: [],
                depth: 2,
              },
            ],
            depth: 1,
          },
        ],
        depth: 0,
      },
    ]
  }

  it('finds a root-level node', () => {
    const tree = makeTree()
    const found = searchCommentTree(tree, c1Uri)
    expect(found).toBeDefined()
    expect(found!.comment.uri).toBe(c1Uri)
  })

  it('finds a nested child node', () => {
    const tree = makeTree()
    const found = searchCommentTree(tree, c2Uri)
    expect(found).toBeDefined()
    expect(found!.comment.uri).toBe(c2Uri)
  })

  it('finds a deeply nested node', () => {
    const tree = makeTree()
    const found = searchCommentTree(tree, c3Uri)
    expect(found).toBeDefined()
    expect(found!.comment.uri).toBe(c3Uri)
  })

  it('returns undefined when URI does not exist in tree', () => {
    const tree = makeTree()
    const found = searchCommentTree(tree, missingUri)
    expect(found).toBeUndefined()
  })

  it('returns undefined for empty tree', () => {
    const found = searchCommentTree([], c1Uri)
    expect(found).toBeUndefined()
  })

  it('finds the correct node when tree has multiple top-level entries', () => {
    const c4Uri = 'at://did:plc:a/social.coves.community.comment/c4' as AtUri
    const tree: CommentNodeI[] = [
      {
        comment: makeCommentView({ uri: c1Uri }),
        children: [],
        depth: 0,
      },
      {
        comment: makeCommentView({ uri: c4Uri }),
        children: [],
        depth: 0,
      },
    ]

    const found = searchCommentTree(tree, c4Uri)
    expect(found).toBeDefined()
    expect(found!.comment.uri).toBe(c4Uri)
  })
})

// ---------------------------------------------------------------------------
// insertCommentIntoTree()
// ---------------------------------------------------------------------------

describe('insertCommentIntoTree', () => {
  const rootUri = 'at://did:plc:a/social.coves.community.comment/root' as AtUri
  const childUri =
    'at://did:plc:a/social.coves.community.comment/child' as AtUri
  const newUri = 'at://did:plc:a/social.coves.community.comment/new' as AtUri

  function makeTree(): CommentNodeI[] {
    return [
      {
        comment: makeCommentView({ uri: rootUri }),
        children: [
          {
            comment: makeCommentView({ uri: childUri }),
            children: [],
            depth: 1,
          },
        ],
        depth: 0,
      },
    ]
  }

  it('inserts a top-level comment at the beginning of the tree', () => {
    const tree = makeTree()
    const cv = makeCommentView({ uri: newUri, parent: undefined })

    const result = insertCommentIntoTree(tree, cv, false)

    expect(result).toBe(true)
    expect(tree).toHaveLength(2)
    expect(tree[0].comment.uri).toBe(newUri)
    expect(tree[0].depth).toBe(0)
    expect(tree[0].children).toEqual([])
    // Inserted nodes must render expanded, or new comments look collapsed
    expect(tree[0].expanded).toBe(true)
  })

  it('inserts a comment whose parent ref is the post itself as top-level', () => {
    const tree = makeTree()
    const postRef: CommentRef = {
      uri: 'at://did:plc:post/social.coves.community.post/root1' as AtUri,
      cid: 'bafypost1' as CID,
    }
    const cv = makeCommentView({ uri: newUri, parent: postRef, post: postRef })

    const result = insertCommentIntoTree(tree, cv, false)

    expect(result).toBe(true)
    expect(tree).toHaveLength(2)
    expect(tree[0].comment.uri).toBe(newUri)
    expect(tree[0].depth).toBe(0)
    expect(tree[0].children).toEqual([])
    expect(tree[0].expanded).toBe(true)
  })

  it('does not insert a comment whose parent ref is the post when parentComment is true', () => {
    const tree = makeTree()
    const postRef: CommentRef = {
      uri: 'at://did:plc:post/social.coves.community.post/root1' as AtUri,
      cid: 'bafypost1' as CID,
    }
    const cv = makeCommentView({ uri: newUri, parent: postRef, post: postRef })

    const result = insertCommentIntoTree(tree, cv, true)

    expect(result).toBe(false)
    expect(tree).toHaveLength(1)
    expect(tree[0].comment.uri).toBe(rootUri)
    expect(tree[0].children).toHaveLength(1)
  })

  it('does not insert a top-level comment when parentComment is true', () => {
    const tree = makeTree()
    const cv = makeCommentView({ uri: newUri, parent: undefined })

    const result = insertCommentIntoTree(tree, cv, true)

    expect(result).toBe(false)
    expect(tree).toHaveLength(1)
    expect(tree[0].comment.uri).toBe(rootUri)
  })

  it('inserts a reply as the first child of its parent', () => {
    const tree = makeTree()
    const parentRef: CommentRef = {
      uri: rootUri,
      cid: 'bafyroot' as CID,
    }
    const cv = makeCommentView({ uri: newUri, parent: parentRef })

    const result = insertCommentIntoTree(tree, cv, true)

    expect(result).toBe(true)
    const rootNode = tree[0]
    expect(rootNode.children).toHaveLength(2)
    expect(rootNode.children[0].comment.uri).toBe(newUri)
    expect(rootNode.children[0].depth).toBe(1)
    // Inserted nodes must render expanded, or new comments look collapsed
    expect(rootNode.children[0].expanded).toBe(true)
  })

  it('inserts a reply to a nested comment with correct depth', () => {
    const tree = makeTree()
    const parentRef: CommentRef = {
      uri: childUri,
      cid: 'bafychild' as CID,
    }
    const cv = makeCommentView({ uri: newUri, parent: parentRef })

    const result = insertCommentIntoTree(tree, cv, true)

    expect(result).toBe(true)
    const childNode = tree[0].children[0]
    expect(childNode.children).toHaveLength(1)
    expect(childNode.children[0].comment.uri).toBe(newUri)
    expect(childNode.children[0].depth).toBe(2)
  })

  it('does nothing when parent URI is not found in tree', () => {
    const tree = makeTree()
    const parentRef: CommentRef = {
      uri: 'at://did:plc:a/social.coves.community.comment/nonexistent' as AtUri,
      cid: 'bafynonexistent' as CID,
    }
    const cv = makeCommentView({ uri: newUri, parent: parentRef })

    const originalLength = tree.length
    const result = insertCommentIntoTree(tree, cv, true)

    expect(result).toBe(false)
    expect(tree).toHaveLength(originalLength)
    expect(tree[0].children).toHaveLength(1)
  })

  it('inserts into an empty tree as top-level when parentComment is false', () => {
    const tree: CommentNodeI[] = []
    const cv = makeCommentView({ uri: newUri, parent: undefined })

    const result = insertCommentIntoTree(tree, cv, false)

    expect(result).toBe(true)
    expect(tree).toHaveLength(1)
    expect(tree[0].comment.uri).toBe(newUri)
    expect(tree[0].depth).toBe(0)
  })

  it('does not insert into empty tree when parentComment is true and no parent', () => {
    const tree: CommentNodeI[] = []
    const cv = makeCommentView({ uri: newUri, parent: undefined })

    const result = insertCommentIntoTree(tree, cv, true)

    expect(result).toBe(false)
    expect(tree).toHaveLength(0)
  })

  it('warns via console.warn when parent URI is not found', () => {
    const tree = makeTree()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const parentRef: CommentRef = {
      uri: 'at://did:plc:a/social.coves.community.comment/nonexistent' as AtUri,
      cid: 'bafynonexistent' as CID,
    }
    const cv = makeCommentView({ uri: newUri, parent: parentRef })

    const result = insertCommentIntoTree(tree, cv, true)

    expect(result).toBe(false)
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toContain('Parent node not found')
    warnSpy.mockRestore()
  })

  it('inserts sequential replies in LIFO order (most recent first)', () => {
    const tree = makeTree()
    const firstUri =
      'at://did:plc:a/social.coves.community.comment/first' as AtUri
    const secondUri =
      'at://did:plc:a/social.coves.community.comment/second' as AtUri
    const parentRef: CommentRef = {
      uri: rootUri,
      cid: 'bafyroot' as CID,
    }

    const cv1 = makeCommentView({ uri: firstUri, parent: parentRef })
    const cv2 = makeCommentView({ uri: secondUri, parent: parentRef })

    insertCommentIntoTree(tree, cv1, true)
    insertCommentIntoTree(tree, cv2, true)

    const rootNode = tree[0]
    // Second insertion should be first (unshift = LIFO)
    expect(rootNode.children[0].comment.uri).toBe(secondUri)
    expect(rootNode.children[1].comment.uri).toBe(firstUri)
  })
})
