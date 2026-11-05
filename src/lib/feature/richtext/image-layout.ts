import type { EmbedImage, PostEmbed } from '$lib/api/coves/types'
import { embedImages } from '$lib/feature/post/helpers'
import { FEATURE_TYPE, MAX_FACETS, facetByteRange, type Range } from './facets'

interface AcceptedPlacement extends Range {
  /** Position of the placing facet in the facets array. */
  facet: number
  /** Index of the image in the main image list. */
  index: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The image index a facet places, when an `#image` feature is its only
 * feature; otherwise null. */
function placedIndex(facet: unknown): number | null {
  if (!isRecord(facet) || !Array.isArray(facet.features)) return null
  if (facet.features.length !== 1) return null
  const [feature] = facet.features
  if (!isRecord(feature) || feature.$type !== FEATURE_TYPE.image) return null
  return typeof feature.index === 'number' && Number.isInteger(feature.index)
    ? feature.index
    : null
}

function hasCodeFeature(facet: unknown): boolean {
  return (
    isRecord(facet) &&
    Array.isArray(facet.features) &&
    facet.features.some(
      (feature) =>
        isRecord(feature) &&
        (feature.$type === FEATURE_TYPE.code ||
          feature.$type === FEATURE_TYPE.codeBlock),
    )
  )
}

/**
 * The placements that pass every guard, in body order: the index names one of
 * `imageCount` images and is the first placement of it; the `#image` feature is the
 * facet's only feature; the range is non-empty, within `content` and on UTF-8
 * character boundaries; and it overlaps no `#code` or `#codeBlock` range.
 */
function acceptedPlacements(
  imageCount: number,
  content: string,
  facets: unknown[] | undefined,
): AcceptedPlacement[] {
  if (imageCount === 0 || !facets) return []
  const bytes = new TextEncoder().encode(content)
  const isCharacterBoundary = (offset: number) =>
    offset === bytes.length || (bytes[offset] & 0xc0) !== 0x80
  const considered = facets.slice(0, MAX_FACETS)
  const codeRanges = considered
    .filter(hasCodeFeature)
    .flatMap((facet) => facetByteRange(facet) ?? [])

  const placedIndexes = new Set<number>()
  const accepted: AcceptedPlacement[] = []
  considered.forEach((facet, position) => {
    const index = placedIndex(facet)
    const range = facetByteRange(facet)
    if (index === null || !range) return
    if (index < 0 || index >= imageCount || placedIndexes.has(index)) return
    const { start, end } = range
    if (start >= end || end > bytes.length) return
    if (!isCharacterBoundary(start) || !isCharacterBoundary(end)) return
    if (codeRanges.some((code) => code.start < end && code.end > start)) return
    placedIndexes.add(index)
    accepted.push({ start, end, facet: position, index })
  })
  return accepted.sort((a, b) => a.start - b.start)
}

/**
 * Split the embed's main images into those placed in the body by `#image`
 * facets and the rest, which stay in the gallery in index order. `placed`
 * maps a facet's position in `facets` to its image and iterates in body
 * order, so the lightbox sequence is `[...placed.values(), ...gallery]`.
 */
export function imageLayout(
  embed: PostEmbed | undefined,
  content: string,
  facets: unknown[] | undefined,
): { gallery: EmbedImage[]; placed: Map<number, EmbedImage> } {
  const images = embedImages(embed)
  const accepted = acceptedPlacements(images.length, content, facets)
  const placedIndexes = new Set(accepted.map((placement) => placement.index))
  return {
    gallery: images.filter((_, index) => !placedIndexes.has(index)),
    placed: new Map(
      accepted.map((placement) => [placement.facet, images[placement.index]]),
    ),
  }
}

/**
 * An image's aspect ratio when it is two finite positive numbers. The ratio is
 * untrusted record data that callers write into inline styles, so anything
 * else, numeric strings included, is rejected.
 */
export function imageAspectRatio(
  image: EmbedImage,
): { width: number; height: number } | undefined {
  const raw: unknown = image.aspectRatio
  if (typeof raw !== 'object' || raw === null) return undefined
  const { width, height } = raw as Record<string, unknown>
  return typeof width === 'number' &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === 'number' &&
    Number.isFinite(height) &&
    height > 0
    ? { width, height }
    : undefined
}

/**
 * The CSS width that fits an image in its container and in 60% of the viewport
 * height, keeping its aspect ratio (4:3 without one), so a tall image narrows
 * instead of letterboxing.
 */
export function fittedImageWidth(image: EmbedImage): string {
  const { width, height } = imageAspectRatio(image) ?? { width: 4, height: 3 }
  return `min(100%, calc(60vh * ${width} / ${height}))`
}

/**
 * The accepted placements among `facets` for a record with `imageCount`
 * images, as facet position → image index in body order: the same guards the
 * reader applies, for callers that have no view images.
 */
export function placedImageIndexes(
  imageCount: number,
  content: string,
  facets: unknown[] | undefined,
): Map<number, number> {
  return new Map(
    acceptedPlacements(imageCount, content, facets).map((placement) => [
      placement.facet,
      placement.index,
    ]),
  )
}

/**
 * `content` without the covered text of accepted placements, for preview
 * text. A placement on a line of its own takes the blank line after it too,
 * so the paragraphs around it keep a single blank line between them.
 */
export function removePlacedText(
  embed: PostEmbed | undefined,
  content: string,
  facets: unknown[] | undefined,
): string {
  const accepted = acceptedPlacements(
    embedImages(embed).length,
    content,
    facets,
  )
  if (accepted.length === 0) return content
  const bytes = new TextEncoder().encode(content)
  const decoder = new TextDecoder()
  let text = ''
  let cursor = 0
  for (const placement of accepted) {
    text += decoder.decode(
      bytes.subarray(cursor, Math.max(cursor, placement.start)),
    )
    cursor = Math.max(cursor, placement.end)
    if (text === '' || text.endsWith('\n')) {
      while (bytes[cursor] === 0x0a) cursor++
    }
  }
  text += decoder.decode(bytes.subarray(cursor))
  return cursor === bytes.length ? text.replace(/\n+$/, '') : text
}
