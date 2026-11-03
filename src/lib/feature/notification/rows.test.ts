import { describe, it, expect } from 'vitest'
import type { DID, Handle } from '$lib/types/atproto'
import type {
  AtUri,
  CID,
  CommunityRef,
  ListNotificationsResponse,
  NotificationActor,
  NotificationRecord,
  NotificationSubject,
  NotificationView,
} from '$lib/api/coves/types'
import {
  actorName,
  isSensitiveRow,
  notificationAuthor,
  notificationHref,
  notificationIdentity,
  notificationLinkName,
  notificationRootRef,
  parseNotificationRows,
  placeholderCopyKey,
  repliedToComment,
  upvoteNames,
  upvoteSentence,
  upvoteSubjectText,
  type NotificationRow,
  type ReplyNotificationRow,
  type UpvoteNotificationRow,
  type UpvoteSentencePart,
} from './rows'
import { match as matchCommunityParam } from '../../../params/handle'

// ---------------------------------------------------------------------------
// Fixture builders: plain wire rows with distinct, realistic URIs per key.
// ---------------------------------------------------------------------------

const viewer = 'did:plc:viewer7f3kq2' as DID

function postUri(key: string): AtUri {
  return `at://${viewer}/social.coves.community.post/3kpost${key}` as AtUri
}

function commentUri(key: string): AtUri {
  return `at://did:plc:replier${key}/social.coves.community.comment/3kcomment${key}` as AtUri
}

function cid(key: string): CID {
  return `bafyreib${key}cid` as CID
}

function replyRecord(key: string): NotificationRecord {
  return {
    uri: commentUri(key),
    cid: cid(`record${key}`),
    excerpt: `Reply ${key}`,
    createdAt: '2026-10-12T09:29:58.000Z',
  }
}

function upvoteSubject(key: string): NotificationSubject {
  return {
    uri: postUri(key),
    cid: cid(`root${key}`),
    preview: `Thread ${key}`,
  }
}

function replyRow(
  key: string,
  overrides: Partial<NotificationView> = {},
): NotificationView {
  return {
    reason: 'postReply',
    sortAt: '2026-10-12T09:30:00.000Z',
    isRead: false,
    rootPost: {
      uri: postUri(key),
      cid: cid(`root${key}`),
      title: `Thread ${key}`,
      community: {
        did: 'did:plc:gardening' as DID,
        name: 'gardening',
      },
    },
    record: replyRecord(key),
    author: {
      did: `did:plc:replier${key}` as DID,
      handle: `replier${key}.local.coves.dev`,
      displayName: `Replier ${key}`,
    },
    ...overrides,
  }
}

function upvoteRow(
  key: string,
  overrides: Partial<NotificationView> = {},
): NotificationView {
  return {
    reason: 'upvote',
    sortAt: '2026-10-12T08:00:00.000Z',
    isRead: true,
    rootPost: {
      uri: postUri(key),
      cid: cid(`root${key}`),
      title: `Thread ${key}`,
    },
    subject: upvoteSubject(key),
    upvoteCount: 4,
    recentUpvoters: [
      {
        did: `did:plc:voter${key}` as DID,
        handle: `voter${key}.local.coves.dev`,
      },
    ],
    ...overrides,
  }
}

/** Builds `row` without `key`, as a malformed wire row would arrive. */
function without(row: object, key: string): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(([entryKey]) => entryKey !== key),
  )
}

function listOf(...rows: unknown[]): ListNotificationsResponse {
  return { notifications: rows } as unknown as ListNotificationsResponse
}

// ---------------------------------------------------------------------------
// parseNotificationRows
// ---------------------------------------------------------------------------

