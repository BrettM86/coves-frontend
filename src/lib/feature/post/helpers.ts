import type {
  AtUri,
  PostEmbed,
  PostStats,
  PostViewerState,
} from '$lib/api/coves/types'
import { parseAtUri } from '$lib/api/coves/types'
import {
  canParseUrl,
  communitySlug,
  isImage,
  isVideo,
} from '$lib/app/util.svelte'
import {
  type ImagePreset,
  type ImageVariant,
  imageUrl,
  withPreset,
} from './image-proxy'

/**
 * Returns the best image URL for a post embed.
 *
 * @param embed - The post embed to extract an image URL from.
 * @param thumbnail - For external embeds only: when true, prefer the external
 *   embed's dedicated thumbnail over its URI. Has no effect on other embed types.
 * @param variant - For image embeds only: selects the 'thumb' (smaller) or
 *   'fullsize' proxy variant. Has no effect on other embed types.
 */
export const bestImageURL = (
  embed: PostEmbed | undefined,
  thumbnail: boolean = true,
  variant: ImageVariant = 'thumb',
): string => {
  if (!embed) return ''

  switch (embed.$type) {
    case 'social.coves.embed.images#view': {
      const img = embed.images[0]
      if (img) return imageUrl(img, variant)
      return ''
    }
    case 'social.coves.embed.external':
    case 'social.coves.embed.external#view': {
      if (embed.external.thumb && thumbnail) return embed.external.thumb
      return embed.external.uri ?? ''
    }
    case 'social.coves.embed.video':
    case 'social.coves.embed.video#view': {
      if (embed.thumbnail) return embed.thumbnail
      return ''
    }
    case 'social.coves.embed.post':
    case 'social.coves.embed.record':
    case 'social.coves.embed.record#view':
      return ''
    default: {
      const _exhaustive: never = embed
      return ''
    }
  }
}

/**
 * @deprecated Use `withPreset` from `./image-proxy` directly.
 */
export const optimizeImageURL = (
  url: string,
  preset: ImagePreset = 'content_preview',
): string => {
  return withPreset(url, preset)
}

const YOUTUBE_REGEX =
  /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|live\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})(?:\S+)?$/

export const isYoutubeLink = (url?: string): RegExpMatchArray | null => {
  if (!url) return null

  return url?.match?.(YOUTUBE_REGEX)
}

/** The ATProto collection NSID for Coves community posts. */
export const POST_COLLECTION = 'social.coves.community.post'

/**
 * Constructs the canonical DID-based AT-URI for a post.
 * Used as a fallback when navigating directly to a post (or comment permalink)
 * URL without a cache hit or an explicit `?uri=` param. Building it from the
 * community's DID (rather than its handle) keeps the hydration path stable
 * across community renames — the one handle→DID hop is resolved up front via
 * `getCommunity`.
 */
export function buildPostAtUri(communityDid: string, rkey: string): AtUri {
  return `at://${communityDid}/${POST_COLLECTION}/${rkey}` as AtUri
}

/**
 * Minimal shape {@link postLink} and {@link commentLink} need to build a
 * permalink: the post's AT-URI plus a community ref. Satisfied by a full
 * `PostView` (whose `community` is a `CommunityRef`) or a hand-built
 * `{ uri, community }` object.
 */
export interface PostLinkRef {
  uri: string
  community: {
    did: string
    handle?: string
    name: string
  }
}

/**
 * Builds the canonical Coves permalink for a post: `/c/<slug>/post/<rkey>`.
 *
 * Single source of truth for post URL generation — route every post link
 * through here instead of hand-rolling the path, so the URL scheme only ever
 * lives in one place. Accepts any object carrying the post's AT-URI and a
 * community ref (see {@link PostLinkRef}).
 *
 * The slug prefers the community's handle; when the handle is missing it
 * falls back to the community DID, which the `[handle=handle]` route matcher
 * accepts and the community loaders resolve — a bare `name` would 404 at
 * routing.
 *
 * @param includeUri - When true, appends `?uri=<canonical AT-URI>` to the path.
 *   The post page reads this param to load the post immediately, without a
 *   feed-cache hit or a backend handle→DID resolution — use it right after
 *   creating a post, when the new record is not yet in any feed cache.
 */
