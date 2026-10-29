import type { EmbedImage } from '$lib/api/coves/types'
import { log } from '$lib/app/util/log'
import { isWebUrl } from '$lib/app/util/url'

/**
 * Available image proxy presets matching the Coves backend.
 * The proxy serves at /img/{preset}/plain/{did}/{cid}.
 */
export type ImagePreset =
  | 'avatar'
  | 'avatar_small'
  | 'banner'
  | 'content_preview'
  | 'content_full'
  | 'embed_thumbnail'

const PROXY_URL_REGEX = /\/img\/([a-z_]+)\/plain\/(did:[^/]+)\/([^/?#]+)/

export interface ParsedProxyUrl {
  preset: ImagePreset | (string & {})
  did: string
  cid: string
}

/**
 * Parses a Coves image proxy URL into its components.
 * Returns null if the URL is not a proxy URL.
 */
export function parseProxyUrl(url: string): ParsedProxyUrl | null {
  const match = url.match(PROXY_URL_REGEX)
  if (!match) return null
  return { preset: match[1], did: match[2], cid: match[3] }
}

/**
 * Constructs a proxy URL with a different preset.
 * If the input is already a proxy URL, swaps the preset.
 * If the input is not a proxy URL, returns it unmodified.
 */
export function withPreset(url: string, preset: ImagePreset): string {
  const parsed = parseProxyUrl(url)
  if (!parsed) {
    if (import.meta.env.DEV && url) {
      log.warn(`[image-proxy] withPreset called with non-proxy URL: ${url}`)
    }
    return url
  }

  const baseEnd = url.indexOf('/img/')
  const base = baseEnd >= 0 ? url.substring(0, baseEnd) : ''
  return `${base}/img/${preset}/plain/${parsed.did}/${parsed.cid}`
}

export type ImageVariant = 'thumb' | 'fullsize'

/**
 * Returns the URL of an EmbedImage's variant, or undefined when the server
 * sent none for that variant or sent something that is not an absolute
 * http(s) URL. Every renderer takes its image URL from here: there is no
 * fallback to the other variant.
 */
export function imageUrl(
  image: EmbedImage,
  variant: ImageVariant = 'thumb',
): string | undefined {
  const url = variant === 'fullsize' ? image.fullsize : image.thumb
  return url && isWebUrl(url) ? url : undefined
}