describe('parseNotificationRows', () => {
  it.each<[string, unknown]>([
    ['a null row', null],
    ['an unknown reason', replyRow('bad', { reason: 'like' })],
    [
      'an unknown reason shaped like an upvote',
      upvoteRow('bad', { reason: 'like' }),
    ],
    ['a non-string sortAt', { ...replyRow('bad'), sortAt: 1760261400000 }],
    ['a non-boolean isRead', { ...replyRow('bad'), isRead: 'false' }],
    [
      'a rootPost without uri',
      { ...replyRow('bad'), rootPost: { cid: cid('rootbad') } },
    ],
    ['a row without rootPost', without(replyRow('bad'), 'rootPost')],
    [
      'a postReply whose record has no uri',
      { ...replyRow('bad'), record: without(replyRecord('bad'), 'uri') },
    ],
    [
      'a commentReply whose record has no uri',
      {
        ...replyRow('bad', { reason: 'commentReply' }),
        record: without(replyRecord('bad'), 'uri'),
      },
    ],
    [
      'a mention whose record has no uri',
      {
        ...replyRow('bad', { reason: 'mention' }),
        record: without(replyRecord('bad'), 'uri'),
      },
    ],
    ['a postReply without record', without(replyRow('bad'), 'record')],
    [
      'a mention without record',
      without(replyRow('bad', { reason: 'mention' }), 'record'),
    ],
    [
      'an upvote whose subject has no uri',
      { ...upvoteRow('bad'), subject: without(upvoteSubject('bad'), 'uri') },
    ],
    ['an upvote without subject', without(upvoteRow('bad'), 'subject')],
    [
      'an upvote with recentUpvoters omitted and no upvoteCount',
      without(without(upvoteRow('bad'), 'recentUpvoters'), 'upvoteCount'),
    ],
    [
      'an upvote with recentUpvoters omitted and upvoteCount 0',
      {
        ...without(upvoteRow('bad'), 'recentUpvoters'),
        upvoteCount: 0,
      },
    ],
    [
      'an upvote with empty recentUpvoters and upvoteCount 0',
      upvoteRow('bad', { recentUpvoters: [], upvoteCount: 0 }),
    ],
    [
      'an upvote with empty recentUpvoters and upvoteCount omitted',
      without(upvoteRow('bad', { recentUpvoters: [] }), 'upvoteCount'),
    ],
    [
      'an upvote with empty recentUpvoters and an infinite upvoteCount',
      upvoteRow('bad', {
        recentUpvoters: [],
        upvoteCount: Number.POSITIVE_INFINITY,
      }),
    ],
    [
      'an upvote with empty recentUpvoters and a fractional upvoteCount',
      upvoteRow('bad', { recentUpvoters: [], upvoteCount: 2.5 }),
    ],
    [
      'an upvote with string recentUpvoters and a positive upvoteCount',
      { ...upvoteRow('bad'), recentUpvoters: 'voter', upvoteCount: 4 },
    ],
    [
      'an upvote with object recentUpvoters and a positive upvoteCount',
      { ...upvoteRow('bad'), recentUpvoters: {}, upvoteCount: 4 },
    ],
    [
      'an upvote whose only recent upvoter is null and upvoteCount 0',
      { ...upvoteRow('bad'), recentUpvoters: [null], upvoteCount: 0 },
    ],
    [
      'an upvote whose recent upvoters are all invalid and upvoteCount omitted',
      {
        ...without(upvoteRow('bad'), 'upvoteCount'),
        recentUpvoters: [null, 'voter', { handle: 'voter.local.coves.dev' }],
      },
    ],
    // Each reference must be a full at://<did>/<collection>/<rkey> URI.
    ...['', 'x', 'at://did:plc:x'].flatMap((uri): [string, unknown][] => [
      [
        `a rootPost with uri "${uri}"`,
        { ...replyRow('bad'), rootPost: { uri, cid: cid('rootbad') } },
      ],
      [
        `a postReply whose record has uri "${uri}"`,
        { ...replyRow('bad'), record: { ...replyRecord('bad'), uri } },
      ],
      [
        `an upvote whose subject has uri "${uri}"`,
        { ...upvoteRow('bad'), subject: { ...upvoteSubject('bad'), uri } },
      ],
    ]),
  ])('skips %s and keeps the valid rows in server order', (_title, invalid) => {
    const first = replyRow('first')
    const last = upvoteRow('last')
    const expected = structuredClone([first, last])

    const rows = parseNotificationRows(listOf(first, invalid, last))

    expect(rows).toStrictEqual(expected)
  })

  it.each<[string, NotificationView]>([
    [
      'a postReply without author',
      without(replyRow('sparse'), 'author') as unknown as NotificationView,
    ],
    [
      'a mention whose rootPost has no community',
      replyRow('sparse', {
        reason: 'mention',
        rootPost: { uri: postUri('sparse'), cid: cid('rootsparse') },
      }),
    ],
    [
      'a postReply whose record has no createdAt',
      replyRow('sparse', {
        record: { uri: commentUri('sparse'), cid: cid('recordsparse') },
      }),
    ],
    [
      'a native upvote group without upvoteCount',
      without(
        upvoteRow('sparse'),
        'upvoteCount',
      ) as unknown as NotificationView,
    ],
    [
      'a commentReply with no texts, labels or thumbnails',
      replyRow('sparse', {
        reason: 'commentReply',
        rootPost: {
          uri: postUri('sparse'),
          cid: cid('rootsparse'),
          status: 'removedByModerator',
        },
        record: {
          uri: commentUri('sparse'),
          cid: cid('recordsparse'),
          status: 'deleted',
        },
      }),
    ],
    [
      'an upvote with no texts, labels or thumbnails',
      upvoteRow('sparse', {
        rootPost: { uri: postUri('sparse'), cid: cid('rootsparse') },
        subject: {
          uri: commentUri('sparse'),
          cid: cid('subjectsparse'),
          status: 'removedByServerAdmin',
        },
      }),
    ],
  ])('keeps %s in order with its fields as received', (_title, sparse) => {
    const first = upvoteRow('first')
    const last = replyRow('last')
    const expected = structuredClone([first, sparse, last])

    const rows = parseNotificationRows(listOf(first, sparse, last))

    expect(rows).toStrictEqual(expected)
  })

  it.each<[string, unknown]>([
    ['a non-object author', 'x'],
    ['a null author', null],
    ['an author without did', { handle: 'replierbad.local.coves.dev' }],
    ['an author with a non-string did', { did: 42 }],
    [
      'an author with a non-string displayName',
      { did: 'did:plc:replierbad', displayName: 42 },
    ],
    [
      'an author with a non-string handle',
      { did: 'did:plc:replierbad', handle: 7 },
    ],
    [
      'an author with an object avatar',
      { did: 'did:plc:replierbad', avatar: {} },
    ],
  ])(
    'keeps a reply with %s as an Unknown user row, without mutating it',
    (_title, author) => {
      const reply = { ...replyRow('anon'), author }
      const received = structuredClone(reply)

      const rows = parseNotificationRows(listOf(reply))

      expect(rows).toStrictEqual([without(received, 'author')])
      expect(reply).toStrictEqual(received)
      const row = rows[0] as ReplyNotificationRow
      expect(notificationAuthor(row)).toStrictEqual({
        name: 'Unknown user',
        avatarSeed:
          'at://did:plc:replieranon/social.coves.community.comment/3kcommentanon',
        did: 'did:plc:replieranon',
      })
    },
  )

  it.each<[string, unknown[], NotificationActor[]]>([
    [
      'a null recent upvoter beside a valid one',
      [null, { did: 'did:plc:votergood', handle: 'votergood.local.coves.dev' }],
      [
        {
          did: 'did:plc:votergood' as DID,
          handle: 'votergood.local.coves.dev',
        },
      ],
    ],
    [
      'malformed recent upvoters around a valid one',
      [
        'voter',
        { did: 'did:plc:votergood', displayName: 'Good Voter' },
        { did: 'did:plc:voterbad', displayName: 42 },
        { did: 'did:plc:voterbad', avatar: {} },
      ],
      [{ did: 'did:plc:votergood' as DID, displayName: 'Good Voter' }],
    ],
    ['only a null recent upvoter with a positive upvoteCount', [null], []],
  ])(
    'keeps an upvote with %s, without the invalid upvoters and without mutating it',
    (_title, recentUpvoters, expectedUpvoters) => {
      const upvote = { ...upvoteRow('mixed'), recentUpvoters }
      const received = structuredClone(upvote)

      const rows = parseNotificationRows(listOf(upvote))

      expect(rows).toStrictEqual([
        { ...received, recentUpvoters: expectedUpvoters },
      ])
      expect(upvote).toStrictEqual(received)
    },
  )

  it('keeps a bridged-only upvote group and gives it empty recentUpvoters', () => {
    const bridged = without(
      upvoteRow('bridged', { upvoteCount: 2 }),
      'recentUpvoters',
    )

    const rows = parseNotificationRows(listOf(bridged))

    expect(rows).toStrictEqual([
      {
        reason: 'upvote',
        sortAt: '2026-10-12T08:00:00.000Z',
        isRead: true,
        rootPost: {
          uri: 'at://did:plc:viewer7f3kq2/social.coves.community.post/3kpostbridged',
          cid: 'bafyreibrootbridgedcid',
          title: 'Thread bridged',
        },
        subject: {
          uri: 'at://did:plc:viewer7f3kq2/social.coves.community.post/3kpostbridged',
          cid: 'bafyreibrootbridgedcid',
          preview: 'Thread bridged',
        },
        upvoteCount: 2,
        recentUpvoters: [],
      },
    ])
  })

  const rootAuthor = {
    did: 'did:plc:rootauthor9q2w',
    handle: 'root-author.coves.social',
    displayName: 'Root Author',
  }
  const rootCreatedAt = '2026-10-11T18:00:00.000Z'
  const rootStats = { upvotes: 14, downvotes: 2, score: 12, commentCount: 4 }

  it.each<[string, (key: string) => NotificationView]>([
    ['reply', (key) => replyRow(key)],
    ['upvote', (key) => upvoteRow(key)],
  ])(
    'keeps the %s row whose root post carries a valid author, createdAt and stats as received',
    (_kind, build) => {
      const row = build('rich')
      const withParts = {
        ...row,
        rootPost: {
          ...row.rootPost,
          author: rootAuthor,
          createdAt: rootCreatedAt,
          stats: rootStats,
        },
      }

      const [parsed] = parseNotificationRows(listOf(withParts))

      expect(parsed?.rootPost).toStrictEqual({
        uri: 'at://did:plc:viewer7f3kq2/social.coves.community.post/3kpostrich',
        cid: 'bafyreibrootrichcid',
        title: 'Thread rich',
        ...(row.reason === 'upvote'
          ? {}
          : { community: { did: 'did:plc:gardening', name: 'gardening' } }),
        author: {
          did: 'did:plc:rootauthor9q2w',
          handle: 'root-author.coves.social',
          displayName: 'Root Author',
        },
        createdAt: '2026-10-11T18:00:00.000Z',
        stats: { upvotes: 14, downvotes: 2, score: 12, commentCount: 4 },
      })
    },
  )

  it.each<[string, string, unknown]>([
    ['reply', 'author', null],
    ['reply', 'author', { did: 'did:plc:rootauthor9q2w' }],
    ['upvote', 'author', 'root-author.coves.social'],
    ['upvote', 'author', { did: 42, handle: 'root-author.coves.social' }],
    ['reply', 'author', { did: 'invalid', handle: 'root-author.coves.social' }],
    [
      'upvote',
      'author',
      {
        did: 'did:plc:rootauthor9q2w',
        handle: 'root-author.coves.social',
        avatar: 42,
      },
    ],
    [
      'reply',
      'author',
      {
        did: 'did:plc:rootauthor9q2w',
        handle: 'root-author.coves.social',
        displayName: null,
      },
    ],
    ['reply', 'createdAt', 1760205600000],
    ['upvote', 'createdAt', null],
    ['reply', 'stats', [12, 4]],
    [
      'reply',
      'stats',
      { upvotes: 14, downvotes: 2, score: 1.5, commentCount: 4 },
    ],
    [
      'upvote',
      'stats',
      { upvotes: 14, downvotes: 2, score: 12, commentCount: '4' },
    ],
    ['upvote', 'stats', { upvotes: 14, downvotes: 2, score: 12 }],
    [
      'reply',
      'stats',
      { upvotes: 14, downvotes: 2, score: 12, commentCount: -1 },
    ],
    [
      'upvote',
      'stats',
      { upvotes: 14, downvotes: -2, score: 12, commentCount: 4 },
    ],
    [
      'reply',
      'stats',
      { upvotes: -14, downvotes: 2, score: 12, commentCount: 4 },
    ],
  ])(
    'keeps the %s row and drops only its malformed root %s (%j)',
    (kind, part, malformed) => {
      const row = kind === 'reply' ? replyRow('bad') : upvoteRow('bad')
      const rootPost = {
        ...row.rootPost,
        author: rootAuthor,
        createdAt: rootCreatedAt,
        stats: rootStats,
        [part]: malformed,
      }

      const parsed = parseNotificationRows(listOf({ ...row, rootPost }))

      expect(parsed).toHaveLength(1)
      const expectedParts: Record<string, unknown> = {
        author: {
          did: 'did:plc:rootauthor9q2w',
          handle: 'root-author.coves.social',
          displayName: 'Root Author',
        },
        createdAt: '2026-10-11T18:00:00.000Z',
        stats: { upvotes: 14, downvotes: 2, score: 12, commentCount: 4 },
      }
      delete expectedParts[part]
      expect(parsed[0]?.rootPost).toStrictEqual({
        uri: 'at://did:plc:viewer7f3kq2/social.coves.community.post/3kpostbad',
        cid: 'bafyreibrootbadcid',
        title: 'Thread bad',
        ...(kind === 'reply'
          ? { community: { did: 'did:plc:gardening', name: 'gardening' } }
          : {}),
        ...expectedParts,
      })
    },
  )

  it.each<[string, (key: string) => NotificationView]>([
    ['reply', (key) => replyRow(key)],
    ['upvote', (key) => upvoteRow(key)],
  ])(
    'keeps the %s row and drops a root createdAt that is not an RFC 3339 date',
    (_kind, build) => {
      const row = build('baddate')
      const rootPost = {
        ...row.rootPost,
        author: rootAuthor,
        createdAt: 'not-a-date',
        stats: rootStats,
      }

      const parsed = parseNotificationRows(listOf({ ...row, rootPost }))

      expect(parsed).toHaveLength(1)
      expect(parsed[0]?.rootPost).toStrictEqual({
        uri: 'at://did:plc:viewer7f3kq2/social.coves.community.post/3kpostbaddate',
        cid: 'bafyreibrootbaddatecid',
        title: 'Thread baddate',
        ...(row.reason === 'upvote'
          ? {}
          : { community: { did: 'did:plc:gardening', name: 'gardening' } }),
        author: {
          did: 'did:plc:rootauthor9q2w',
          handle: 'root-author.coves.social',
          displayName: 'Root Author',
        },
        stats: { upvotes: 14, downvotes: 2, score: 12, commentCount: 4 },
      })
    },
  )

  it('keeps a negative score and zero counts in valid root stats', () => {
    const row = replyRow('zero')
    const stats = { upvotes: 0, downvotes: 3, score: -3, commentCount: 0 }

    const [parsed] = parseNotificationRows(
      listOf({ ...row, rootPost: { ...row.rootPost, stats } }),
    )

    expect(parsed?.rootPost.stats).toStrictEqual({
      upvotes: 0,
      downvotes: 3,
      score: -3,
      commentCount: 0,
    })
  })
})

