// Coves API data model types, derived from Go backend structs in:
// github.com/coves-social/coves/internal/core/{posts,communities,comments,users,votes,discover,timeline,communityFeeds}
import type { DID, Handle } from '$lib/types/atproto'

// ---------------------------------------------------------------------------
// Branded primitives
// ---------------------------------------------------------------------------

export type AtUri = string & { readonly __brand: 'AtUri' }

export type CID = string & { readonly __brand: 'CID' }

export function isValidAtUri(value: string): value is AtUri {
  return /^at:\/\/did:[a-z]+:[a-zA-Z0-9._:%-]+(\/[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)?)?$/.test(
    value,
  )
}

export function asAtUri(value: string): AtUri {
  if (!isValidAtUri(value)) throw new Error(`Invalid AT-URI format: ${value}`)
  return value
}

export function tryAsAtUri(value: string): AtUri | null {
  return isValidAtUri(value) ? value : null
}

export interface ParsedAtUri {
  did: DID
  collection: string
  rkey: string
}

export function parseAtUri(uri: AtUri): ParsedAtUri {
  const str = (uri as string).replace('at://', '')
  const segments = str.split('/')
  if (segments.length < 3) {
    throw new Error(
      `Malformed AT-URI: expected at least 3 path segments (did/collection/rkey), got ${segments.length} in "${uri}"`,
    )
  }
  const [did, collection, rkey] = segments
  return { did: did as DID, collection, rkey }
}

export function isValidCID(value: string): value is CID {
  // Permissive check: CIDs can be multibase-encoded (base32, base58btc, base64, etc.)
  // Full validation would require decoding; this just rejects obviously invalid strings.
  // Real CIDs are at least 8 characters (multicodec prefix + hash digest).
  return value.length >= 8 && /^[a-zA-Z0-9+/=]+$/.test(value)
}

export function asCID(value: string): CID {
  if (!isValidCID(value)) throw new Error(`Invalid CID format: ${value}`)
  return value
}

export function tryAsCID(value: string): CID | null {
  return isValidCID(value) ? value : null
}

// ---------------------------------------------------------------------------
// Record types — the actual atProto records stored in repositories
// ---------------------------------------------------------------------------

export interface PostRecord {
  $type: 'social.coves.community.post'
  community: string
  author: string
  createdAt: string
  title?: string
  content?: string
  embed?: Record<string, unknown>
  labels?: unknown
  facets?: unknown[]
  originalAuthor?: unknown
  federatedFrom?: unknown
  location?: unknown
}

export interface CommentRecord {
  $type: 'social.coves.community.comment'
  content: string
  reply: { root: StrongRef; parent: StrongRef }
  createdAt: string
  facets?: unknown[]
  langs?: string[]
  embed?: unknown
  labels?: unknown
}

// ---------------------------------------------------------------------------
// Core view types — posts
// ---------------------------------------------------------------------------

export interface AuthorView {
  did: DID
  handle: Handle
  displayName?: string
  avatar?: string
  reputation?: number
}

export interface CommunityRef {
  did: DID
  handle: Handle
  name: string
  avatar?: string
}

export interface PostStats {
  upvotes: number
  downvotes: number
  score: number
  commentCount: number
  shareCount?: number
  tagCounts?: Record<string, number>
}

// TODO: Refactor to a discriminated union to enforce vote/voteUri correlation:
//   { vote: 'up' | 'down'; voteUri: AtUri } | { vote?: undefined; voteUri?: undefined }
// Blocked by PostVote.svelte castVote() which independently mutates vote and voteUri
// on a spread copy, which is incompatible with discriminated union assignment rules.
export interface PostViewerState {
  saved: boolean
  vote?: 'up' | 'down'
  voteUri?: AtUri
  savedUri?: AtUri
  tags?: string[]
}

export interface PostView {
  uri: AtUri
  cid: CID
  rkey: string
  indexedAt: string
  createdAt: string
  author: AuthorView
  community: CommunityRef
  editedAt?: string
  language?: string
  record?: PostRecord
  embed?: PostEmbed
  viewer?: PostViewerState
  stats?: PostStats
}

/** A requested post that could not be hydrated (deleted/unindexed/unresolvable). */
export interface NotFoundPost {
  uri: AtUri
  notFound: true
}

/**
 * A requested post withheld because the viewer blocks its author. Emitted by the
 * backend's blocked-by-author path. The response preserves the requested URI's
 * position in the `posts` array.
 */
export interface BlockedPost {
  uri: AtUri
  blocked: true
  blockedBy?: DID
  author?: { did: DID }
}

/**
 * One element of `getPosts` — either a hydrated post or an unavailable sentinel.
 * The response preserves the order of the requested URIs.
 */
export type PostViewUnion = PostView | NotFoundPost | BlockedPost