export function postLink(post: PostLinkRef, includeUri = false): string {
  const { rkey } = parseAtUri(post.uri as AtUri)
  const slug = post.community.handle
    ? communitySlug(post.community.handle)
    : post.community.did
  const path = `/c/${encodeURIComponent(slug)}/post/${encodeURIComponent(rkey)}`
  if (!includeUri) return path
  return `${path}?${new URLSearchParams({ uri: post.uri })}`
}

/**
 * Builds the canonical Coves permalink for a comment:
 * `/c/<slug>/post/<rkey>/comment/<crkey>`.
 *
 * Single source of truth for comment URL generation — route every comment
 * permalink through here instead of hand-rolling the path, mirroring
 * {@link postLink} (which it builds on for the post segment). Accepts any
 * object carrying the post's AT-URI and a community ref (see
 * {@link PostLinkRef}) plus the comment's AT-URI
 * (`at://<commenterDid>/social.coves.community.comment/<rkey>`), from which
 * the trailing rkey segment is derived.
 */
export function commentLink(post: PostLinkRef, commentUri: AtUri): string {
  const { rkey } = parseAtUri(commentUri)
  return `${postLink(post)}/comment/${encodeURIComponent(rkey)}`
}

export type MediaType = 'video' | 'image' | 'iframe' | 'embed' | 'none'
export type IframeType = 'youtube' | 'video' | 'none'

/**
 * Determines the media type from a Coves PostEmbed discriminated union.
 */
export function mediaType(embed?: PostEmbed): MediaType {
  if (!embed) return 'none'

  switch (embed.$type) {
    case 'social.coves.embed.images#view':
      return 'image'
    case 'social.coves.embed.video':
    case 'social.coves.embed.video#view':
      return 'iframe'
    case 'social.coves.embed.external':
    case 'social.coves.embed.external#view': {
      const uri = embed.external.uri
      if (!uri) return 'none'

      try {
        new URL(uri)
      } catch {
        return 'none'
      }

      if (isImage(uri)) return 'image'
      if (isVideo(uri)) return 'iframe'
      if (isYoutubeLink(uri)) return 'iframe'
      if (canParseUrl(uri)) return 'embed'
      return 'none'
    }
    case 'social.coves.embed.post':
    case 'social.coves.embed.record':
    case 'social.coves.embed.record#view':
      return 'embed'
    default: {
      const _exhaustive: never = embed
      return 'none'
    }
  }
}

export function iframeType(url: string): IframeType {
  if (isVideo(url)) return 'video'
  if (isYoutubeLink(url)) return 'youtube'
  return 'none'
}

/**
 * Extracts the primary URL from a PostEmbed, if any.
 */
export function extractEmbedUrl(embed?: PostEmbed): string | undefined {
  if (!embed) return undefined

  switch (embed.$type) {
    case 'social.coves.embed.images#view':
      return embed.images[0]?.image
    case 'social.coves.embed.external':
    case 'social.coves.embed.external#view':
      return embed.external.uri
    case 'social.coves.embed.video':
    case 'social.coves.embed.video#view':
      return embed.video
    case 'social.coves.embed.post':
    case 'social.coves.embed.record':
    case 'social.coves.embed.record#view':
      return undefined
    default: {
      const _exhaustive: never = embed
      return undefined
    }
  }
}

/**
 * Extracts the thumbnail URL from a PostEmbed, if any.
 */
export function extractEmbedThumbnail(embed?: PostEmbed): string | undefined {
  if (!embed) return undefined

  switch (embed.$type) {
    case 'social.coves.embed.images#view': {
      const img = embed.images[0]
      return img ? imageUrl(img, 'thumb') : undefined
    }
    case 'social.coves.embed.external':
    case 'social.coves.embed.external#view':
      return embed.external.thumb
    case 'social.coves.embed.video':
    case 'social.coves.embed.video#view':
      return embed.thumbnail
    case 'social.coves.embed.post':
    case 'social.coves.embed.record':
    case 'social.coves.embed.record#view':
      return undefined
    default: {
      const _exhaustive: never = embed
      return undefined
    }
  }
}

/**
 * Extracts the embed title from a PostEmbed, if any.
 */