// ---------------------------------------------------------------------------
// actorName
// ---------------------------------------------------------------------------

const alice = 'did:plc:alice4x7k' as DID

describe('actorName', () => {
  it('prefers the trimmed display name over a usable handle', () => {
    const name = actorName({
      did: alice,
      displayName: '  Alice  ',
      handle: 'alice.local.coves.dev',
    })

    expect(name).toBe('Alice')
  })

  it.each<[string, NotificationActor]>([
    ['no display name', { did: alice, handle: 'alice.local.coves.dev' }],
    [
      'a blank display name',
      { did: alice, displayName: '   ', handle: 'alice.local.coves.dev' },
    ],
  ])('falls back to the handle for %s', (_title, actor) => {
    expect(actorName(actor)).toBe('alice.local.coves.dev')
  })

  it.each<[string, NotificationActor]>([
    ['a DID only', { did: alice }],
    ['a DID with a blank display name', { did: alice, displayName: '   ' }],
    ['handle.invalid', { did: alice, handle: 'handle.invalid' }],
    [
      'handle.invalid with a blank display name',
      { did: alice, displayName: ' ', handle: 'handle.invalid' },
    ],
    ['an empty handle', { did: alice, handle: '' }],
    [
      'an empty handle with a blank display name',
      { did: alice, displayName: '  ', handle: '' },
    ],
  ])('names an actor with %s "Unknown user"', (_title, actor) => {
    expect(actorName(actor)).toBe('Unknown user')
  })
})

// ---------------------------------------------------------------------------
// notificationAuthor
// ---------------------------------------------------------------------------

function asReplyRow(row: object): ReplyNotificationRow {
  return row as ReplyNotificationRow
}

describe('notificationAuthor', () => {
  it.each<
    [
      string,
      ReplyNotificationRow,
      {
        name: string
        handle: string | undefined
        avatarUrl: string | undefined
        avatarSeed: string
        did: string
      },
    ]
  >([
    [
      'a postReply without author',
      asReplyRow(without(replyRow('anon'), 'author')),
      {
        name: 'Unknown user',
        handle: undefined,
        avatarUrl: undefined,
        avatarSeed:
          'at://did:plc:replieranon/social.coves.community.comment/3kcommentanon',
        did: 'did:plc:replieranon',
      },
    ],
    [
      'a mention without author',
      asReplyRow(without(replyRow('quiet', { reason: 'mention' }), 'author')),
      {
        name: 'Unknown user',
        handle: undefined,
        avatarUrl: undefined,
        avatarSeed:
          'at://did:plc:replierquiet/social.coves.community.comment/3kcommentquiet',
        did: 'did:plc:replierquiet',
      },
    ],
    [
      // The parser rejects a record URI whose authority is not a DID, so the
      // row is built directly to reach the fallback.
      'a reply without author whose record URI authority is not a DID',
      asReplyRow({
        ...without(replyRow('handle'), 'author'),
        record: {
          ...replyRecord('handle'),
          uri: 'at://alice.example/social.coves.community.comment/3k' as AtUri,
        },
      }),
      {
        name: 'Unknown user',
        handle: undefined,
        avatarUrl: undefined,
        avatarSeed: 'at://alice.example/social.coves.community.comment/3k',
        did: '',
      },
    ],
    [
      'a DID-only author',
      asReplyRow(replyRow('didonly', { author: { did: alice } })),
      {
        name: 'Unknown user',
        handle: undefined,
        avatarUrl: undefined,
        avatarSeed: 'did:plc:alice4x7k',
        did: 'did:plc:alice4x7k',
      },
    ],
    [
      'a populated author',
      asReplyRow(
        replyRow('full', {
          reason: 'commentReply',
          author: {
            did: alice,
            handle: 'alice.local.coves.dev',
            displayName: '  Alice  ',
            avatar:
              'https://cdn.local.coves.dev/avatar/did:plc:alice4x7k/bafkreialice',
          },
        }),
      ),
      {
        name: 'Alice',
        handle: 'alice.local.coves.dev',
        avatarUrl:
          'https://cdn.local.coves.dev/avatar/did:plc:alice4x7k/bafkreialice',
        avatarSeed: 'did:plc:alice4x7k',
        did: 'did:plc:alice4x7k',
      },
    ],
    [
      'an author with handle.invalid and an avatar',
      asReplyRow(
        replyRow('invalid', {
          author: {
            did: alice,
            handle: 'handle.invalid',
            avatar:
              'https://cdn.local.coves.dev/avatar/did:plc:alice4x7k/bafkreialice',
          },
        }),
      ),
      {
        name: 'Unknown user',
        handle: undefined,
        avatarUrl:
          'https://cdn.local.coves.dev/avatar/did:plc:alice4x7k/bafkreialice',
        avatarSeed: 'did:plc:alice4x7k',
        did: 'did:plc:alice4x7k',
      },
    ],
  ])('describes %s', (_title, row, expected) => {
    const author = notificationAuthor(row)

    expect({
      name: author.name,
      handle: author.handle,
      avatarUrl: author.avatarUrl,
      avatarSeed: author.avatarSeed,
      did: author.did,
    }).toStrictEqual(expected)
  })
})

// ---------------------------------------------------------------------------
// notificationIdentity
// ---------------------------------------------------------------------------