/**
 * Discriminates a hydrated post from the unavailable sentinels. Mirrors the
 * backend's flag-based contract: each sentinel carries a documented const
 * discriminator (`notFound` / `blocked`) and a hydrated `PostView` carries
 * neither. We therefore treat the *absence* of every known unavailable flag as
 * "this is a post", which (a) narrows correctly via TS control flow and (b)
 * keeps a real-but-malformed post (e.g. one momentarily missing `cid`) from
 * being silently misclassified as removed. A future sentinel must register its
 * flag here, matching how the backend would emit it.
 */
export function isHydratedPost(
  el: PostViewUnion | null | undefined,
): el is PostView {
  return el != null && !('notFound' in el) && !('blocked' in el)
}

// ---------------------------------------------------------------------------
// Feed wrapper types
// ---------------------------------------------------------------------------

export interface FeedViewPost {
  post: PostView
  reason?: FeedReason
  reply?: ReplyRef
}

export interface ReasonRepost {
  $type: 'social.coves.feed.defs#reasonRepost'
  by: AuthorView
  indexedAt: string
}

export interface ReasonPin {
  $type: 'social.coves.feed.defs#reasonPin'
  community: CommunityRef
}

export type FeedReason = ReasonRepost | ReasonPin

export interface ReplyRef {
  root: PostRef
  parent: PostRef
}

export interface PostRef {
  uri: AtUri
  cid: CID
}

// ---------------------------------------------------------------------------
// Core view types — communities
// ---------------------------------------------------------------------------

export type CommunityVisibility = 'public' | 'unlisted' | 'private'

export interface CommunityViewerState {
  subscribed?: boolean
  member?: boolean
}

export interface CommunityView {
  did: DID
  name: string
  subscriberCount: number
  memberCount: number
  postCount: number
  handle?: Handle
  displayName?: string
  displayHandle?: string
  avatar?: string
  visibility?: CommunityVisibility
  viewer?: CommunityViewerState
}

export interface CommunityViewDetailed extends CommunityView {
  createdAt: string
  allowExternalDiscovery: boolean
  description?: string
  banner?: string
  createdBy?: DID
  hostedBy?: DID
  moderationType?: 'open' | 'restricted' | 'approval'
  contentWarnings?: string[]
}

// ---------------------------------------------------------------------------
// Core view types — comments
// ---------------------------------------------------------------------------

export interface CommentRef {
  uri: AtUri
  cid: CID
}

export interface CommentStats {
  upvotes: number
  downvotes: number
  score: number
  replyCount: number
}

// TODO: Refactor to a discriminated union to enforce vote/voteUri correlation:
//   { vote: 'up' | 'down'; voteUri: AtUri } | { vote?: undefined; voteUri?: undefined }
// Blocked by CommentVote.svelte castVote() which independently mutates vote and voteUri
// on a spread copy, which is incompatible with discriminated union assignment rules.
export interface CommentViewerState {
  vote?: 'up' | 'down'
  voteUri?: AtUri
}

export interface CommentView {
  uri: AtUri
  cid: CID
  createdAt: string
  indexedAt: string
  /**
   * The comment's record. The server omits this field entirely for
   * deleted-comment tombstones (older backends returned `null`), so
   * consumers must handle the absent/null case (or consume the normalized
   * `CommentNodeI.comment`, whose record is guaranteed non-null by
   * `buildCommentsTree`). Note that `isDeleted` alone is not a reliable
   * discriminant: deleted comments can still arrive with a record.
   */
  record?: CommentRecord | null
  /**
   * The comment's author. The server omits this field entirely for
   * deleted-comment tombstones (older backends returned a real DID with an
   * empty handle) so deleted-comment authors stay anonymous. Present on all
   * non-deleted comments.
   */
  author?: AuthorView
  post: CommentRef
  stats: CommentStats
  embed?: PostEmbed
  viewer?: CommentViewerState
  parent?: CommentRef
  isDeleted?: boolean
  deletionReason?: string
  deletedAt?: string
}

/**
 * Discriminates a CommentView from a PostView. Invariant: `CommentView`
 * carries a required `post: CommentRef` back-reference while `PostView` has
 * no `post` field. If `PostView` ever gains a `post` field, this guard (and
 * its pinning test in types.test.ts) must be updated.
 */
export function isCommentView(
  item: PostView | CommentView,
): item is CommentView {
  return 'post' in item
}

export interface ThreadViewComment {
  comment: CommentView
  replies?: ThreadViewComment[]
  hasMore?: boolean
}

// ---------------------------------------------------------------------------
// Core view types — users / profiles
// ---------------------------------------------------------------------------

export interface ProfileStats {
  postCount: number
  commentCount: number
  communityCount: number
  reputation: number
  membershipCount: number
}

