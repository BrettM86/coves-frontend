/**
 * A stand-in for the Go backend, for the SSR acceptance tier.
 *
 * The built SvelteKit server talks to `PUBLIC_INTERNAL_INSTANCE` for these
 * requests in the acceptance suite:
 *   - `GET /api/me`            (hooks.server.ts, only when a session cookie is present)
 *   - `GET /xrpc/social.coves.feed.getDiscover` (the `/` page load)
 *   - `GET /xrpc/social.coves.community.list` (`/explore/communities`)
 *   - `POST /xrpc/social.coves.media.uploadImage` and
 *     `POST /xrpc/social.coves.actor.updateProfile` (through `/api/proxy`)
 *   - the RSS feeds' calls (`/c/<community>/rss`, `/profile/<handle>/rss`):
 *     `communityFeed.getCommunity`, `community.get`, `actor.getProfile`,
 *     `actor.getPosts`, `actor.getComments` and `community.post.get`
 *   - the at-tags pages' calls (`/c/<community>`, the post page and the
 *     comment permalink, `/profile/<handle>`): the calls above, keyed by
 *     community, URI or actor, plus
 *     `community.comment.getComments` and `com.atproto.identity.resolveHandle`
 * Anything else is a 404 and is recorded so a future page change surfaces as a
 * named gap rather than an opaque 500.
 *
 * Beyond answering, it RECORDS: every `/xrpc/*` call with the `Authorization`
 * and `Cookie` headers it arrived with, so a test can check what credentials a render
 * actually put on the wire rather than only what it rendered; and every body
 * the two write endpoints above received, by size, type and hash, so a test
 * can prove a proxied upload arrived byte for byte. All records are
 * readable over the control plane, since the tests run in a different process.
 */
import { createHash } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * The accounts this upstream knows, keyed by the `coves_session` cookie value
 * that authenticates as each. `a` and `b` let a test tell "each request sees
 * ITS OWN account" apart from "every request sees the only account there is".
 * `c` has no `avatar` and the PRD_DEFAULT_AVATARS §4.2 vector DID, which
 * maps to `ocean-wave` on Seafoam. Any other cookie value gets a 401.
 */
export const MOCK_ACCOUNTS = {
  a: { did: 'did:plc:abcdefghijklmnopqrstuvwx', handle: 'mari.test' },
  b: { did: 'did:plc:zyxwvutsrqponmlkjihgfedc', handle: 'alex.test' },
  c: { did: 'did:plc:ewvi7nxzyoun6zhxrhs64oiz', handle: 'no-avatar.test' },
} as const

export type MockAccountKey = keyof typeof MOCK_ACCOUNTS

/** Control-plane path the tests read the XRPC request log from. */
export const XRPC_LOG_PATH = '/__test/xrpc-requests'

/** Control-plane path listing paths the mock did not recognise. */
export const UNKNOWN_PATHS_PATH = '/__test/unknown-paths'

/** Control-plane path listing the bodies the write endpoints received. */
export const RECEIVED_BODIES_PATH = '/__test/received-bodies'

/** Visible content proving the CORS-free XRPC payload reached SSR rendering. */
export const SSR_POST_MARKER = 'SSR feed post from CORS-free upstream'
export const SSR_COMMUNITY_MARKER = 'SSR community from CORS-free upstream'

/** The community and user the RSS fixtures serve. */
export const RSS_COMMUNITY = 'gaming'
export const RSS_AUTHOR_HANDLE = 'rss-author.test'

const RSS_AUTHOR = {
  did: 'did:plc:rssauthorabcdefghijklm',
  handle: RSS_AUTHOR_HANDLE,
  displayName: 'RSS Author',
}