describe('notificationIdentity', () => {
  it.each<[string, ReplyNotificationRow, string]>([
    [
      'postReply',
      asReplyRow(replyRow('p1')),
      'postReply|at://did:plc:replierp1/social.coves.community.comment/3kcommentp1',
    ],
    [
      'commentReply',
      asReplyRow(replyRow('c1', { reason: 'commentReply' })),
      'commentReply|at://did:plc:replierc1/social.coves.community.comment/3kcommentc1',
    ],
    [
      'mention',
      asReplyRow(replyRow('m1', { reason: 'mention' })),
      'mention|at://did:plc:replierm1/social.coves.community.comment/3kcommentm1',
    ],
  ])('keys a %s row by its reason and record uri', (_title, row, expected) => {
    expect(notificationIdentity(row)).toBe(expected)
  })

  it('keys an upvote group by its subject uri, not the root post', () => {
    const row = upvoteRow('v1', {
      subject: { uri: commentUri('v1'), cid: cid('subjectv1') },
    }) as UpvoteNotificationRow

    expect(notificationIdentity(row)).toBe(
      'upvote|at://did:plc:replierv1/social.coves.community.comment/3kcommentv1',
    )
  })
})

// ---------------------------------------------------------------------------
// notificationHref
// ---------------------------------------------------------------------------

/** A served community without `origin`: its route segment is the handle slug. */
const gardening: CommunityRef = {
  did: 'did:plc:gardening' as DID,
  handle: 'c-gardening.local.coves.dev' as Handle,
  name: 'gardening',
}

function asUpvoteRow(row: object): UpvoteNotificationRow {
  return row as UpvoteNotificationRow
}

describe('notificationHref', () => {
  it.each<[string, NotificationRow, string]>([
    [
      'a postReply',
      asReplyRow(
        replyRow('pr1', {
          rootPost: {
            uri: postUri('pr1'),
            cid: cid('rootpr1'),
            community: gardening,
          },
        }),
      ),
      '/c/gardening.local.coves.dev/post/did%3Aplc%3Aviewer7f3kq2/3kpostpr1/comment/replierpr1.local.coves.dev/3kcommentpr1',
    ],
    [
      'a commentReply',
      asReplyRow(
        replyRow('cr1', {
          reason: 'commentReply',
          rootPost: {
            uri: 'at://did:plc:opcr1/social.coves.community.post/3kthreadcr1' as AtUri,
            cid: cid('rootcr1'),
            community: gardening,
          },
        }),
      ),
      '/c/gardening.local.coves.dev/post/did%3Aplc%3Aopcr1/3kthreadcr1/comment/repliercr1.local.coves.dev/3kcommentcr1',
    ],
    [
      'a mention in a comment',
      asReplyRow(
        replyRow('mc1', {
          reason: 'mention',
          rootPost: {
            uri: 'at://did:plc:opmc1/social.coves.community.post/3kthreadmc1' as AtUri,
            cid: cid('rootmc1'),
            community: gardening,
          },
        }),
      ),
      '/c/gardening.local.coves.dev/post/did%3Aplc%3Aopmc1/3kthreadmc1/comment/repliermc1.local.coves.dev/3kcommentmc1',
    ],
  ])(
    'links %s to the comment permalink under the root post, named by its author',
    (_title, row, expected) => {
      expect(notificationHref(row)).toBe(expected)
    },
  )

  it('links a mention in a post to that post, owned by its author', () => {
    const row = asReplyRow(
      replyRow('mp1', {
        reason: 'mention',
        rootPost: {
          uri: postUri('mp1'),
          cid: cid('rootmp1'),
          community: gardening,
        },
        record: {
          uri: 'at://did:plc:repliermp1/social.coves.community.post/3kmentionmp1' as AtUri,
          cid: cid('recordmp1'),
        },
      }),
    )

    expect(notificationHref(row)).toBe(
      '/c/gardening.local.coves.dev/post/repliermp1.local.coves.dev/3kmentionmp1',
    )
  })

  it('links an upvoted comment to its permalink, named by the comment repo DID, not an upvoter', () => {
    const row = asUpvoteRow(
      upvoteRow('uc1', {
        rootPost: {
          uri: 'at://did:plc:opuc1/social.coves.community.post/3kthreaduc1' as AtUri,
          cid: cid('rootuc1'),
          community: gardening,
        },
        subject: {
          uri: `at://${viewer}/social.coves.community.comment/3kcommentuc1` as AtUri,
          cid: cid('subjectuc1'),
        },
        recentUpvoters: [
          { did: viewer, handle: 'viewer.local.coves.dev' },
          {
            did: 'did:plc:voteruc1' as DID,
            handle: 'voteruc1.local.coves.dev',
          },
        ],
      }),
    )

    expect(notificationHref(row)).toBe(
      '/c/gardening.local.coves.dev/post/did%3Aplc%3Aopuc1/3kthreaduc1/comment/did%3Aplc%3Aviewer7f3kq2/3kcommentuc1',
    )
  })

  it('links an upvoted post to that post, owned by its repo DID, not an upvoter', () => {
    const row = asUpvoteRow(
      upvoteRow('up1', {
        rootPost: {
          uri: postUri('up1'),
          cid: cid('rootup1'),
          community: gardening,
        },
        recentUpvoters: [{ did: viewer, handle: 'viewer.local.coves.dev' }],
      }),
    )

    expect(notificationHref(row)).toBe(
      '/c/gardening.local.coves.dev/post/did%3Aplc%3Aviewer7f3kq2/3kpostup1',
    )
  })

  it.each<[string, NotificationRow, string]>([
    [
      'a postReply',
      asReplyRow(
        without(
          replyRow('na1', {
            rootPost: {
              uri: postUri('na1'),
              cid: cid('rootna1'),
              community: gardening,
            },
          }),
          'author',
        ),
      ),
      '/c/gardening.local.coves.dev/post/did%3Aplc%3Aviewer7f3kq2/3kpostna1/comment/did%3Aplc%3Areplierna1/3kcommentna1',
    ],
    [
      'a commentReply',
      asReplyRow(
        without(
          replyRow('na2', {
            reason: 'commentReply',
            rootPost: {
              uri: 'at://did:plc:opna2/social.coves.community.post/3kthreadna2' as AtUri,
              cid: cid('rootna2'),
              community: gardening,
            },
          }),
          'author',
        ),
      ),
      '/c/gardening.local.coves.dev/post/did%3Aplc%3Aopna2/3kthreadna2/comment/did%3Aplc%3Areplierna2/3kcommentna2',
    ],
  ])(
    'names the commenter of %s without author by the comment repo DID',
    (_title, row, expected) => {
      expect(notificationHref(row)).toBe(expected)
    },
  )
})

// ---------------------------------------------------------------------------
// Root rows without a usable community
// ---------------------------------------------------------------------------

const rootsWithoutCommunity: [string, NotificationRow, string, string][] = [
  [
    'a placeholder root with a status and no community',
    asReplyRow(
      replyRow('dr1', {
        rootPost: {
          uri: 'at://did:plc:posterdr1/social.coves.community.post/3kthreaddr1' as AtUri,
          cid: cid('rootdr1'),
          status: 'removedByModerator',
        },
      }),
    ),
    'did:plc:posterdr1',
    '/c/did%3Aplc%3Aposterdr1/post/did%3Aplc%3Aposterdr1/3kthreaddr1/comment/replierdr1.local.coves.dev/3kcommentdr1',
  ],
  [
    'a live root without community',
    asUpvoteRow(
      upvoteRow('lr1', {
        rootPost: {
          uri: 'at://did:plc:posterlr1/social.coves.community.post/3kthreadlr1' as AtUri,
          cid: cid('rootlr1'),
          title: 'Thread lr1',
        },
        subject: {
          uri: 'at://did:plc:posterlr1/social.coves.community.post/3kthreadlr1' as AtUri,
          cid: cid('rootlr1'),
        },
      }),
    ),
    'did:plc:posterlr1',
    '/c/did%3Aplc%3Aposterlr1/post/did%3Aplc%3Aposterlr1/3kthreadlr1',
  ],
  [
    'a root whose community has a non-string did',
    asReplyRow(
      replyRow('mr1', {
        reason: 'commentReply',
        rootPost: {
          uri: 'at://did:plc:postermr1/social.coves.community.post/3kthreadmr1' as AtUri,
          cid: cid('rootmr1'),
          title: 'Thread mr1',
          community: {
            did: 42,
            name: 'gardening',
          } as unknown as CommunityRef,
        },
      }),
    ),
    'did:plc:postermr1',
    '/c/did%3Aplc%3Apostermr1/post/did%3Aplc%3Apostermr1/3kthreadmr1/comment/repliermr1.local.coves.dev/3kcommentmr1',
  ],
  [
    'a root whose community did is not a DID',
    asReplyRow(
      replyRow('nd1', {
        rootPost: {
          uri: 'at://did:plc:posternd1/social.coves.community.post/3kthreadnd1' as AtUri,
          cid: cid('rootnd1'),
          title: 'Thread nd1',
          community: {
            did: 'not-a-did',
            handle: 'c-gardening.local.coves.dev',
            name: 'gardening',
          } as unknown as CommunityRef,
        },
      }),
    ),
    'did:plc:posternd1',
    '/c/did%3Aplc%3Aposternd1/post/did%3Aplc%3Aposternd1/3kthreadnd1/comment/repliernd1.local.coves.dev/3kcommentnd1',
  ],
]

