import type {
  PostEmbed,
  PostStats,
  PostView,
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

export function postLink(post: PostView): string {
  const { rkey } = parseAtUri(post.uri)
  const slug = post.community.handle
    ? communitySlug(post.community.handle)
    : post.community.name
  return `/c/${encodeURIComponent(slug)}/post/${encodeURIComponent(rkey)}`
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