const RSS_POST = {
  uri: 'at://did:plc:rssauthorabcdefghijklm/social.coves.community.post/rsspost',
  cid: 'bafyreirsspostaaaaaaaa',
  rkey: 'rsspost',
  indexedAt: '2026-08-31T00:00:00.000Z',
  createdAt: '2026-08-31T00:00:00.000Z',
  author: RSS_AUTHOR,
  community: {
    did: 'did:plc:gamingcommunityabcdefgh',
    handle: 'c-gaming.coves.social',
    name: RSS_COMMUNITY,
    origin: 'coves.social',
  },
  record: {
    $type: 'social.coves.community.post',
    community: 'did:plc:gamingcommunityabcdefgh',
    author: RSS_AUTHOR.did,
    createdAt: '2026-08-31T00:00:00.000Z',
    title: 'RSS fixture post',
    content: 'Served to the **RSS** feeds.',
  },
  stats: { upvotes: 1, downvotes: 0, score: 1, commentCount: 1 },
  viewer: { saved: false },
}

/** A faceted post whose first image is placed mid-body by an `#image` facet
 * over "[kite]" (bytes 17-23) and whose second image stays in the gallery. */
export const RSS_IMAGE_POST_URI =
  'at://did:plc:rssauthorabcdefghijklm/social.coves.community.post/rssimagepost'
export const RSS_IMAGE_POST_KITE =
  'https://img.coves.test/img/content_full/plain/did:plc:rssauthorabcdefghijklm/kite'
export const RSS_IMAGE_POST_HERON =
  'https://img.coves.test/img/content_full/plain/did:plc:rssauthorabcdefghijklm/heron'

const RSS_IMAGE_POST = {
  ...RSS_POST,
  uri: RSS_IMAGE_POST_URI,
  cid: 'bafyreirssimagepostaaa',
  rkey: 'rssimagepost',
  record: {
    ...RSS_POST.record,
    title: 'RSS image fixture post',
    content: 'Before the photo\n[kite]\nAfter the photo',
    facets: [
      {
        index: { byteStart: 17, byteEnd: 23 },
        features: [{ $type: 'social.coves.richtext.facet#image', index: 0 }],
      },
    ],
  },
  embed: {
    $type: 'social.coves.embed.images#view',
    images: [
      { fullsize: RSS_IMAGE_POST_KITE, alt: 'Kite' },
      { fullsize: RSS_IMAGE_POST_HERON, alt: 'Heron' },
    ],
  },
}

const RSS_COMMENT = {
  uri: 'at://did:plc:rssauthorabcdefghijklm/social.coves.community.comment/rsscomment',
  cid: 'bafyreirsscommentaaaaa',
  createdAt: '2026-09-01T00:00:00.000Z',
  indexedAt: '2026-09-01T00:00:00.000Z',
  record: {
    $type: 'social.coves.community.comment',
    content: 'An RSS fixture comment.',
    reply: {
      root: { uri: RSS_POST.uri, cid: RSS_POST.cid },
      parent: { uri: RSS_POST.uri, cid: RSS_POST.cid },
    },
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  author: RSS_AUTHOR,
  post: { uri: RSS_POST.uri, cid: RSS_POST.cid },
  stats: { upvotes: 0, downvotes: 0, score: 0, replyCount: 0 },
}

/**
 * The at-tags fixtures: one community, a post author and a commenter with
 * three distinct DIDs, so a page that emits the wrong DID in a tag cannot
 * pass by coincidence. Each author has a usable handle, so the post and
 * comment pages' canonical owner/commenter segments are those handles
 * (`resolveHandle` below answers them).
 */
const AT_TAGS_COMMUNITY_DID = 'did:plc:attagscommunityabcdefgh'
const AT_TAGS_AUTHOR_DID = 'did:plc:attagsauthorabcdefghijk'
const AT_TAGS_COMMENTER_DID = 'did:plc:attagscommenterabcdefgh'

const AT_TAGS_HANDLES: Record<string, string> = {
  'attags-author.test': AT_TAGS_AUTHOR_DID,
  'attags-commenter.test': AT_TAGS_COMMENTER_DID,
}

const AT_TAGS_AUTHOR = {
  did: AT_TAGS_AUTHOR_DID,
  handle: 'attags-author.test',
  displayName: 'At-tags Author',
}

const AT_TAGS_COMMENTER = {
  did: AT_TAGS_COMMENTER_DID,
  handle: 'attags-commenter.test',
  displayName: 'At-tags Commenter',
}

const AT_TAGS_COMMUNITY_REF = {
  did: AT_TAGS_COMMUNITY_DID,
  handle: 'c-attags.coves.social',
  name: 'attags',
  origin: 'coves.social',
}

/**
 * Profile views keyed by the `actor` param the profile page sends, each with a
 * DID no other fixture uses. Their posts and comments tabs are empty. The
 * suspended one is the reduced view the AppView serves other viewers of a
 * banned account: no display name or description, zero stats.
 */
const AT_TAGS_PROFILES: Record<string, unknown> = {
  'attags-profile.test': {
    did: 'did:plc:attagsprofileabcdefghij',
    handle: 'attags-profile.test',
    displayName: 'At-tags Profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    stats: {
      postCount: 0,
      commentCount: 0,
      communityCount: 0,
      reputation: 0,
      membershipCount: 0,
    },
  },
  'attags-suspended.test': {
    did: 'did:plc:attagssuspendedabcdefgh',
    handle: 'attags-suspended.test',
    createdAt: '2026-01-01T00:00:00.000Z',
    accountStatus: 'suspended',
    stats: {
      postCount: 0,
      commentCount: 0,
      communityCount: 0,
      reputation: 0,
      membershipCount: 0,
    },
  },
}