describe('notificationRootRef', () => {
  it.each(rootsWithoutCommunity)(
    'names %s by the root post repo DID',
    (_title, row, rootDid) => {
      expect(notificationRootRef(row)).toStrictEqual({
        uri: row.rootPost.uri,
        community: { did: rootDid, name: '' },
      })
    },
  )

  it('keeps a string origin, so the href uses the canonical name@origin segment', () => {
    const community = {
      did: 'did:plc:gardening' as DID,
      handle: 'c-gardening.local.coves.dev' as Handle,
      name: 'gardening',
      origin: 'lemmy.world',
    }
    const row = asReplyRow(
      replyRow('og1', {
        rootPost: { uri: postUri('og1'), cid: cid('rootog1'), community },
      }),
    )

    expect(notificationRootRef(row)).toStrictEqual({
      uri: postUri('og1'),
      community,
    })
    expect(notificationHref(row)).toBe(
      '/c/gardening@lemmy.world/post/did%3Aplc%3Aviewer7f3kq2/3kpostog1/comment/replierog1.local.coves.dev/3kcommentog1',
    )
  })
})

describe('notificationHref for a root without a usable community', () => {
  it.each(rootsWithoutCommunity)(
    'routes %s through the root post repo DID as the community segment',
    (_title, row, _rootDid, expected) => {
      const href = notificationHref(row)

      expect(href).toBe(expected)
      const communitySegment = decodeURIComponent(href.split('/')[2] ?? '')
      expect(matchCommunityParam(communitySegment)).toBe(true)
    },
  )
})

// ---------------------------------------------------------------------------
// Root communities with a malformed optional field
// ---------------------------------------------------------------------------

describe('notificationRootRef and notificationHref for a community with a malformed optional field', () => {
  it.each<[string, NotificationRow, CommunityRef, string]>([
    [
      'a non-string handle and no origin',
      asReplyRow(
        replyRow('mh1', {
          rootPost: {
            uri: 'at://did:plc:opmh1/social.coves.community.post/3kthreadmh1' as AtUri,
            cid: cid('rootmh1'),
            community: {
              did: 'did:plc:gardening',
              handle: 42,
              name: 'gardening',
            } as unknown as CommunityRef,
          },
        }),
      ),
      { did: 'did:plc:gardening' as DID, name: 'gardening' },
      '/c/did%3Aplc%3Agardening/post/did%3Aplc%3Aopmh1/3kthreadmh1/comment/repliermh1.local.coves.dev/3kcommentmh1',
    ],
    [
      'a non-string origin and a string handle',
      asUpvoteRow(
        upvoteRow('mo1', {
          rootPost: {
            uri: postUri('mo1'),
            cid: cid('rootmo1'),
            community: {
              did: 'did:plc:gardening',
              handle: 'c-gardening.local.coves.dev',
              name: 'gardening',
              origin: 42,
            } as unknown as CommunityRef,
          },
        }),
      ),
      {
        did: 'did:plc:gardening' as DID,
        handle: 'c-gardening.local.coves.dev' as Handle,
        name: 'gardening',
      },
      '/c/gardening.local.coves.dev/post/did%3Aplc%3Aviewer7f3kq2/3kpostmo1',
    ],
    [
      'a malformed string handle and no origin',
      asReplyRow(
        replyRow('md1', {
          rootPost: {
            uri: 'at://did:plc:opmd1/social.coves.community.post/3kthreadmd1' as AtUri,
            cid: cid('rootmd1'),
            community: {
              did: 'did:plc:gardening',
              handle: '..',
              name: 'gardening',
            } as unknown as CommunityRef,
          },
        }),
      ),
      { did: 'did:plc:gardening' as DID, name: 'gardening' },
      '/c/did%3Aplc%3Agardening/post/did%3Aplc%3Aopmd1/3kthreadmd1/comment/repliermd1.local.coves.dev/3kcommentmd1',
    ],
  ])(
    'keeps a community with %s, dropping only the malformed field',
    (_title, row, expectedCommunity, expectedHref) => {
      expect(notificationRootRef(row).community).toStrictEqual(
        expectedCommunity,
      )
      expect(notificationHref(row)).toBe(expectedHref)
    },
  )
})

// ---------------------------------------------------------------------------
// placeholderCopyKey
// ---------------------------------------------------------------------------

describe('placeholderCopyKey', () => {
  it.each<[string, string]>([
    ['deleted', 'comment.placeholder.deletedByUser'],
    ['removedByModerator', 'comment.placeholder.removedByModerator'],
    ['removedByServerAdmin', 'comment.placeholder.removedByAdmin'],
  ])('maps the %s status to %s', (status, expected) => {
    expect(placeholderCopyKey(status)).toBe(expected)
  })

  it('maps an unknown status to the moderator removal copy', () => {
    expect(placeholderCopyKey('somethingNew')).toBe(
      'comment.placeholder.removedByModerator',
    )
  })
})

// ---------------------------------------------------------------------------
// isSensitiveRow
// ---------------------------------------------------------------------------

const nsfwLabels = { values: [{ val: 'nsfw' }] }

describe('isSensitiveRow', () => {
  it.each<[string, NotificationRow, NotificationRow]>([
    [
      'its rootPost',
      asReplyRow(
        replyRow('ns1', {
          rootPost: {
            uri: postUri('ns1'),
            cid: cid('rootns1'),
            community: gardening,
            labels: nsfwLabels,
          },
        }),
      ),
      asReplyRow(
        replyRow('ns1', {
          rootPost: {
            uri: postUri('ns1'),
            cid: cid('rootns1'),
            community: gardening,
          },
        }),
      ),
    ],
    [
      'its record',
      asReplyRow(
        replyRow('ns2', {
          record: { ...replyRecord('ns2'), labels: nsfwLabels },
        }),
      ),
      asReplyRow(replyRow('ns2')),
    ],
    [
      'its subject',
      asUpvoteRow(
        upvoteRow('ns3', {
          subject: { ...upvoteSubject('ns3'), labels: nsfwLabels },
        }),
      ),
      asUpvoteRow(upvoteRow('ns3')),
    ],
    [
      "a commentReply's subject (the parent comment)",
      asReplyRow(
        replyRow('ns4', {
          reason: 'commentReply',
          subject: {
            uri: commentUri('parentns4'),
            cid: cid('parentns4'),
            labels: nsfwLabels,
          },
        }),
      ),
      asReplyRow(
        replyRow('ns4', {
          reason: 'commentReply',
          subject: { uri: commentUri('parentns4'), cid: cid('parentns4') },
        }),
      ),
    ],
  ])(
    'is sensitive when only %s carries an NSFW label, and not without it',
    (_title, labeledRow, unlabeledRow) => {
      expect(isSensitiveRow(labeledRow)).toBe(true)
      expect(isSensitiveRow(unlabeledRow)).toBe(false)
    },
  )
})

// ---------------------------------------------------------------------------
// upvoteSentence
// ---------------------------------------------------------------------------

/** An upvoter whose display name is `name` and handle `<name>.local.coves.dev`. */
function upvoter(name: string): NotificationActor {
  return {
    did: `did:plc:${name}upvoter` as DID,
    handle: `${name}.local.coves.dev`,
    displayName: name,
  }
}

/** An upvote group on post `key` with these upvoters and this count. */
function upvoteGroup(
  key: string,
  recentUpvoters: NotificationActor[],
  upvoteCount: number,
): UpvoteNotificationRow {
  return asUpvoteRow(upvoteRow(key, { recentUpvoters, upvoteCount }))
}

function sentenceText(parts: UpvoteSentencePart[]): string {
  return parts.map((part) => part.text).join('')
}

