import { parseProxyUrl } from '$lib/api/coves/image-proxy'
import type { EmbedImage } from '$lib/api/coves/types'

/**
 * The CIDs of an image embed record's GIF blobs. The hydrated view does not
 * say which images are GIFs; the record's blobs do, as the mobile app reads
 * them. The record is untrusted, so anything not shaped like a blob is
 * skipped.
 */
export function gifBlobCids(recordEmbed: unknown): Set<string> {
  const cids = new Set<string>()
  if (typeof recordEmbed !== 'object' || recordEmbed === null) return cids
  const embed = recordEmbed as Record<string, unknown>
  const holder =
    embed.$type === 'social.coves.embed.imagesWithAttachment'
      ? embed.images
      : embed.$type === 'social.coves.embed.images'
        ? embed
        : undefined
  const images =
    typeof holder === 'object' && holder !== null
      ? (holder as Record<string, unknown>).images
      : undefined
  if (!Array.isArray(images)) return cids
  for (const entry of images) {
    const image = (entry as Record<string, unknown> | null)?.image as
      Record<string, unknown> | undefined
    const cid = (image?.ref as Record<string, unknown> | undefined)?.$link
    if (image?.mimeType === 'image/gif' && typeof cid === 'string')
      cids.add(cid)
  }
  return cids
}

/** Whether `image` is served from one of `gifCids`. */
export function isGifImage(
  image: EmbedImage,
  gifCids: ReadonlySet<string>,
): boolean {
  const cid = image.fullsize && parseProxyUrl(image.fullsize)?.cid
  return !!cid && gifCids.has(cid)
}