function atTagsCommunityView(overrides: Record<string, unknown>) {
  return {
    ...AT_TAGS_COMMUNITY_REF,
    displayName: 'At-tags Community',
    description: 'At-tags fixture community',
    subscriberCount: 1,
    memberCount: 1,
    postCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    allowExternalDiscovery: true,
    visibility: 'public',
    ...overrides,
  }
}

/** Community views keyed by the `community` param the page sends. */
const AT_TAGS_COMMUNITIES: Record<string, unknown> = {
  'attags@coves.social': atTagsCommunityView({}),
  // An instance-removed community: the AppView withholds its presentation.
  'attagsremoved@coves.social': {
    ...atTagsCommunityView({
      did: 'did:plc:attagsremovedcommunityab',
      handle: 'c-attagsremoved.coves.social',
      name: 'attagsremoved',
      status: 'removed',
    }),
    displayName: undefined,
    description: undefined,
  },
  'attagsprivate@coves.social': atTagsCommunityView({
    did: 'did:plc:attagsprivatecommunityab',
    handle: 'c-attagsprivate.coves.social',
    name: 'attagsprivate',
    displayName: 'At-tags Private Community',
    visibility: 'private',
  }),
  // A public community whose view omits `visibility` altogether.
  'attagsnovisibility@coves.social': atTagsCommunityView({
    did: 'did:plc:attagsnovisibilitycommun',
    handle: 'c-attagsnovisibility.coves.social',
    name: 'attagsnovisibility',
    displayName: 'At-tags No-visibility Community',
    visibility: undefined,
  }),
  'attagsunlisted@coves.social': atTagsCommunityView({
    did: 'did:plc:attagsunlistedcommunitya',
    handle: 'c-attagsunlisted.coves.social',
    name: 'attagsunlisted',
    displayName: 'At-tags Unlisted Community',
    visibility: 'unlisted',
  }),
}

function atTagsPostView(uri: string, title: string, extra = {}) {
  return {
    uri,
    cid: 'bafyreiattagspostaaaaaa',
    rkey: uri.split('/').at(-1),
    indexedAt: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    author: AT_TAGS_AUTHOR,
    community: AT_TAGS_COMMUNITY_REF,
    record: {
      $type: 'social.coves.community.post',
      community: AT_TAGS_COMMUNITY_DID,
      author: AT_TAGS_AUTHOR_DID,
      createdAt: '2026-10-01T00:00:00.000Z',
      title,
      content: `${title} body.`,
    },
    stats: { upvotes: 1, downvotes: 0, score: 1, commentCount: 0 },
    viewer: { saved: false },
    ...extra,
  }
}