function boldTexts(parts: UpvoteSentencePart[]): string[] {
  return parts.filter((part) => part.bold).map((part) => part.text)
}

describe('upvoteSentence', () => {
  it('counts a lone anonymous upvote as "1 person"', () => {
    const parts = upvoteSentence(upvoteGroup('us1', [], 1))

    expect(sentenceText(parts)).toBe('1 person liked your post')
    expect(boldTexts(parts)).toStrictEqual(['1 person'])
  })

  it.each<[string, UpvoteNotificationRow]>([
    ['empty recentUpvoters', upvoteGroup('us2a', [], 3)],
    [
      'recentUpvoters omitted on the wire',
      asUpvoteRow(
        parseNotificationRows(
          listOf(
            without(upvoteRow('us2b', { upvoteCount: 3 }), 'recentUpvoters'),
          ),
        )[0],
      ),
    ],
  ])('counts anonymous upvotes as "3 people" with %s', (_title, row) => {
    const parts = upvoteSentence(row)

    expect(sentenceText(parts)).toBe('3 people liked your post')
    expect(boldTexts(parts)).toStrictEqual(['3 people'])
  })

  it('names one upvoter and counts the single remaining upvote as "1 other"', () => {
    const parts = upvoteSentence(upvoteGroup('us3', [upvoter('alice')], 2))

    expect(sentenceText(parts)).toBe('alice and 1 other liked your post')
    expect(boldTexts(parts)).toStrictEqual(['alice', '1 other'])
  })

  it('names only the first upvoter and counts the rest as "N others"', () => {
    const parts = upvoteSentence(
      upvoteGroup('us4', [upvoter('alice'), upvoter('bob')], 5),
    )

    expect(sentenceText(parts)).toBe('alice and 4 others liked your post')
    expect(boldTexts(parts)).toStrictEqual(['alice', '4 others'])
  })

  it.each<[string, NotificationActor[], string, string[]]>([
    ['one upvoter', [upvoter('alice')], 'alice liked your post', ['alice']],
    [
      'two upvoters',
      [upvoter('alice'), upvoter('bob')],
      'alice and bob liked your post',
      ['alice', 'bob'],
    ],
    [
      'three upvoters, one named by handle',
      [
        upvoter('alice'),
        upvoter('bob'),
        { ...upvoter('carol'), displayName: '   ' },
      ],
      'alice, bob and carol.local.coves.dev liked your post',
      ['alice', 'bob', 'carol.local.coves.dev'],
    ],
  ])(
    'lists every upvoter by name when the count equals the upvoters (%s)',
    (_title, recentUpvoters, expectedText, expectedBold) => {
      const parts = upvoteSentence(
        upvoteGroup('us5', recentUpvoters, recentUpvoters.length),
      )

      expect(sentenceText(parts)).toBe(expectedText)
      expect(boldTexts(parts)).toStrictEqual(expectedBold)
    },
  )

  it.each<[string, UpvoteNotificationRow]>([
    [
      'upvoteCount omitted',
      asUpvoteRow(
        without(
          upvoteRow('us6a', {
            recentUpvoters: [upvoter('alice'), upvoter('bob')],
          }),
          'upvoteCount',
        ),
      ),
    ],
    [
      'upvoteCount below the upvoters',
      upvoteGroup('us6b', [upvoter('alice'), upvoter('bob')], 1),
    ],
    [
      'a non-number upvoteCount',
      asUpvoteRow({
        ...upvoteRow('us6c', {
          recentUpvoters: [upvoter('alice'), upvoter('bob')],
        }),
        upvoteCount: '5' as unknown,
      }),
    ],
    [
      'an infinite upvoteCount',
      upvoteGroup(
        'us6d',
        [upvoter('alice'), upvoter('bob')],
        Number.POSITIVE_INFINITY,
      ),
    ],
    [
      'a fractional upvoteCount',
      upvoteGroup('us6e', [upvoter('alice'), upvoter('bob')], 2.5),
    ],
  ])('counts no others beyond the named upvoters with %s', (_title, row) => {
    const parts = upvoteSentence(row)

    expect(sentenceText(parts)).toBe('alice and bob liked your post')
    expect(boldTexts(parts)).toStrictEqual(['alice', 'bob'])
  })

  it('says "your comment" when the upvoted subject is a comment', () => {
    const row = asUpvoteRow(
      upvoteRow('us7', {
        subject: { uri: commentUri('us7'), cid: cid('commentus7') },
        recentUpvoters: [upvoter('alice')],
        upvoteCount: 1,
      }),
    )

    const parts = upvoteSentence(row)

    expect(sentenceText(parts)).toBe('alice liked your comment')
    expect(boldTexts(parts)).toStrictEqual(['alice'])
  })

  it('names a DID-only upvoter "Unknown user"', () => {
    const parts = upvoteSentence(
      upvoteGroup('us8', [{ did: 'did:plc:anonupvoter' as DID }], 1),
    )

    expect(sentenceText(parts)).toBe('Unknown user liked your post')
    expect(boldTexts(parts)).toStrictEqual(['Unknown user'])
  })
})

// ---------------------------------------------------------------------------
// notificationLinkName
// ---------------------------------------------------------------------------

/** A served community whose `!name@origin` form is `!cats@coves.social`. */
const cats: CommunityRef = {
  did: 'did:plc:cats' as DID,
  name: 'cats',
  origin: 'coves.social',
}

const aliceAuthor: NotificationActor = {
  did: alice,
  handle: 'alice.local.coves.dev',
  displayName: 'Alice',
}

const linkTime = '3 hours ago'

/** A reply row from Alice in cats on post `key`, whose record excerpt is "Cute". */
function catsReplyRow(
  key: string,
  overrides: Partial<NotificationView> = {},
): ReplyNotificationRow {
  return asReplyRow(
    replyRow(key, {
      rootPost: {
        uri: postUri(key),
        cid: cid(`root${key}`),
        title: `Thread ${key}`,
        community: cats,
      },
      record: { ...replyRecord(key), excerpt: 'Cute' },
      author: aliceAuthor,
      ...overrides,
    }),
  )
}

/** An upvote group by Alice and Bob in cats whose subject preview is "Nice shot". */
function catsUpvoteGroup(
  key: string,
  subject: NotificationSubject,
): UpvoteNotificationRow {
  return asUpvoteRow(
    upvoteRow(key, {
      rootPost: {
        uri: postUri(key),
        cid: cid(`root${key}`),
        title: `Thread ${key}`,
        community: cats,
      },
      subject,
      recentUpvoters: [upvoter('Alice'), upvoter('Bob')],
      upvoteCount: 2,
    }),
  )
}

/**
 * A 200-grapheme title: the backend cuts a post mention's excerpt from it at
 * 140 graphemes with no ellipsis, while rootPost.title keeps it whole.
 */
const longTitle = 'Lost grey cat seen near the Elm Street bakery. '
  .repeat(5)
  .slice(0, 200)