export interface ProfileViewerState {
  blocking?: AtUri
}

export interface ProfileViewDetailed {
  did: DID
  createdAt: string
  handle?: Handle
  displayName?: string
  description?: string
  avatar?: string
  banner?: string
  stats?: ProfileStats
  viewer?: ProfileViewerState
}

// ---------------------------------------------------------------------------
// Core view types — votes
// ---------------------------------------------------------------------------

export interface StrongRef {
  uri: AtUri
  cid: CID
}

// ---------------------------------------------------------------------------
// Embed types (discriminated union via $type)
// ---------------------------------------------------------------------------

export interface EmbedImageAspectRatio {
  width: number
  height: number
}

export interface EmbedImage {
  image: string
  thumb?: string
  fullsize?: string
  alt?: string
  aspectRatio?: EmbedImageAspectRatio
}

export interface ImageEmbed {
  $type: 'social.coves.embed.images#view'
  images: [EmbedImage, ...EmbedImage[]]
}

export interface ExternalEmbedSource {
  uri: string
  title?: string
  domain?: string
  sourcePost?: StrongRef
}

export interface ExternalEmbedExternal {
  uri: string
  title?: string
  description?: string
  thumb?: string
  domain?: string
  embedType?: string
  provider?: string
  images?: EmbedImage[]
  totalCount?: number
  sources?: ExternalEmbedSource[]
}

export interface ExternalEmbed {
  $type: 'social.coves.embed.external' | 'social.coves.embed.external#view'
  external: ExternalEmbedExternal
}

export interface VideoEmbed {
  $type: 'social.coves.embed.video' | 'social.coves.embed.video#view'
  video: string
  thumbnail?: string
  alt?: string
  duration?: number
}

export interface RecordEmbed {
  $type:
    | 'social.coves.embed.post'
    | 'social.coves.embed.record'
    | 'social.coves.embed.record#view'
  post: StrongRef
  resolved?: unknown
}

export type PostEmbed = ImageEmbed | ExternalEmbed | VideoEmbed | RecordEmbed

// ---------------------------------------------------------------------------
// Request / response types — feeds
// ---------------------------------------------------------------------------

export interface FeedPaginationParams {
  sort?: string
  timeframe?: string
  limit?: number
  cursor?: string
}

export type GetDiscoverParams = FeedPaginationParams

export type GetTimelineParams = FeedPaginationParams

export interface GetCommunityFeedParams extends FeedPaginationParams {
  community: DID | Handle
}

export interface FeedResponse {
  feed: FeedViewPost[]
  cursor?: string
}

// ---------------------------------------------------------------------------
// Request / response types — comments
// ---------------------------------------------------------------------------

export interface GetCommentsParams {
  post: AtUri
  sort?: string
  depth?: number
  limit?: number
  cursor?: string
  /**
   * Scopes the response to a single subtree: when set, `comments` contains
   * exactly one top-level ThreadViewComment — the comment with this rkey —
   * with its descendants nested beneath it. `depth` is relative to that
   * comment and `cursor` paginates its direct replies. An unknown rkey
   * yields an HTTP 404 with error name `ParentNotFound`.
   */
  parentRkey?: string
}

export interface GetCommentsResponse {
  // The backend returns the full hydrated post here, not just a strong ref —
  // so it could serve as a fallback source for the post on the permalink page.
  post: PostView
  comments: ThreadViewComment[]
  cursor?: string
}

// ---------------------------------------------------------------------------
// Request / response types — actors / profiles
// ---------------------------------------------------------------------------

export interface GetProfileParams {
  actor: DID | Handle
}

export interface GetActorPostsParams {
  actor: DID | Handle
  filter?: string
  community?: DID
  limit?: number
  cursor?: string
}

export interface GetActorPostsResponse {
  feed: FeedViewPost[]
  cursor?: string
}

export interface GetActorCommentsParams {
  actor: DID | Handle
  community?: DID
  limit?: number
  cursor?: string
}

export interface GetActorCommentsResponse {
  comments: CommentView[]
  cursor?: string
}

// ---------------------------------------------------------------------------
// Request / response types — communities
// ---------------------------------------------------------------------------

export interface GetCommunityParams {
  community: DID | Handle
}

export interface ListCommunitiesParams {
  sort?: 'popular' | 'active' | 'new' | 'alphabetical'
  visibility?: CommunityVisibility
  limit?: number
  cursor?: string
  category?: string
  language?: string
  subscribed?: boolean
}

export interface ListCommunitiesResponse {
  communities: CommunityView[]
  cursor?: string
}

export interface SearchCommunitiesParams {
  q: string
  visibility?: CommunityVisibility
  limit?: number
  cursor?: string
  category?: string
  language?: string
}