const AT_TAGS_POST_URI =
  'at://did:plc:attagsauthorabcdefghijk/social.coves.community.postv2/attagspost'
/** A community-owned legacy post: its repo DID is the community's, not the author's. */
const AT_TAGS_LEGACY_POST_URI =
  'at://did:plc:attagscommunityabcdefgh/social.coves.community.post/attagslegacy'
const AT_TAGS_MODERATION_REMOVED_POST_URI =
  'at://did:plc:attagsauthorabcdefghijk/social.coves.community.postv2/attagsmodremoved'

const atTagsSentinelUri = (rkey: string) =>
  `at://did:plc:attagsauthorabcdefghijk/social.coves.community.postv2/${rkey}`

/** `post.get` answers keyed by URI; any other URI is `notFound`. */
const AT_TAGS_POSTS: Record<string, unknown> = {
  [AT_TAGS_POST_URI]: atTagsPostView(AT_TAGS_POST_URI, 'At-tags ordinary post'),
  [AT_TAGS_LEGACY_POST_URI]: atTagsPostView(
    AT_TAGS_LEGACY_POST_URI,
    'At-tags legacy post',
  ),
  // Hydrated, but an instance moderation action removed it.
  [AT_TAGS_MODERATION_REMOVED_POST_URI]: atTagsPostView(
    AT_TAGS_MODERATION_REMOVED_POST_URI,
    'At-tags moderation-removed post',
    {
      moderation: {
        state: 'removed',
        sources: [
          {
            authorityDid: 'did:plc:attagsinstanceabcdefghi',
            scope: { kind: 'instance' },
          },
        ],
      },
    },
  ),
  [atTagsSentinelUri('attagsremoved')]: {
    uri: atTagsSentinelUri('attagsremoved'),
    removed: true,
  },
  [atTagsSentinelUri('attagsblocked')]: {
    uri: atTagsSentinelUri('attagsblocked'),
    blocked: true,
    author: { did: AT_TAGS_AUTHOR_DID },
  },
  [atTagsSentinelUri('attagsmoderated')]: {
    $type: 'social.coves.community.post.defs#moderatedPost',
    uri: atTagsSentinelUri('attagsmoderated'),
    moderation: {
      state: 'removed',
      sources: [
        {
          authorityDid: 'did:plc:attagsinstanceabcdefghi',
          scope: { kind: 'instance' },
        },
      ],
    },
    authorDid: AT_TAGS_AUTHOR_DID,
    community: AT_TAGS_COMMUNITY_REF,
  },
}

const AT_TAGS_POST_REF = {
  uri: AT_TAGS_POST_URI,
  cid: 'bafyreiattagspostaaaaaa',
}

const AT_TAGS_PARENT_COMMENT_URI =
  'at://did:plc:attagsauthorabcdefghijk/social.coves.community.comment/attagsparent'
const AT_TAGS_PARENT_COMMENT_REF = {
  uri: AT_TAGS_PARENT_COMMENT_URI,
  cid: 'bafyreiattagsparentaaaa',
}

const atTagsCommentUri = (rkey: string) =>
  `at://did:plc:attagscommenterabcdefgh/social.coves.community.comment/${rkey}`