export function extractEmbedTitle(embed?: PostEmbed): string | undefined {
  if (!embed) return undefined

  switch (embed.$type) {
    case 'social.coves.embed.external':
    case 'social.coves.embed.external#view':
      return embed.external.title
    case 'social.coves.embed.images#view':
    case 'social.coves.embed.video':
    case 'social.coves.embed.video#view':
    case 'social.coves.embed.post':
    case 'social.coves.embed.record':
    case 'social.coves.embed.record#view':
      return undefined
    default: {
      const _exhaustive: never = embed
      return undefined
    }
  }
}

/**
 * Extracts the alt text from the first image in an ImageEmbed, if any.
 */
export function extractEmbedAlt(embed?: PostEmbed): string | undefined {
  if (!embed) return undefined

  switch (embed.$type) {
    case 'social.coves.embed.images#view':
      return embed.images[0]?.alt
    case 'social.coves.embed.video':
    case 'social.coves.embed.video#view':
      return embed.alt
    case 'social.coves.embed.external':
    case 'social.coves.embed.external#view':
    case 'social.coves.embed.post':
    case 'social.coves.embed.record':
    case 'social.coves.embed.record#view':
      return undefined
    default: {
      const _exhaustive: never = embed
      return undefined
    }
  }
}

// ---------------------------------------------------------------------------
// Vote state calculation
// ---------------------------------------------------------------------------

export interface VoteState {
  stats: PostStats
  viewer: PostViewerState
}

/**
 * Computes the new vote state after a user likes or unlikes.
 *
 * Pure function: takes the current stats + viewer state and a vote direction,
 * returns the new stats + viewer state without mutating the inputs.
 * Only handles direction 'up' (like/unlike toggle).
 */
export function computeVoteState(
  currentStats: PostStats | undefined,
  currentViewer: PostViewerState | undefined,
  direction: 'up',
): VoteState {
  const stats = {
    ...(currentStats ?? {
      upvotes: 0,
      downvotes: 0,
      score: 0,
      commentCount: 0,
    }),
  }
  const viewer = { ...(currentViewer ?? { saved: false }) }

  const currentVote = currentViewer?.vote

  if (currentVote === 'up') {
    // Unlike: toggle off existing like
    stats.upvotes--
    viewer.vote = undefined
    viewer.voteUri = undefined
  } else {
    // Like: add upvote
    stats.upvotes++
    viewer.vote = direction
  }
  stats.score = stats.upvotes

  return { stats, viewer }
}

// ---------------------------------------------------------------------------
// Crosspost query-param encoding
// ---------------------------------------------------------------------------

/** Draft content carried through the `?crosspost=` query param. */
export interface CrosspostDraft {
  name?: string
  body?: string
}

/**
 * Encodes a crosspost draft as URL-safe base64 for the `?crosspost=` param.
 *
 * Plain `btoa(JSON.stringify(...))` throws `InvalidCharacterError` on any
 * character above U+00FF (curly quotes, em dashes, emoji, CJK, ...), so the
 * JSON is first UTF-8 encoded byte-by-byte. Standard base64 `+` / `/` / `=`
 * are also unsafe inside a query value (`+` parses back as a space), so the
 * output uses the base64url alphabet with padding stripped.
 */
export function encodeCrosspostDraft(draft: CrosspostDraft): string {
  const bytes = new TextEncoder().encode(JSON.stringify(draft))
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/**
 * Decodes a `?crosspost=` param produced by {@link encodeCrosspostDraft}.
 *
 * Also accepts legacy standard-base64 values (with `+`, `/`, and padding)
 * for backwards compatibility with previously shared links. Returns
 * undefined for malformed input instead of throwing so a tampered URL
 * cannot crash the create-post page.
 */
export function decodeCrosspostDraft(
  param: string,
): CrosspostDraft | undefined {
  try {
    const base64 = param.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (typeof parsed !== 'object' || parsed === null) return undefined

    const record = parsed as Record<string, unknown>
    const draft: CrosspostDraft = {}
    if (typeof record.name === 'string') draft.name = record.name
    if (typeof record.body === 'string') draft.body = record.body
    return draft
  } catch {
    return undefined
  }
}
