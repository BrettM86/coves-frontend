import type { RecordEmbed } from '$lib/api/coves/types'
import { parseWebUrl } from '$lib/app/util/url'
import { isValidDID, isValidHandle } from '$lib/types/atproto'
import { parseBlueskyPostRef, type BlueskyPostRef } from '../helpers'

export interface BlueskyAuthorView {
  did: string
  handle?: string
  displayName: string
  profileUrl: string
  avatar?: string
}

export interface BlueskyImageView {
  thumb: string
  fullsize: string
  alt: string
  aspectRatio?: {
    width: number
    height: number
  }
}

export interface BlueskyExternalView {
  uri: string
  domain: string
  title?: string
  description?: string
  thumb?: string
}

export interface BlueskyPostSuccessView {
  kind: 'success'
  author: BlueskyAuthorView
  text: string
  createdAt?: string
  replyCount: number
  repostCount: number
  likeCount: number
  originalUrl?: string
  images: BlueskyImageView[]
  mediaCount: number
  hasMedia: boolean
  external?: BlueskyExternalView
  quotedPost?: BlueskyPostView
}

export interface BlueskyPostUnavailableView {
  kind: 'unavailable'
  message: string
  originalUrl?: string
}

export type BlueskyPostView =
  BlueskyPostSuccessView | BlueskyPostUnavailableView

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nonNegativeCount = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0

const validTimestamp = (value: unknown): string | undefined =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : undefined

const usableRuntimeHandle = (value: unknown): string | undefined =>
  typeof value === 'string' &&
  value !== 'handle.invalid' &&
  isValidHandle(value)
    ? value
    : undefined

const hasUnsafeUrlCharacter = (value: string): boolean =>
  value.includes('\\') ||
  [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })

function hasValidCdnPath(path: string): boolean {
  const segments = path.split('/')
  return (
    segments.length >= 4 &&
    segments[0] === '' &&
    segments[1] === 'img' &&
    segments
      .slice(2)
      .every((segment) =>
        Boolean(segment && segment !== '.' && segment !== '..'),
      )
  )
}

/** Applies the same direct Bluesky CDN boundary enforced by the AppView. */
function blueskyCdnUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || hasUnsafeUrlCharacter(value)) {
    return undefined
  }

  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:' ||
      parsed.host !== 'cdn.bsky.app' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined
    }

    let path = parsed.pathname
    for (let depth = 0; depth < 8; depth += 1) {
      if (/%(?:2f|5c)/i.test(path)) return undefined
      const decoded = decodeURIComponent(path)
      if (hasUnsafeUrlCharacter(decoded) || !hasValidCdnPath(decoded)) {
        return undefined
      }
      if (decoded === path) return value
      path = decoded
    }
  } catch {
    return undefined
  }

  return undefined
}

function normalizeImage(value: unknown): BlueskyImageView | undefined {
  if (!isObject(value)) return undefined
  const thumb = blueskyCdnUrl(value.thumb)
  const fullsize = blueskyCdnUrl(value.fullsize)
  if (!thumb || !fullsize || typeof value.alt !== 'string') return undefined

  const rawAspect = isObject(value.aspectRatio) ? value.aspectRatio : undefined
  const width = rawAspect?.width
  const height = rawAspect?.height
  const aspectRatio =
    typeof width === 'number' &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === 'number' &&
    Number.isFinite(height) &&
    height > 0
      ? { width, height }
      : undefined
  return { thumb, fullsize, alt: value.alt, aspectRatio }
}

function normalizeExternal(value: unknown): BlueskyExternalView | undefined {
  if (!isObject(value) || typeof value.uri !== 'string') return undefined
  const uri = parseWebUrl(value.uri)
  if (!uri) return undefined

  return {
    uri: value.uri,
    domain: uri.hostname,
    title: typeof value.title === 'string' ? value.title : undefined,
    description:
      typeof value.description === 'string' ? value.description : undefined,
    thumb: blueskyCdnUrl(value.thumb),
  }
}