function atTagsComment(rkey: string, extra: Record<string, unknown> = {}) {
  return {
    uri: atTagsCommentUri(rkey),
    cid: 'bafyreiattagscommentaaa',
    createdAt: '2026-10-02T00:00:00.000Z',
    indexedAt: '2026-10-02T00:00:00.000Z',
    record: {
      $type: 'social.coves.community.comment',
      content: 'An at-tags fixture reply to a comment.',
      reply: { root: AT_TAGS_POST_REF, parent: AT_TAGS_PARENT_COMMENT_REF },
      createdAt: '2026-10-02T00:00:00.000Z',
    },
    author: AT_TAGS_COMMENTER,
    post: AT_TAGS_POST_REF,
    parent: AT_TAGS_PARENT_COMMENT_REF,
    stats: { upvotes: 0, downvotes: 0, score: 0, replyCount: 0 },
    ...extra,
  }
}

/** Focused comments under `AT_TAGS_POST_URI`, keyed by `parentRkey`. */
const AT_TAGS_COMMENTS: Record<string, unknown> = {
  // Live, and a reply to another comment rather than to the post.
  attagsreply: atTagsComment('attagsreply'),
  // A tombstone as current backends serve it: no author, no record.
  attagsdeleted: atTagsComment('attagsdeleted', {
    isDeleted: true,
    deletionReason: 'author',
    deletedAt: '2026-10-03T00:00:00.000Z',
    record: undefined,
    author: undefined,
  }),
  // A tombstone that still carries its author and record.
  attagsdeletedkept: atTagsComment('attagsdeletedkept', {
    isDeleted: true,
    deletionReason: 'author',
    deletedAt: '2026-10-03T00:00:00.000Z',
  }),
  // No record and no author, but not marked deleted either.
  attagsnorecord: atTagsComment('attagsnorecord', {
    record: undefined,
    author: undefined,
  }),
  // Live, but an instance moderation action removed it.
  attagsmodremovedcomment: atTagsComment('attagsmodremovedcomment', {
    moderation: {
      state: 'removed',
      sources: [
        {
          authorityDid: 'did:plc:attagsinstanceabcdefghi',
          scope: { kind: 'instance' },
        },
      ],
    },
  }),
}

const AT_TAGS_MODERATION_REMOVED_POST_REF = {
  uri: AT_TAGS_MODERATION_REMOVED_POST_URI,
  cid: 'bafyreiattagspostaaaaaa',
}

/** Focused comments under `AT_TAGS_MODERATION_REMOVED_POST_URI`. */
const AT_TAGS_MODERATION_REMOVED_POST_COMMENTS: Record<string, unknown> = {
  // Live, a direct reply to the moderation-removed post.
  attagsundermodremoved: atTagsComment('attagsundermodremoved', {
    record: {
      $type: 'social.coves.community.comment',
      content: 'An at-tags fixture reply to a moderation-removed post.',
      reply: {
        root: AT_TAGS_MODERATION_REMOVED_POST_REF,
        parent: AT_TAGS_MODERATION_REMOVED_POST_REF,
      },
      createdAt: '2026-10-02T00:00:00.000Z',
    },
    post: AT_TAGS_MODERATION_REMOVED_POST_REF,
    parent: AT_TAGS_MODERATION_REMOVED_POST_REF,
  }),
}

/** Focused-comment maps keyed by the post URI they sit under. */
const AT_TAGS_COMMENTS_BY_POST: Record<string, Record<string, unknown>> = {
  [AT_TAGS_POST_URI]: AT_TAGS_COMMENTS,
  [AT_TAGS_MODERATION_REMOVED_POST_URI]:
    AT_TAGS_MODERATION_REMOVED_POST_COMMENTS,
}

/**
 * `community.comment.getComments` for the at-tags posts: with `parentRkey`,
 * the one focused comment's subtree; without it, an empty thread. Any other
 * post or rkey is a 404 the way the backend reports one.
 */
function atTagsGetComments(query: URLSearchParams): {
  status: number
  body: unknown
} {
  const postUri = query.get('post') ?? ''
  const post = AT_TAGS_POSTS[postUri] as { author?: unknown } | undefined
  if (post?.author === undefined) {
    return {
      status: 404,
      body: { error: 'RootNotFound', message: `no thread ${postUri}` },
    }
  }
  const parentRkey = query.get('parentRkey')
  if (parentRkey === null) return { status: 200, body: { post, comments: [] } }
  const comment = AT_TAGS_COMMENTS_BY_POST[postUri]?.[parentRkey]
  if (comment === undefined) {
    return {
      status: 404,
      body: { error: 'ParentNotFound', message: `no comment ${parentRkey}` },
    }
  }
  return { status: 200, body: { post, comments: [{ comment, replies: [] }] } }
}