describe('notificationLinkName', () => {
  it.each<[string, UpvoteNotificationRow, string]>([
    [
      'a post',
      catsUpvoteGroup('ln1a', {
        uri: postUri('ln1a'),
        cid: cid('rootln1a'),
        preview: 'Nice shot',
      }),
      'Alice and Bob liked your post: Nice shot. 3 hours ago',
    ],
    [
      'a comment',
      catsUpvoteGroup('ln1b', {
        uri: commentUri('ln1b'),
        cid: cid('commentln1b'),
        preview: 'Nice shot',
      }),
      'Alice and Bob liked your comment: Nice shot. 3 hours ago',
    ],
  ])(
    'names an upvote group on %s by its sentence and preview, without its community',
    (_title, row, expected) => {
      const name = notificationLinkName(row, {
        time: linkTime,
        concealed: false,
      })

      expect(name).toBe(expected)
      expect(name).not.toContain('cats')
    },
  )

  it('names a postReply by its author, community and excerpt', () => {
    const name = notificationLinkName(catsReplyRow('ln2'), {
      time: linkTime,
      concealed: false,
    })

    expect(name).toBe(
      'Alice replied to your post in !cats@coves.social: Cute. 3 hours ago',
    )
  })

  it('omits the time segment and its ". " separator when the time is empty', () => {
    const name = notificationLinkName(catsReplyRow('ln2b'), {
      time: '',
      concealed: false,
    })

    expect(name).toBe('Alice replied to your post in !cats@coves.social: Cute')
  })

  it('names a commentReply by its author, community and excerpt', () => {
    const name = notificationLinkName(
      catsReplyRow('ln3', { reason: 'commentReply' }),
      { time: linkTime, concealed: false },
    )

    expect(name).toBe(
      'Alice replied to your comment in !cats@coves.social: Cute. 3 hours ago',
    )
  })

  it('names a post mention whose excerpt differs from the root title by its excerpt', () => {
    const row = catsReplyRow('ln4', {
      reason: 'mention',
      record: {
        uri: 'at://did:plc:alice4x7k/social.coves.community.post/3kpostln4' as AtUri,
        cid: cid('recordln4'),
        excerpt: 'Has anyone seen this cat?',
      },
    })

    const name = notificationLinkName(row, {
      time: linkTime,
      concealed: false,
    })

    expect(name).toBe(
      'Alice mentioned you in !cats@coves.social: Has anyone seen this cat?. 3 hours ago',
    )
  })

  it.each<[string, ReplyNotificationRow]>([
    [
      'a placeholder root that still carries a valid community',
      catsReplyRow('ln5a', {
        rootPost: {
          uri: postUri('ln5a'),
          cid: cid('rootln5a'),
          status: 'deleted',
          community: cats,
        },
      }),
    ],
    [
      'a live root without community',
      catsReplyRow('ln5b', {
        rootPost: {
          uri: postUri('ln5b'),
          cid: cid('rootln5b'),
          title: 'Thread ln5b',
        },
      }),
    ],
    [
      'a live root whose community has an empty name',
      catsReplyRow('ln5c', {
        rootPost: {
          uri: postUri('ln5c'),
          cid: cid('rootln5c'),
          title: 'Thread ln5c',
          community: { did: 'did:plc:cats' as DID, name: '' },
        },
      }),
    ],
    [
      'a live root whose community has a valid name and origin but an invalid DID',
      catsReplyRow('ln5d', {
        rootPost: {
          uri: postUri('ln5d'),
          cid: cid('rootln5d'),
          title: 'Thread ln5d',
          community: {
            did: 'not-a-did' as DID,
            name: 'cats',
            origin: 'coves.social',
          },
        },
      }),
    ],
    [
      'a live root whose community name is not a string',
      catsReplyRow('ln5e', {
        rootPost: {
          uri: postUri('ln5e'),
          cid: cid('rootln5e'),
          title: 'Thread ln5e',
          community: {
            did: 'did:plc:cats',
            name: 42,
            origin: 'coves.social',
          } as unknown as CommunityRef,
        },
      }),
    ],
  ])('omits the community for %s', (_title, row) => {
    const name = notificationLinkName(row, {
      time: linkTime,
      concealed: false,
    })

    expect(name).toBe('Alice replied to your post: Cute. 3 hours ago')
  })

  it('composition check: names an author without a display name by handle, never "@handle"', () => {
    const name = notificationLinkName(
      catsReplyRow('ln6a', {
        author: { did: alice, handle: 'alice.local.coves.dev' },
      }),
      { time: linkTime, concealed: false },
    )

    expect(name).toBe(
      'alice.local.coves.dev replied to your post in !cats@coves.social: Cute. 3 hours ago',
    )
    expect(name).not.toContain('@alice.local.coves.dev')
  })

  it('composition check: names an author with a display name without its @handle', () => {
    const name = notificationLinkName(catsReplyRow('ln6b'), {
      time: linkTime,
      concealed: false,
    })

    expect(name).toBe(
      'Alice replied to your post in !cats@coves.social: Cute. 3 hours ago',
    )
    expect(name).not.toContain('@alice.local.coves.dev')
  })

  it('composition check: names a row without an author "Unknown user"', () => {
    const name = notificationLinkName(
      asReplyRow(without(catsReplyRow('ln6c'), 'author')),
      { time: linkTime, concealed: false },
    )

    expect(name).toBe(
      'Unknown user replied to your post in !cats@coves.social: Cute. 3 hours ago',
    )
  })

  it.each<[string, NotificationRow, string]>([
    [
      'a reply whose record is deleted (excerpt present)',
      catsReplyRow('ln7a', {
        record: { ...replyRecord('ln7a'), excerpt: 'Cute', status: 'deleted' },
      }),
      'Alice replied to your post in !cats@coves.social: [Deleted by user]. 3 hours ago',
    ],
    [
      'a reply whose record is removed by a community moderator (excerpt present)',
      catsReplyRow('ln7b', {
        record: {
          ...replyRecord('ln7b'),
          excerpt: 'Cute',
          status: 'removedByModerator',
        },
      }),
      'Alice replied to your post in !cats@coves.social: [Removed by community moderator]. 3 hours ago',
    ],
    [
      'an upvote whose subject is removed by a server admin (preview present)',
      catsUpvoteGroup('ln7c', {
        uri: postUri('ln7c'),
        cid: cid('rootln7c'),
        preview: 'Nice shot',
        status: 'removedByServerAdmin',
      }),
      'Alice and Bob liked your post: [Removed by server admin]. 3 hours ago',
    ],
    [
      'a deleted post mention whose excerpt equals the root title',
      catsReplyRow('ln7d', {
        reason: 'mention',
        rootPost: {
          uri: postUri('ln7d'),
          cid: cid('rootln7d'),
          title: 'Lost cat on Elm Street',
          community: cats,
        },
        record: {
          uri: 'at://did:plc:alice4x7k/social.coves.community.post/3kpostln7d' as AtUri,
          cid: cid('recordln7d'),
          excerpt: 'Lost cat on Elm Street',
          status: 'deleted',
        },
      }),
      'Alice mentioned you in !cats@coves.social: [Deleted by user]. 3 hours ago',
    ],
  ])('uses the placeholder copy as the text of %s', (_title, row, expected) => {
    const name = notificationLinkName(row, {
      time: linkTime,
      concealed: false,
    })

    expect(name).toBe(expected)
  })

  it.each<[string, NotificationRow, string]>([
    [
      'a reply without an excerpt',
      catsReplyRow('ln8a', {
        record: { uri: commentUri('ln8a'), cid: cid('recordln8a') },
      }),
      'Alice replied to your post in !cats@coves.social. 3 hours ago',
    ],
    [
      'a reply with an empty excerpt',
      catsReplyRow('ln8b', {
        record: { ...replyRecord('ln8b'), excerpt: '' },
      }),
      'Alice replied to your post in !cats@coves.social. 3 hours ago',
    ],
    [
      'an upvote without a preview',
      catsUpvoteGroup('ln8c', { uri: postUri('ln8c'), cid: cid('rootln8c') }),
      'Alice and Bob liked your post. 3 hours ago',
    ],
    [
      'an upvote with an empty preview',
      catsUpvoteGroup('ln8d', {
        uri: postUri('ln8d'),
        cid: cid('rootln8d'),
        preview: '',
      }),
      'Alice and Bob liked your post. 3 hours ago',
    ],
    [
      'a post mention whose excerpt equals the root title',
      catsReplyRow('ln8e', {
        reason: 'mention',
        rootPost: {
          uri: postUri('ln8e'),
          cid: cid('rootln8e'),
          title: 'Lost cat on Elm Street',
          community: cats,
        },
        record: {
          uri: 'at://did:plc:alice4x7k/social.coves.community.post/3kpostln8e' as AtUri,
          cid: cid('recordln8e'),
          excerpt: 'Lost cat on Elm Street',
        },
      }),
      'Alice mentioned you in !cats@coves.social. 3 hours ago',
    ],
    [
      'a post mention whose excerpt is the backend cut of a title over 140 graphemes',
      catsReplyRow('ln8g', {
        reason: 'mention',
        rootPost: {
          uri: postUri('ln8g'),
          cid: cid('rootln8g'),
          title: longTitle,
          community: cats,
        },
        record: {
          uri: 'at://did:plc:alice4x7k/social.coves.community.post/3kpostln8g' as AtUri,
          cid: cid('recordln8g'),
          excerpt: longTitle.slice(0, 140),
        },
      }),
      'Alice mentioned you in !cats@coves.social. 3 hours ago',
    ],
  ])('omits the text segment for %s', (_title, row, expected) => {
    const name = notificationLinkName(row, {
      time: linkTime,
      concealed: false,
    })

    expect(name).toBe(expected)
  })

  it('contrast: keeps the excerpt of a comment mention that equals the root title', () => {
    const row = catsReplyRow('ln8f', {
      reason: 'mention',
      rootPost: {
        uri: postUri('ln8f'),
        cid: cid('rootln8f'),
        title: 'Lost cat on Elm Street',
        community: cats,
      },
      record: {
        uri: commentUri('ln8f'),
        cid: cid('recordln8f'),
        excerpt: 'Lost cat on Elm Street',
      },
    })

    const name = notificationLinkName(row, {
      time: linkTime,
      concealed: false,
    })

    expect(name).toBe(
      'Alice mentioned you in !cats@coves.social: Lost cat on Elm Street. 3 hours ago',
    )
  })

  it.each<[string, NotificationRow, string, string]>([
    [
      'a labelled reply with an excerpt',
      catsReplyRow('ln9a', {
        rootPost: {
          uri: postUri('ln9a'),
          cid: cid('rootln9a'),
          title: 'Thread ln9a',
          community: cats,
          labels: nsfwLabels,
        },
        record: { ...replyRecord('ln9a'), excerpt: 'Cute', labels: nsfwLabels },
      }),
      'Alice replied to your post in !cats@coves.social. 3 hours ago',
      'Alice replied to your post in !cats@coves.social: Cute. 3 hours ago',
    ],
    [
      'a labelled upvote with a preview',
      asUpvoteRow({
        ...catsUpvoteGroup('ln9b', {
          uri: postUri('ln9b'),
          cid: cid('rootln9b'),
          preview: 'Nice shot',
          labels: nsfwLabels,
        }),
        rootPost: {
          uri: postUri('ln9b'),
          cid: cid('rootln9b'),
          title: 'Thread ln9b',
          community: cats,
          labels: nsfwLabels,
        },
      }),
      'Alice and Bob liked your post. 3 hours ago',
      'Alice and Bob liked your post: Nice shot. 3 hours ago',
    ],
    [
      'a labelled reply whose record is deleted',
      catsReplyRow('ln9c', {
        rootPost: {
          uri: postUri('ln9c'),
          cid: cid('rootln9c'),
          title: 'Thread ln9c',
          community: cats,
          labels: nsfwLabels,
        },
        record: {
          ...replyRecord('ln9c'),
          excerpt: 'Cute',
          status: 'deleted',
          labels: nsfwLabels,
        },
      }),
      'Alice replied to your post in !cats@coves.social. 3 hours ago',
      'Alice replied to your post in !cats@coves.social: [Deleted by user]. 3 hours ago',
    ],
  ])(
    'drops the text segment of %s only when concealed',
    (_title, row, concealedName, revealedName) => {
      const concealed = notificationLinkName(row, {
        time: linkTime,
        concealed: true,
      })
      const revealed = notificationLinkName(row, {
        time: linkTime,
        concealed: false,
      })

      expect(concealed).toBe(concealedName)
      expect(revealed).toBe(revealedName)
    },
  )

  const titledReplyRow = catsReplyRow('ln10a', {
    rootPost: {
      uri: postUri('ln10a'),
      cid: cid('rootln10a'),
      title: 'Title text',
      thumbnailAlt: 'Root alt text',
      community: cats,
    },
    record: {
      ...replyRecord('ln10a'),
      excerpt: 'Cute',
      thumbnailAlt: 'Alt text',
    },
  })

  const titledUpvoteRow = asUpvoteRow({
    ...catsUpvoteGroup('ln10b', {
      uri: postUri('ln10b'),
      cid: cid('rootln10b'),
      preview: 'Nice shot',
      thumbnailAlt: 'Alt text',
    }),
    rootPost: {
      uri: postUri('ln10b'),
      cid: cid('rootln10b'),
      title: 'Title text',
      thumbnailAlt: 'Root alt text',
      community: cats,
    },
  })

  it.each<[string, NotificationRow, boolean, string]>([
    [
      'a revealed reply',
      titledReplyRow,
      false,
      'Alice replied to your post in !cats@coves.social: Cute. 3 hours ago',
    ],
    [
      'a concealed reply',
      titledReplyRow,
      true,
      'Alice replied to your post in !cats@coves.social. 3 hours ago',
    ],
    [
      'a revealed upvote',
      titledUpvoteRow,
      false,
      'Alice and Bob liked your post: Nice shot. 3 hours ago',
    ],
    [
      'a concealed upvote',
      titledUpvoteRow,
      true,
      'Alice and Bob liked your post. 3 hours ago',
    ],
  ])(
    'never names the root title or any thumbnail alt for %s',
    (_title, row, concealed, expected) => {
      const name = notificationLinkName(row, { time: linkTime, concealed })

      expect(name).toBe(expected)
      expect(name).not.toContain('Title text')
      expect(name).not.toContain('Root alt text')
      expect(name).not.toContain('Alt text')
    },
  )
})