// ---------------------------------------------------------------------------
// Request / response types — votes
// ---------------------------------------------------------------------------

export interface CreateVoteInput {
  subject: StrongRef
  direction: 'up' | 'down'
}

export interface CreateVoteOutput {
  uri: AtUri
  cid: CID
}

export interface DeleteVoteInput {
  subject: StrongRef
}

// ---------------------------------------------------------------------------
// Request / response types — post retrieval
// ---------------------------------------------------------------------------

/** 1–25 URIs; the response `posts` array mirrors this order 1:1. */
export interface GetPostsParams {
  uris: AtUri[]
}

export interface GetPostsResponse {
  posts: PostViewUnion[]
}

// ---------------------------------------------------------------------------
// Request / response types — post creation
// ---------------------------------------------------------------------------

export interface CreatePostInput {
  community: DID
  title?: string
  content?: string
  embed?: unknown
  labels?: unknown
  facets?: unknown[]
}

export interface CreatePostOutput {
  uri: AtUri
  cid: CID
}

// ---------------------------------------------------------------------------
// Request / response types — comment creation
// ---------------------------------------------------------------------------

export interface CreateCommentInput {
  reply: {
    root: StrongRef
    parent: StrongRef
  }
  content: string
  facets?: unknown[]
  embed?: unknown
  langs?: string[]
  labels?: unknown
}

export interface CreateCommentOutput {
  uri: AtUri
  cid: CID
}

// ---------------------------------------------------------------------------
// Request / response types — comment editing
// ---------------------------------------------------------------------------

/**
 * Input for updating an existing comment.
 *
 * Omitted-field semantics: the backend treats the update as a full record
 * replacement, so any optional field left `undefined` (facets, embed, langs,
 * labels) is CLEARED on the server, not preserved. Callers that want to keep
 * an existing value must re-send it.
 *
 * Server-side validation errors callers should pre-validate against:
 * - `ContentEmpty` — `content` is empty or whitespace-only
 * - `ContentTooLong` — `content` exceeds the maximum allowed length
 */
export interface UpdateCommentInput {
  uri: AtUri
  content: string
  facets?: unknown[]
  embed?: unknown
  langs?: string[]
  labels?: unknown
}

export interface UpdateCommentOutput {
  uri: AtUri
  cid: CID
}

// ---------------------------------------------------------------------------
// Request / response types — community management
// ---------------------------------------------------------------------------

export interface CreateCommunityInput {
  name: string
  description: string
  visibility?: CommunityVisibility
  language?: string
  allowExternalDiscovery?: boolean
}

export interface CreateCommunityResponse {
  uri: AtUri
  cid: CID
  did: DID
  handle: Handle
}

export interface SubscribeCommunityInput {
  community: DID | Handle
}

export interface BlockCommunityInput {
  community: DID | Handle
}

// ---------------------------------------------------------------------------
// Request / response types — user blocking
// ---------------------------------------------------------------------------

export interface BlockUserInput {
  /** DID or handle of the user to (un)block. */
  subject: DID | Handle
}

export interface GetBlockedUsersParams {
  limit?: number
  offset?: number
}

export interface BlockedUserEntry {
  blockedDid: DID
  recordUri: AtUri
  recordCid: CID
  blockedAt: string
}

export interface GetBlockedUsersResponse {
  blocks: BlockedUserEntry[]
}

// ---------------------------------------------------------------------------
// Request / response types — admin reports
// ---------------------------------------------------------------------------

/**
 * Report reason categories accepted by `social.coves.admin.submitReport`,
 * in the display order presented to the user. Values and semantics must
 * match the backend enum (internal/core/adminreports/report.go) and the
 * mobile client's ReportDialog so all clients send identical payloads.
 * Human-readable labels/descriptions live in i18n under
 * `moderation.reportModal.reasons`.
 */
export const REPORT_REASONS = [
  'spam',
  'harassment',
  'doxing',
  'illegal',
  'csam',
  'other',
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]

/** Maximum characters allowed in a report explanation (backend-enforced). */
export const MAX_REPORT_EXPLANATION_LENGTH = 1000

/**
 * Input for `social.coves.admin.submitReport`.
 * The backend derives the target type (post/comment) from the AT-URI's
 * collection, so only the URI, reason, and optional explanation are sent.
 */
export interface SubmitReportInput {
  targetUri: AtUri
  reason: ReportReason
  explanation?: string
}

/** Output of `social.coves.admin.submitReport`. */
export interface SubmitReportOutput {
  /** Always `true`; the backend hardcodes it on the success path. */
  success: true
  reportId: number
}

// ---------------------------------------------------------------------------
// XRPC error response
// ---------------------------------------------------------------------------

export interface XrpcErrorResponse {
  error: string
  message: string
}