/** `resolveHandle` for the at-tags authors, a 400 `InvalidRequest` otherwise. */
function atTagsResolveHandle(query: URLSearchParams): {
  status: number
  body: unknown
} {
  const did = AT_TAGS_HANDLES[query.get('handle') ?? '']
  return did === undefined
    ? {
        status: 400,
        body: { error: 'InvalidRequest', message: 'Unable to resolve handle' },
      }
    : { status: 200, body: { did } }
}

/** At-tags XRPC routes that answer with a status of their own. */
const AT_TAGS_ROUTES: Record<
  string,
  (query: URLSearchParams) => { status: number; body: unknown }
> = {
  '/xrpc/social.coves.community.comment.getComments': atTagsGetComments,
  '/xrpc/com.atproto.identity.resolveHandle': atTagsResolveHandle,
}

/** JSON bodies for the RSS feeds' XRPC calls, keyed by path. */
const RSS_FIXTURES: Record<string, (query: URLSearchParams) => unknown> = {
  '/xrpc/social.coves.communityFeed.getCommunity': (query) =>
    (query.get('community') ?? '') in AT_TAGS_COMMUNITIES
      ? { feed: [] }
      : { feed: [{ post: RSS_POST }, { post: RSS_IMAGE_POST }] },
  '/xrpc/social.coves.community.get': (query) =>
    AT_TAGS_COMMUNITIES[query.get('community') ?? ''] ?? {
      did: RSS_POST.community.did,
      handle: RSS_POST.community.handle,
      name: RSS_COMMUNITY,
      origin: RSS_POST.community.origin,
      displayName: 'Gaming',
      description: 'RSS fixture community',
      subscriberCount: 1,
      memberCount: 1,
      postCount: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      allowExternalDiscovery: true,
      visibility: 'public',
    },
  // At-tags profiles first; a mock account's own handle or DID gets that
  // account's profile (no display name, so it shows as its handle); anything
  // else is the RSS author.
  '/xrpc/social.coves.actor.getProfile': (query) => {
    const actor = query.get('actor') ?? ''
    if (actor in AT_TAGS_PROFILES) return AT_TAGS_PROFILES[actor]
    const account = Object.values(MOCK_ACCOUNTS).find(
      (candidate) => candidate.handle === actor || candidate.did === actor,
    )
    if (account !== undefined) {
      return {
        did: account.did,
        handle: account.handle,
        createdAt: '2026-01-01T00:00:00.000Z',
      }
    }
    return {
      did: RSS_AUTHOR.did,
      handle: RSS_AUTHOR.handle,
      displayName: RSS_AUTHOR.displayName,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
  },
  '/xrpc/social.coves.actor.getPosts': (query) =>
    (query.get('actor') ?? '') in AT_TAGS_PROFILES
      ? { feed: [] }
      : { feed: [{ post: RSS_POST }] },
  '/xrpc/social.coves.actor.getComments': (query) =>
    (query.get('actor') ?? '') in AT_TAGS_PROFILES
      ? { comments: [] }
      : { comments: [RSS_COMMENT] },
  // Mirrors the requested `uris` 1:1, as the real batch endpoint does.
  '/xrpc/social.coves.community.post.get': (query) => ({
    posts: query.getAll('uris').map(
      (uri) =>
        (uri === RSS_POST.uri ? RSS_POST : AT_TAGS_POSTS[uri]) ?? {
          uri,
          notFound: true,
        },
    ),
  }),
}

/** One inbound XRPC call, as the upstream saw it. */
export interface XrpcRequest {
  readonly path: string
  /** The inbound `Authorization` header verbatim, or null if there was none. */
  readonly authorization: string | null
  /** The inbound `Cookie` header verbatim, or null if there was none. */
  readonly cookie: string | null
}

/** One body a write endpoint received, as the upstream saw it. */
export interface ReceivedBody {
  readonly path: string
  /** The inbound `Content-Type` header verbatim, or null if there was none. */
  readonly contentType: string | null
  /** Bytes actually received, not the declared `Content-Length`. */
  readonly size: number
  /** Lowercase hex SHA-256 of the received bytes. */
  readonly sha256: string
  /** The body parsed as JSON when it was sent as JSON, otherwise null. */
  readonly json: unknown
}

/** The write endpoints whose bodies are recorded, with the JSON they answer. */
const WRITE_ENDPOINTS: Record<string, unknown> = {
  '/xrpc/social.coves.media.uploadImage': {
    blob: {
      $type: 'blob',
      ref: { $link: 'bafkreiuploadedimageaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      mimeType: 'image/jpeg',
      size: 0,
    },
  },
  '/xrpc/social.coves.actor.updateProfile': {
    uri: 'at://did:plc:abcdefghijklmnopqrstuvwx/social.coves.actor.profile/self',
    cid: 'bafyreiupdatedprofileaaaa',
  },
}

export interface MockUpstream {
  /** Origin the built server should be pointed at, e.g. `http://127.0.0.1:51234`. */
  readonly url: string
  /** Distinct `METHOD /path` strings the mock did not recognise. */
  readonly unknownPaths: readonly string[]
  close(): Promise<void>
}

// Deliberately no Access-Control-Allow-Origin: the real internal AppView does
// not emit one on XRPC responses, and SSR must still be able to consume them.
const BASE_HEADERS = {
  'content-type': 'application/json',
} as const

export async function startMockUpstream(): Promise<MockUpstream> {
  const unknownPaths: string[] = []

  const xrpcRequests: XrpcRequest[] = []

  const receivedBodies: ReceivedBody[] = []

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://upstream.invalid')
    const path = url.pathname

    // Control plane. Not part of the backend's surface, so it is checked
    // before anything else and never counts as an unknown path.
    if (path === XRPC_LOG_PATH) {
      if (req.method === 'DELETE') {
        xrpcRequests.length = 0
        res.writeHead(200, BASE_HEADERS)
        res.end(JSON.stringify({ ok: true }))
        return
      }
      res.writeHead(200, BASE_HEADERS)
      res.end(JSON.stringify({ requests: xrpcRequests }))
      return
    }

    if (path === UNKNOWN_PATHS_PATH) {
      if (req.method === 'DELETE') {
        unknownPaths.length = 0
        res.writeHead(200, BASE_HEADERS)
        res.end(JSON.stringify({ ok: true }))
        return
      }
      res.writeHead(200, BASE_HEADERS)
      res.end(JSON.stringify({ paths: [...new Set(unknownPaths)] }))
      return
    }

    if (path === RECEIVED_BODIES_PATH) {
      if (req.method === 'DELETE') {
        receivedBodies.length = 0
        res.writeHead(200, BASE_HEADERS)
        res.end(JSON.stringify({ ok: true }))
        return
      }
      res.writeHead(200, BASE_HEADERS)
      res.end(JSON.stringify({ bodies: receivedBodies }))
      return
    }

    if (path.startsWith('/xrpc/')) {
      // Recorded before the route check so an unmocked XRPC path still shows
      // up here rather than vanishing into the 404 branch.
      xrpcRequests.push({
        path,
        authorization: req.headers.authorization ?? null,
        cookie: req.headers.cookie ?? null,
      })
    }

    if (path === '/api/me') {
      const key = /coves_session=([^;]*)/.exec(req.headers.cookie ?? '')?.[1]
      const identity =
        key !== undefined && key in MOCK_ACCOUNTS
          ? MOCK_ACCOUNTS[key as MockAccountKey]
          : undefined
      if (identity === undefined) {
        res.writeHead(401, BASE_HEADERS)
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
      res.writeHead(200, BASE_HEADERS)
      res.end(JSON.stringify(identity))
      return
    }

    if (
      path === '/xrpc/social.coves.feed.getDiscover' ||
      path === '/xrpc/social.coves.feed.getTimeline'
    ) {
      const audience =
        req.headers.authorization === 'Bearer a'
          ? 'a'
          : req.headers.authorization === 'Bearer b'
            ? 'b'
            : 'anonymous'
      res.writeHead(200, BASE_HEADERS)
      res.end(
        JSON.stringify({
          feed: [
            {
              post: {
                uri: 'at://did:plc:abcdefghijklmnopqrstuvwx/social.coves.community.post/ssrfeed',
                cid: 'bafyreigh2akiscaildc',
                rkey: 'ssrfeed',
                indexedAt: '2026-08-31T00:00:00.000Z',
                createdAt: '2026-08-31T00:00:00.000Z',
                author: {
                  did: 'did:plc:feedauthorabcdefghijkl',
                  handle: 'feed-author.test',
                },
                community: {
                  did: 'did:plc:communityabcdefghijkl',
                  handle: 'general.coves.social',
                  name: 'general',
                  origin: 'coves.social',
                },
                record: {
                  $type: 'social.coves.community.post',
                  community: 'did:plc:communityabcdefghijkl',
                  author: 'did:plc:feedauthorabcdefghijkl',
                  createdAt: '2026-08-31T00:00:00.000Z',
                  title: `${SSR_POST_MARKER} [${audience}]`,
                  content: 'Rendered during the initial server request.',
                },
                stats: {
                  upvotes: 1,
                  downvotes: 0,
                  score: 1,
                  commentCount: 0,
                },
                viewer: { saved: false },
              },
            },
          ],
        }),
      )
      return
    }

    if (path === '/xrpc/social.coves.community.list') {
      res.writeHead(200, BASE_HEADERS)
      res.end(
        JSON.stringify({
          communities: [
            {
              did: 'did:plc:communityabcdefghijkl',
              name: 'general',
              handle: 'general.coves.social',
              displayName: SSR_COMMUNITY_MARKER,
              origin: 'coves.social',
              subscriberCount: 12,
              memberCount: 12,
              postCount: 1,
              visibility: 'public',
            },
          ],
        }),
      )
      return
    }

    const writeResponse = WRITE_ENDPOINTS[path]
    if (req.method === 'POST' && writeResponse !== undefined) {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        const contentType = req.headers['content-type'] ?? null
        receivedBodies.push({
          path,
          contentType,
          size: body.length,
          sha256: createHash('sha256').update(body).digest('hex'),
          json: contentType?.startsWith('application/json')
            ? (JSON.parse(body.toString('utf8')) as unknown)
            : null,
        })
        res.writeHead(200, BASE_HEADERS)
        res.end(JSON.stringify(writeResponse))
      })
      return
    }

    const atTagsRoute = AT_TAGS_ROUTES[path]
    if (atTagsRoute !== undefined) {
      const { status, body } = atTagsRoute(url.searchParams)
      res.writeHead(status, BASE_HEADERS)
      res.end(JSON.stringify(body))
      return
    }

    const rssFixture = RSS_FIXTURES[path]
    if (rssFixture !== undefined) {
      res.writeHead(200, BASE_HEADERS)
      res.end(JSON.stringify(rssFixture(url.searchParams)))
      return
    }

    unknownPaths.push(`${req.method ?? 'GET'} ${path}`)
    res.writeHead(404, BASE_HEADERS)
    res.end(JSON.stringify({ error: 'NotFound', message: `no route ${path}` }))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    get unknownPaths() {
      return [...new Set(unknownPaths)]
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  }
}