// ---------------------------------------------------------------------------
// upvoteSubjectText
// ---------------------------------------------------------------------------

describe('upvoteSubjectText', () => {
  it('returns the placeholder copy of a removed or deleted subject, even with a preview, else the preview', () => {
    const subject = { uri: postUri('ust1'), cid: cid('rootust1') }

    expect(
      upvoteSubjectText(
        catsUpvoteGroup('ust1', {
          ...subject,
          preview: 'Nice shot',
          status: 'deleted',
        }),
      ),
    ).toBe('[Deleted by user]')
    expect(
      upvoteSubjectText(
        catsUpvoteGroup('ust1', {
          ...subject,
          preview: 'Nice shot',
          status: 'removedByModerator',
        }),
      ),
    ).toBe('[Removed by community moderator]')
    expect(
      upvoteSubjectText(
        catsUpvoteGroup('ust1', { ...subject, preview: 'Nice shot' }),
      ),
    ).toBe('Nice shot')
  })
})

describe('repliedToComment', () => {
  const viewerComment =
    `at://${viewer}/social.coves.community.comment/3kmine1` as AtUri

  function commentReplyRow(subject: unknown): ReplyNotificationRow {
    return {
      ...replyRow('rtc1', { reason: 'commentReply' }),
      subject,
    } as ReplyNotificationRow
  }

  it("returns the preview of the viewer's comment", () => {
    expect(
      repliedToComment(
        commentReplyRow({
          uri: viewerComment,
          cid: cid('mine1'),
          preview: 'Try a 24mm',
        }),
      ),
    ).toEqual({ text: 'Try a 24mm', placeholder: false })
  })

  it('returns the placeholder copy of a removed or deleted comment, even with a preview', () => {
    expect(
      repliedToComment(
        commentReplyRow({
          uri: viewerComment,
          cid: cid('mine1'),
          preview: 'Try a 24mm',
          status: 'removedByServerAdmin',
        }),
      ),
    ).toEqual({ text: '[Removed by server admin]', placeholder: true })
  })

  it.each<[string, unknown]>([
    ['no subject', undefined],
    ['a subject that is not an object', 'at://x'],
    ['a malformed uri', { uri: 'not-a-uri', preview: 'Try a 24mm' }],
    [
      'a post subject',
      { uri: postUri('rtc1'), cid: cid('rootrtc1'), preview: 'Thread' },
    ],
    ['no preview or status', { uri: viewerComment, cid: cid('mine1') }],
    [
      'a blank preview',
      { uri: viewerComment, cid: cid('mine1'), preview: '  ' },
    ],
    [
      'a non-string preview',
      { uri: viewerComment, cid: cid('mine1'), preview: 7 },
    ],
  ])('returns undefined for %s', (_title, subject) => {
    expect(repliedToComment(commentReplyRow(subject))).toBeUndefined()
  })

  it('returns undefined for a postReply even with a comment subject', () => {
    const row = {
      ...replyRow('rtc2'),
      subject: { uri: viewerComment, cid: cid('mine1'), preview: 'Try a 24mm' },
    } as ReplyNotificationRow
    expect(repliedToComment(row)).toBeUndefined()
  })
})

describe('upvoteNames', () => {
  it('returns the upvoteSentence parts without the "liked your post" ending', () => {
    const row = parseNotificationRows(listOf(upvoteRow('un1')))[0]
    if (row?.reason !== 'upvote') throw new Error('Not an upvote row')

    const names = upvoteNames(row)
    expect(names.map((part) => part.text).join('')).toBe(
      'voterun1.local.coves.dev and 3 others',
    )
    expect(upvoteSentence(row).slice(0, -1)).toEqual(names)
  })
})
