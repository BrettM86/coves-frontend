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
  $type: string
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

export interface CommentViewerState {
  vote?: 'up' | 'down'
  voteUri?: AtUri
}

export interface CommentView {
  uri: AtUri
  cid: CID
  createdAt: string
  indexedAt: string
  record: CommentRecord
  author: AuthorView
  post: CommentRef
  stats: CommentStats
  embed?: PostEmbed
  viewer?: CommentViewerState
  parent?: CommentRef
  isDeleted?: boolean
  deletionReason?: string
  deletedAt?: string
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
  $type: 'social.coves.embed.external#view'
  external: ExternalEmbedExternal
}

export interface VideoEmbed {
  $type: 'social.coves.embed.video#view'
  video: string
  thumbnail?: string
  alt?: string
  duration?: number
}

export interface RecordEmbed {
  $type: 'social.coves.embed.record#view'
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
  community: DID
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
}

export interface GetCommentsResponse {
  post: PostRef
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
  community: DID
}

export interface ListCommunitiesParams {
  sort?: string
  visibility?: CommunityVisibility
  limit?: number
  offset?: number
}

export interface ListCommunitiesResponse {
  communities: CommunityView[]
}

export interface SearchCommunitiesParams {
  query: string
  visibility?: CommunityVisibility
  limit?: number
  offset?: number
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

export interface GetPostParams {
  uri: AtUri
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
// Request / response types — community management
// ---------------------------------------------------------------------------

export interface CreateCommunityInput {
  name: string
  description: string
  visibility: CommunityVisibility
  displayName?: string
  language?: string
  allowExternalDiscovery?: boolean
}

export interface SubscribeCommunityInput {
  community: DID
}

export interface BlockCommunityInput {
  community: DID
}

// ---------------------------------------------------------------------------
// Request / response types — user blocking
// ---------------------------------------------------------------------------

export interface BlockUserInput {
  did: DID
}

// ---------------------------------------------------------------------------
// XRPC error response
// ---------------------------------------------------------------------------

export interface XrpcErrorResponse {
  error: string
  message: string
}
