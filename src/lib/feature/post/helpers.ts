import type {
  PostEmbed,
  PostStats,
  PostView,
  PostViewerState,
} from '$lib/api/coves/types'
import { profile } from '$lib/app/auth.svelte'
import {
  canParseUrl,
  findClosestNumber,
  isImage,
  isVideo,
} from '$lib/app/util.svelte'

// Algorithm to determine the best image URL to use from a Coves PostView's embed
export const bestImageURL = (
  embed: PostEmbed | undefined,
  thumbnail: boolean = true,
  width: number = 1024,
  format: 'avif' | 'webp' | null = 'webp',
): string => {
  if (!embed) return ''

  switch (embed.$type) {
    case 'social.coves.embed.images#view': {
      const img = embed.images[0]
      if (img?.image) return optimizeImageURL(img.image, width, format)
      return ''
    }
    case 'social.coves.embed.external#view': {
      if (embed.external.thumb && thumbnail)
        return optimizeImageURL(embed.external.thumb, width, format)
      return embed.external.uri ?? ''
    }
    case 'social.coves.embed.video#view': {
      if (embed.thumbnail)
        return optimizeImageURL(embed.thumbnail, width, format)
      return ''
    }
    default:
      return ''
  }
}

export const optimizeImageURL = (
  urlStr: string,
  width: number = 1024,
  format: 'avif' | 'webp' | null = 'webp',
): string => {
  try {
    let url: URL
    try {
      url = new URL(urlStr)
    } catch {
      return urlStr
    }

    if (format) url.searchParams.set('format', format)

    if (width > 0 && !url.searchParams.has('thumbnail')) {
      url.searchParams.set(
        'thumbnail',
        findClosestNumber(
          [128, 196, 256, 512, 728, 1024, 1536],
          width,
        ).toString(),
      )
    }

    return url.toString()
  } catch (e) {
    console.error(e)
    return urlStr
  }
}

const YOUTUBE_REGEX =
  /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|live\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})(?:\S+)?$/

export const isYoutubeLink = (url?: string): RegExpMatchArray | null => {
  if (!url) return null

  return url?.match?.(YOUTUBE_REGEX)
}

export function postLink(post: PostView): string {
  const instance = profile.current?.instance ?? ''
  return `/post/${encodeURIComponent(instance)}/${encodeURIComponent(post.uri)}`
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
    case 'social.coves.embed.video#view':
      return 'iframe'
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
    case 'social.coves.embed.record#view':
      return 'embed'
    default:
      return 'none'
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
    case 'social.coves.embed.external#view':
      return embed.external.uri
    case 'social.coves.embed.video#view':
      return embed.video
    case 'social.coves.embed.record#view':
      return undefined
    default:
      return undefined
  }
}

/**
 * Extracts the thumbnail URL from a PostEmbed, if any.
 */
export function extractEmbedThumbnail(embed?: PostEmbed): string | undefined {
  if (!embed) return undefined

  switch (embed.$type) {
    case 'social.coves.embed.images#view':
      return embed.images[0]?.image
    case 'social.coves.embed.external#view':
      return embed.external.thumb
    case 'social.coves.embed.video#view':
      return embed.thumbnail
    default:
      return undefined
  }
}

/**
 * Extracts the embed title from a PostEmbed, if any.
 */
export function extractEmbedTitle(embed?: PostEmbed): string | undefined {
  if (!embed) return undefined

  switch (embed.$type) {
    case 'social.coves.embed.external#view':
      return embed.external.title
    default:
      return undefined
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
    case 'social.coves.embed.video#view':
      return embed.alt
    default:
      return undefined
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
 * Computes the new vote state after a user votes in a given direction.
 *
 * Pure function: takes the current stats + viewer state and a vote direction,
 * returns the new stats + viewer state without mutating the inputs.
 */
export function computeVoteState(
  currentStats: PostStats | undefined,
  currentViewer: PostViewerState | undefined,
  direction: 'up' | 'down',
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
  const isToggleOff = currentVote === direction

  if (isToggleOff) {
    // Toggling off current vote
    if (currentVote === 'up') stats.upvotes--
    else if (currentVote === 'down') stats.downvotes--
    viewer.vote = undefined
  } else {
    // Removing old vote if any
    if (currentVote === 'up') stats.upvotes--
    else if (currentVote === 'down') stats.downvotes--
    // Applying new vote
    if (direction === 'up') stats.upvotes++
    else stats.downvotes++
    viewer.vote = direction
  }
  stats.score = stats.upvotes - stats.downvotes

  return { stats, viewer }
}
