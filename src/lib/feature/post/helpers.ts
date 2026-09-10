import type { AtUri, PostEmbed } from '$lib/api/coves/types'
import { parseAtUri } from '$lib/api/coves/types'
import { isImage, isVideo, isWebUrl } from '$lib/app/util/url'
import { communityLink } from '$lib/app/util/links'
import { STREAMABLE_EMBED_ORIGIN } from '$lib/app/util/embed-hosts'
import {
  type ImagePreset,
  type ImageVariant,
  imageUrl,
  withPreset,
} from '$lib/api/coves/image-proxy'

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
    case 'social.coves.embed.post#view':
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
 * @deprecated Use `withPreset` from `$lib/api/coves/image-proxy` directly.
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

// Matches the three public forms of a Streamable link — the plain
// `streamable.com/<id>`, the `/e/<id>` embed and the `/s/<id>/…` share URL —
// and captures the id. Anchored at both ends so a look-alike host
// (`streamable.com.evil.test`) or a path that merely contains the string
// (`example.com/streamable.com/x`) cannot match; the scheme is optional for
// the same reason it is in YOUTUBE_REGEX, since callers gate on `isWebUrl`
// before an absolute URL is required.
const STREAMABLE_REGEX =
  /^(?:https?:\/\/)?(?:www\.)?streamable\.com\/(?:[es]\/)?([a-z0-9]+)(?:[/?#]\S*)?$/i

export const isStreamableLink = (url?: string): RegExpMatchArray | null => {
  if (!url) return null

  return url?.match?.(STREAMABLE_REGEX)
}

/**
 * The player URL for a Streamable link, or null if it is not one.
 *
 * Built from the captured id rather than by rewriting the input, so the only
 * author-controlled part of the resulting `src` is an alphanumeric id on an
 * origin we chose.
 */
export function streamableEmbedUrl(url: string): string | null {
  const id = isStreamableLink(url)?.[1]

  return id ? `${STREAMABLE_EMBED_ORIGIN}/e/${id}` : null
}

/** The ATProto collection NSID for Coves posts, which are author-owned. */
export const POST_COLLECTION = 'social.coves.community.postv2'

/**
 * The ATProto collection NSID for the superseded community-owned posts.
 * Records in it predate `postv2` and live in the community's repo.
 */
export const LEGACY_POST_COLLECTION = 'social.coves.community.post'

/**
 * Constructs the canonical DID-based AT-URI for a post.
 * Used as a fallback when navigating directly to a post (or comment permalink)
 * URL without a cache hit or an explicit `?uri=` param. Building it from the
 * owning repo's DID (rather than a handle) keeps the hydration path stable
 * across renames — the one handle→DID hop is resolved up front.
 */
export function buildPostAtUri(ownerDid: string, rkey: string): AtUri {
  return `at://${ownerDid}/${POST_COLLECTION}/${rkey}` as AtUri
}

/**
 * Constructs the AT-URI a post would have if it were a legacy community-owned
 * record. The loader tries this shape when {@link buildPostAtUri} comes back
 * unavailable, so pre-`postv2` posts still resolve from a permalink.
 */
export function buildLegacyPostAtUri(ownerDid: string, rkey: string): AtUri {
  return `at://${ownerDid}/${LEGACY_POST_COLLECTION}/${rkey}` as AtUri
}

/**
 * Minimal shape {@link postLink} and {@link commentLink} need to build a
 * permalink: the post's AT-URI plus a community ref, and optionally the
 * author ref that supplies the prettier handle form of the owner segment.
 * Satisfied by a full `PostView` (whose `community` is a `CommunityRef`) or a
 * hand-built `{ uri, community }` object.
 */
export interface PostLinkRef {
  uri: string
  community: {
    did: string
    handle?: string
    name: string
    origin?: string
  }
  author?: {
    did: string
    handle?: string
  }
}

/**
 * The permalink segment naming the repo a record lives in. Defaults to the
 * record's AT-URI authority DID; the prettier handle is substituted only when
 * `ref` proves it belongs to that same repo, so the segment always addresses
 * the record that actually exists.
 */
function repoSegment(
  authority: string,
  ref: { did: string; handle?: string } | undefined,
): string {
  return ref?.did === authority && ref.handle ? ref.handle : authority
}

/**
 * Builds the canonical Coves permalink for a post:
 * `/c/<slug>/post/<owner>/<rkey>`.
 *
 * Single source of truth for post URL generation — route every post link
 * through here instead of hand-rolling the path, so the URL scheme only ever
 * lives in one place. Accepts any object carrying the post's AT-URI and a
 * community ref (see {@link PostLinkRef}).
 *
 * The community segment comes from {@link communityLink}: the canonical
 * `name` / `name@origin` when the ref carries an `origin`, else the handle
 * slug, else the DID — every form the `[handle=handle]` route matcher accepts
 * and the community loaders resolve.
 *
 * The owner segment identifies the repo the record lives in, which is the
 * AT-URI authority: the author's DID for a `postv2` record, the community's
 * DID for a legacy community-owned one. The author's handle is substituted
 * only when the ref proves the author is that same repo, so the segment
 * always addresses the record that actually exists.
 *
 * @param includeUri - When true, appends `?uri=<canonical AT-URI>` to the path.
 *   The post page reads this param to load the post immediately, without a
 *   feed-cache hit or a backend handle→DID resolution — use it right after
 *   creating a post, when the new record is not yet in any feed cache.
 */
export function postLink(post: PostLinkRef, includeUri = false): string {
  const { did, rkey } = parseAtUri(post.uri as AtUri)
  const owner = repoSegment(did, post.author)
  const path = `${communityLink(post.community)}/post/${encodeURIComponent(owner)}/${encodeURIComponent(rkey)}`
  if (!includeUri) return path
  return `${path}?${new URLSearchParams({ uri: post.uri })}`
}

/**
 * Builds the canonical Coves permalink for a comment:
 * `/c/<slug>/post/<owner>/<rkey>/comment/<commenter>/<crkey>`.
 *
 * Single source of truth for comment URL generation — route every comment
 * permalink through here instead of hand-rolling the path, mirroring
 * {@link postLink} (which it builds on for the post segment). Accepts any
 * object carrying the post's AT-URI and a community ref (see
 * {@link PostLinkRef}) plus the comment's AT-URI
 * (`at://<commenterDid>/social.coves.community.comment/<rkey>`), from which
 * the trailing two segments are derived.
 *
 * @param commenter - The comment's author ref, supplying the prettier handle
 *   form of the commenter segment. Omit it (or pass a ref for a different
 *   repo) and the segment falls back to the comment URI's authority DID.
 */
export function commentLink(
  post: PostLinkRef,
  commentUri: AtUri,
  commenter?: { did: string; handle?: string },
): string {
  const { did, rkey } = parseAtUri(commentUri)
  const segment = repoSegment(did, commenter)
  return `${postLink(post)}/comment/${encodeURIComponent(segment)}/${encodeURIComponent(rkey)}`
}

export type MediaType = 'video' | 'image' | 'iframe' | 'embed' | 'none'
export type IframeType = 'youtube' | 'streamable' | 'video' | 'none'

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
      // Normally a blob-proxy URL hydrated by the AppView, but hydration is
      // all-or-nothing: a record whose `video` is not a blob is served with
      // the raw string intact, so it needs the same gate as an external URI.
      return isWebUrl(embed.video) ? 'iframe' : 'none'
    case 'social.coves.embed.external':
    case 'social.coves.embed.external#view': {
      // External URIs are untrusted: records written directly to a PDS never
      // pass the AppView's scheme check, so anything that is not a plain web
      // link is treated as no embed at all rather than reaching an href sink.
      const uri = embed.external.uri
      if (!uri || !isWebUrl(uri)) return 'none'

      if (isImage(uri)) return 'image'
      if (isVideo(uri)) return 'iframe'
      if (isYoutubeLink(uri)) return 'iframe'
      if (isStreamableLink(uri)) return 'iframe'
      return 'embed'
    }
    case 'social.coves.embed.post':
    case 'social.coves.embed.post#view':
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
  if (isStreamableLink(url)) return 'streamable'
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
    case 'social.coves.embed.post#view':
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
    case 'social.coves.embed.post#view':
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
    case 'social.coves.embed.post#view':
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
    case 'social.coves.embed.post#view':
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

/**
 * Plain-text excerpt of a post body, for contexts that need a short text
 * stand-in when a post has no title (Coves posts may legitimately omit one):
 * compact list rows and document/og titles. Takes the first non-empty line,
 * strips markdown syntax that would render literally, and truncates.
 */
export function postTextFallback(
  content: string | undefined,
  max = 120,
): string | undefined {
  if (!content) return undefined

  const line = content
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0)
  if (!line) return undefined

  const plain = line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/[*_`~]/g, '')
    .trim()
  if (!plain) return undefined

  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain
}