function postUrl(ref: BlueskyPostRef, actor: string = ref.actor): string {
  return `https://bsky.app/profile/${encodeURIComponent(actor)}/post/${encodeURIComponent(ref.rkey)}`
}

function originalUrl(
  resolved: Record<string, unknown>,
  fallbackUri: unknown,
  author?: BlueskyAuthorView,
): string | undefined {
  const uri = Object.hasOwn(resolved, 'uri') ? resolved.uri : fallbackUri
  const ref = parseBlueskyPostRef(uri)
  if (!ref) return undefined

  const actor =
    author?.handle && (author.did === ref.actor || author.handle === ref.actor)
      ? author.handle
      : ref.actor
  return postUrl(ref, actor)
}

function unavailableView(
  resolved: Record<string, unknown> | undefined,
  defaultMessage: string,
  fallbackUri?: unknown,
): BlueskyPostUnavailableView {
  const message =
    typeof resolved?.message === 'string' && resolved.message.trim()
      ? resolved.message
      : defaultMessage
  const ref = parseBlueskyPostRef(fallbackUri)
  return {
    kind: 'unavailable',
    message,
    originalUrl: ref ? postUrl(ref) : undefined,
  }
}

function normalizeResolvedPost(
  value: unknown,
  defaultMessage: string,
  fallbackUri: unknown,
  includeQuote: boolean,
): BlueskyPostView {
  const resolved = isObject(value) ? value : undefined
  if (!resolved || resolved.unavailable === true) {
    return unavailableView(resolved, defaultMessage, fallbackUri)
  }

  const rawAuthor = isObject(resolved.author) ? resolved.author : undefined
  if (!rawAuthor) return unavailableView(resolved, defaultMessage, fallbackUri)

  const did = rawAuthor.did
  if (typeof did !== 'string' || !isValidDID(did)) {
    return unavailableView(resolved, defaultMessage, fallbackUri)
  }

  const handle = usableRuntimeHandle(rawAuthor.handle)
  const displayName =
    typeof rawAuthor.displayName === 'string' && rawAuthor.displayName.trim()
      ? rawAuthor.displayName.trim()
      : (handle ?? did)
  const profileActor = handle ?? did
  const author: BlueskyAuthorView = {
    did,
    handle,
    displayName,
    profileUrl: `https://bsky.app/profile/${encodeURIComponent(profileActor)}`,
    avatar: blueskyCdnUrl(rawAuthor.avatar),
  }

  const images = Array.isArray(resolved.images)
    ? resolved.images.flatMap((image) => {
        const normalized = normalizeImage(image)
        return normalized ? [normalized] : []
      })
    : []
  const mediaCount = nonNegativeCount(resolved.mediaCount)

  return {
    kind: 'success',
    author,
    text: typeof resolved.text === 'string' ? resolved.text : '',
    createdAt: validTimestamp(resolved.createdAt),
    replyCount: nonNegativeCount(resolved.replyCount),
    repostCount: nonNegativeCount(resolved.repostCount),
    likeCount: nonNegativeCount(resolved.likeCount),
    originalUrl: originalUrl(resolved, fallbackUri, author),
    images,
    mediaCount,
    hasMedia: resolved.hasMedia === true,
    external: normalizeExternal(resolved.embed),
    quotedPost:
      includeQuote && resolved.quotedPost !== undefined
        ? normalizeResolvedPost(
            resolved.quotedPost,
            defaultMessage,
            undefined,
            false,
          )
        : undefined,
  }
}

/** Narrows the untyped resolver payload before it reaches card markup. */
export function normalizeBlueskyPost(
  embed: RecordEmbed,
  defaultMessage: string,
): BlueskyPostView {
  return normalizeResolvedPost(
    embed.resolved,
    defaultMessage,
    embed.post.uri,
    true,
  )
}
