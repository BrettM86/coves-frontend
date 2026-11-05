/**
 * Rich text facet processing for `social.coves.richtext.facet`.
 *
 * Facets are advisory annotations over canonical plaintext: byte ranges
 * (UTF-8) carrying an open union of features. This module converts a
 * content string plus its raw (untrusted) facets array into a block/inline
 * render tree, applying the reader-side conventions from the lexicon:
 *
 * - Unknown feature `$type`s degrade to plain text (open union).
 * - Malformed or out-of-range byte slices are dropped or clamped; a bad
 *   facet must never make content unreadable.
 * - Block ranges (blockquote / heading / codeBlock) are extended to
 *   enclosing line boundaries when they don't span whole lines.
 * - Cross-type block nesting by containment is honored (e.g. a codeBlock
 *   inside a blockquote); blockquote-in-blockquote containment is invalid
 *   and the contained quote is dropped (nested quotes are expressed as
 *   disjoint ranges with increasing level).
 * - Byte offsets landing inside a multi-byte UTF-8 sequence are snapped
 *   inward to codepoint boundaries so decoding never produces U+FFFD.
 * - The backend's schema caps (200 facets, 20 features each) are enforced
 *   here too, because old or federated records predate them and a hostile
 *   record must not be able to stall rendering.
 */

import type { EmbedImage } from '$lib/api/coves/types'
import { parseWebUrl } from '$lib/app/util/url'
import { isValidDID } from '$lib/types/atproto'

const FACET_NS = 'social.coves.richtext.facet'

/** Mirror of the lexicon's schema caps (facets per record, features per
 * facet). Entries beyond a cap are ignored. */
export const MAX_FACETS = 200
export const MAX_FEATURES_PER_FACET = 20

export const FEATURE_TYPE = {
  mention: `${FACET_NS}#mention`,
  link: `${FACET_NS}#link`,
  bold: `${FACET_NS}#bold`,
  italic: `${FACET_NS}#italic`,
  strikethrough: `${FACET_NS}#strikethrough`,
  spoiler: `${FACET_NS}#spoiler`,
  blockquote: `${FACET_NS}#blockquote`,
  heading: `${FACET_NS}#heading`,
  code: `${FACET_NS}#code`,
  codeBlock: `${FACET_NS}#codeBlock`,
  image: `${FACET_NS}#image`,
} as const

// ---------------------------------------------------------------------------
// Render tree types
// ---------------------------------------------------------------------------

/** Quote nesting depth / heading level, as constrained by the lexicon. */
export type FacetLevel = 1 | 2 | 3 | 4 | 5 | 6

type Mark = 'bold' | 'italic' | 'strikethrough' | 'code'

export interface TextSegment {
  readonly type: 'text'
  readonly text: string
  readonly bold?: true
  readonly italic?: true
  readonly strikethrough?: true
  readonly code?: true
}

export interface LinkSpan {
  readonly type: 'link'
  /** Resolved href: an external URL, or an internal route for mentions. */
  readonly href: string
  /** True for link facets (external URL), false for mention routes. */
  readonly external: boolean
  readonly children: readonly TextSegment[]
}

export interface SpoilerSpan {
  readonly type: 'spoiler'
  readonly reason?: string
  readonly children: readonly (TextSegment | LinkSpan)[]
}

export type Inline = TextSegment | LinkSpan | SpoilerSpan

export interface ParagraphBlock {
  readonly type: 'paragraph'
  readonly children: readonly Inline[]
}

export interface HeadingBlock {
  readonly type: 'heading'
  /** 1 (largest) through 6. */
  readonly level: FacetLevel
  readonly children: readonly Inline[]
}

export interface CodeBlock {
  readonly type: 'codeBlock'
  readonly language?: string
  readonly code: string
}

export interface BlockquoteBlock {
  readonly type: 'blockquote'
  /** Quote nesting depth, 1 through 6. */
  readonly level: FacetLevel
  readonly children: readonly (ParagraphBlock | HeadingBlock | CodeBlock)[]
}

export type Block = ParagraphBlock | HeadingBlock | CodeBlock | BlockquoteBlock

// ---------------------------------------------------------------------------
// Image-aware render tree (buildRichTextWithPlacements)
// ---------------------------------------------------------------------------

/** A spoiler piece; pieces cut from one spoiler share a `group` and reveal
 * together. */
export interface PlacedSpoilerSpan {
  readonly type: 'spoiler'
  readonly reason?: string
  readonly group: number
  readonly children: readonly (TextSegment | LinkSpan)[]
}

export type PlacedInline = TextSegment | LinkSpan | PlacedSpoilerSpan

export interface PlacedParagraphBlock {
  readonly type: 'paragraph'
  readonly children: readonly PlacedInline[]
}

export interface PlacedHeadingBlock {
  readonly type: 'heading'
  readonly level: FacetLevel
  readonly children: readonly PlacedInline[]
}

/** A placed image, drawn as a block where its facet's text was. `Image` is
 * whatever the caller placed: the reader's view image, or anything else a
 * caller that needs only the facet position passes. */
export interface PlacedImageBlock<Image = EmbedImage> {
  readonly type: 'image'
  /** Position of the placing facet in the facets array. */
  readonly facet: number
  readonly image: Image
  /** Set when the placement lies in a spoiler: the image reveals with it. */
  readonly spoiler?: { readonly group: number; readonly reason?: string }
}

export interface PlacedBlockquoteBlock<Image = EmbedImage> {
  readonly type: 'blockquote'
  readonly level: FacetLevel
  readonly children: readonly (
    | PlacedParagraphBlock
    | PlacedHeadingBlock
    | CodeBlock
    | PlacedImageBlock<Image>
  )[]
}

export type PlacedBlock<Image = EmbedImage> =
  | PlacedParagraphBlock
  | PlacedHeadingBlock
  | CodeBlock
  | PlacedBlockquoteBlock<Image>
  | PlacedImageBlock<Image>

/** True when a record's facets field holds at least one entry. */
export function hasFacets(facets: unknown): facets is unknown[] {
  return Array.isArray(facets) && facets.length > 0
}

// ---------------------------------------------------------------------------
// Facet parsing (untrusted input → normalized annotations)
// ---------------------------------------------------------------------------

export interface Range {
  start: number
  end: number
}

interface MarkRange extends Range {
  mark: Mark
}

interface LinkRange extends Range {
  href: string
  external: boolean
}

interface SpoilerRange extends Range {
  reason?: string
}

type BlockKind = 'blockquote' | 'heading' | 'codeBlock'

interface BlockRange extends Range {
  kind: BlockKind
  level: FacetLevel
  language?: string
  children: BlockRange[]
}

interface Annotations {
  marks: MarkRange[]
  links: LinkRange[]
  spoilers: SpoilerRange[]
  blocks: BlockRange[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asByteOffset(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null
}

function clampLevel(
  value: unknown,
  fallback: FacetLevel | null,
): FacetLevel | null {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback
  // The clamp adjacent to the cast is what makes the assertion sound.
  return Math.min(6, Math.max(1, value)) as FacetLevel
}

/** Only http(s) link targets are rendered as anchors; anything else (e.g.
 * `javascript:`) degrades to plain text. */
function safeExternalHref(uri: unknown): string | null {
  if (typeof uri !== 'string') return null
  return parseWebUrl(uri) ? uri : null
}

function mentionHref(did: unknown, mentionText: string): string | null {
  if (typeof did !== 'string' || !isValidDID(did)) return null
  const encoded = encodeURIComponent(did)
  // Community mentions conventionally use a '!' prefix in the text; user
  // mentions use '@'. Route accordingly, defaulting to a user profile.
  return mentionText.startsWith('!') ? `/c/${encoded}` : `/u/${encoded}`
}

/** Snap a byte range inward to UTF-8 codepoint boundaries so no decode can
 * split a multi-byte sequence (which would render U+FFFD replacement
 * characters). Returns null when nothing whole remains. */
function snapToCodepoints(
  bytes: Uint8Array,
  start: number,
  end: number,
): Range | null {
  const isContinuation = (i: number) => (bytes[i] & 0xc0) === 0x80
  while (start < end && isContinuation(start)) start++
  while (end > start && end < bytes.length && isContinuation(end)) end--
  return start < end ? { start, end } : null
}

/** Trim newline bytes off both ends of a range, then extend it outward to
 * the enclosing line boundaries, per the lexicon's reader guidance.
 * Assumes LF line endings (canonical content); a range containing only
 * newline bytes yields null and the block feature is dropped. */
function extendToLineBounds(bytes: Uint8Array, range: Range): Range | null {
  let { start, end } = range
  while (end > start && bytes[end - 1] === 0x0a) end--
  while (start < end && bytes[start] === 0x0a) start++
  if (start >= end) return null
  while (start > 0 && bytes[start - 1] !== 0x0a) start--
  while (end < bytes.length && bytes[end] !== 0x0a) end++
  return { start, end }
}

/** A facet's raw byte range, or null when its index is malformed. Not
 * clamped or snapped: callers that need exact ranges check them. */
export function facetByteRange(facet: unknown): Range | null {
  if (!isRecord(facet) || !isRecord(facet.index)) return null
  const start = asByteOffset(facet.index.byteStart)
  const end = asByteOffset(facet.index.byteEnd)
  return start === null || end === null ? null : { start, end }
}

function parseAnnotations(
  bytes: Uint8Array,
  decoder: TextDecoder,
  facets: unknown[],
): Annotations {
  const out: Annotations = { marks: [], links: [], spoilers: [], blocks: [] }

  for (const rawFacet of facets.slice(0, MAX_FACETS)) {
    if (!isRecord(rawFacet)) continue
    const index = rawFacet.index
    if (!isRecord(index)) continue
    const rawStart = asByteOffset(index.byteStart)
    const rawEnd = asByteOffset(index.byteEnd)
    if (rawStart === null || rawEnd === null) continue
    const snapped = snapToCodepoints(
      bytes,
      rawStart,
      Math.min(rawEnd, bytes.length),
    )
    if (!snapped) continue
    const { start, end } = snapped
    const features = rawFacet.features
    if (!Array.isArray(features)) continue

    for (const feature of features.slice(0, MAX_FEATURES_PER_FACET)) {
      if (!isRecord(feature) || typeof feature.$type !== 'string') continue
      switch (feature.$type) {
        case FEATURE_TYPE.bold:
          out.marks.push({ start, end, mark: 'bold' })
          break
        case FEATURE_TYPE.italic:
          out.marks.push({ start, end, mark: 'italic' })
          break
        case FEATURE_TYPE.strikethrough:
          out.marks.push({ start, end, mark: 'strikethrough' })
          break
        case FEATURE_TYPE.code:
          out.marks.push({ start, end, mark: 'code' })
          break
        case FEATURE_TYPE.link: {
          const href = safeExternalHref(feature.uri)
          if (href) out.links.push({ start, end, href, external: true })
          break
        }
        case FEATURE_TYPE.mention: {
          const text = decoder.decode(bytes.subarray(start, end))
          const href = mentionHref(feature.did, text)
          if (href) out.links.push({ start, end, href, external: false })
          break
        }
        case FEATURE_TYPE.spoiler:
          out.spoilers.push({
            start,
            end,
            reason:
              typeof feature.reason === 'string' ? feature.reason : undefined,
          })
          break
        case FEATURE_TYPE.blockquote: {
          const level = clampLevel(feature.level, 1)
          const range = extendToLineBounds(bytes, { start, end })
          if (level !== null && range) {
            out.blocks.push({
              ...range,
              kind: 'blockquote',
              level,
              children: [],
            })
          }
          break
        }
        case FEATURE_TYPE.heading: {
          // level is required by the lexicon; a heading without one is
          // invalid and degrades to plain text.
          const level = clampLevel(feature.level, null)
          const range = extendToLineBounds(bytes, { start, end })
          if (level !== null && range) {
            out.blocks.push({ ...range, kind: 'heading', level, children: [] })
          }
          break
        }
        case FEATURE_TYPE.codeBlock: {
          const range = extendToLineBounds(bytes, { start, end })
          if (range) {
            out.blocks.push({
              ...range,
              kind: 'codeBlock',
              level: 1, // unused for codeBlock
              language:
                typeof feature.language === 'string'
                  ? feature.language
                  : undefined,
              children: [],
            })
          }
          break
        }
        default:
          // Open union: unknown feature types render as plain text.
          break
      }
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// Block structure
// ---------------------------------------------------------------------------

/**
 * Arrange block ranges into a top-level sequence, nesting contained
 * cross-type blocks under blockquotes. Invalid structures are dropped:
 * partial overlaps, quote-in-quote containment, and anything contained in a
 * heading or codeBlock (their content is a single line / literal code).
 * Same-range block features resolve in array order — the first wins; a
 * same-range non-quote feature after a blockquote nests inside it.
 */
function arrangeBlocks(blocks: BlockRange[]): BlockRange[] {
  const sorted = [...blocks].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  )
  const top: BlockRange[] = []

  for (const block of sorted) {
    const last = top[top.length - 1]
    if (!last || block.start >= last.end) {
      top.push(block)
      continue
    }
    // Overlaps the previous block: only cross-type containment inside a
    // blockquote is valid.
    if (
      last.kind === 'blockquote' &&
      block.kind !== 'blockquote' &&
      block.end <= last.end
    ) {
      const prevChild = last.children[last.children.length - 1]
      if (!prevChild || block.start >= prevChild.end) {
        last.children.push(block)
      }
    }
  }

  return top
}

// ---------------------------------------------------------------------------
// Inline structure
// ---------------------------------------------------------------------------

function clipRanges<T extends Range>(
  ranges: T[],
  start: number,
  end: number,
): T[] {
  return ranges
    .filter((r) => r.start < end && r.end > start)
    .map((r) => ({
      ...r,
      start: Math.max(r.start, start),
      end: Math.min(r.end, end),
    }))
    .sort((a, b) => a.start - b.start)
}

/** Merge overlapping or abutting spoiler ranges into a disjoint union; the
 * earliest-starting defined reason wins. */
function mergeSpoilers(spoilers: SpoilerRange[]): SpoilerRange[] {
  const sorted = [...spoilers].sort((a, b) => a.start - b.start)
  const merged: SpoilerRange[] = []
  for (const s of sorted) {
    const last = merged[merged.length - 1]
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end)
      last.reason = last.reason ?? s.reason
    } else {
      merged.push({ ...s })
    }
  }
  return merged
}

/** Input must already be sorted by start. Keeps the first of any
 * overlapping ranges; a later overlapping range is dropped entirely,
 * including its non-overlapping tail. */
function dropOverlaps<T extends Range>(sorted: T[]): T[] {
  const kept: T[] = []
  for (const r of sorted) {
    const last = kept[kept.length - 1]
    if (!last || r.start >= last.end) kept.push(r)
  }
  return kept
}

interface InlineContext {
  bytes: Uint8Array
  decoder: TextDecoder
  marks: MarkRange[]
  links: LinkRange[]
  spoilers: SpoilerRange[]
}

function textSegments(
  ctx: InlineContext,
  start: number,
  end: number,
): TextSegment[] {
  const marks = clipRanges(ctx.marks, start, end)
  const boundaries = new Set<number>([start, end])
  for (const m of marks) {
    boundaries.add(m.start)
    boundaries.add(m.end)
  }
  const points = [...boundaries].sort((a, b) => a - b)

  const segments: TextSegment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [s, e] = [points[i], points[i + 1]]
    const text = ctx.decoder.decode(ctx.bytes.subarray(s, e))
    if (!text) continue
    const active = marks.filter((m) => m.start <= s && m.end >= e)
    const segment: { type: 'text'; text: string } & Partial<
      Record<Mark, true>
    > = { type: 'text', text }
    for (const m of active) segment[m.mark] = true
    segments.push(segment)
  }
  return segments
}

function linkSpans(
  ctx: InlineContext,
  start: number,
  end: number,
): (TextSegment | LinkSpan)[] {
  const links = dropOverlaps(clipRanges(ctx.links, start, end))
  const out: (TextSegment | LinkSpan)[] = []
  let cursor = start
  for (const link of links) {
    out.push(...textSegments(ctx, cursor, link.start))
    const children = textSegments(ctx, link.start, link.end)
    if (children.length > 0) {
      out.push({
        type: 'link',
        href: link.href,
        external: link.external,
        children,
      })
    }
    cursor = link.end
  }
  out.push(...textSegments(ctx, cursor, end))
  return out
}

function inlinesWith<Spoiler>(
  ctx: InlineContext,
  start: number,
  end: number,
  spoilerNode: (
    spoiler: SpoilerRange,
    children: (TextSegment | LinkSpan)[],
  ) => Spoiler,
): (TextSegment | LinkSpan | Spoiler)[] {
  const spoilers = clipRanges(ctx.spoilers, start, end)
  const out: (TextSegment | LinkSpan | Spoiler)[] = []
  let cursor = start
  for (const spoiler of spoilers) {
    out.push(...linkSpans(ctx, cursor, spoiler.start))
    const children = linkSpans(ctx, spoiler.start, spoiler.end)
    if (children.length > 0) out.push(spoilerNode(spoiler, children))
    cursor = spoiler.end
  }
  out.push(...linkSpans(ctx, cursor, end))
  return out
}

function inlines(ctx: InlineContext, start: number, end: number): Inline[] {
  return inlinesWith(ctx, start, end, (spoiler, children): SpoilerSpan => ({
    type: 'spoiler',
    reason: spoiler.reason,
    children,
  }))
}

// ---------------------------------------------------------------------------
// Tree assembly
// ---------------------------------------------------------------------------

/** Trim the newline separators left over at block boundaries; interior
 * newlines are preserved (rendered with pre-wrap). */
function trimNewlines(
  ctx: InlineContext,
  start: number,
  end: number,
): Range | null {
  let s = start
  let e = end
  while (s < e && ctx.bytes[s] === 0x0a) s++
  while (e > s && ctx.bytes[e - 1] === 0x0a) e--
  return s < e ? { start: s, end: e } : null
}

function paragraphsForGap(
  ctx: InlineContext,
  start: number,
  end: number,
): ParagraphBlock[] {
  const range = trimNewlines(ctx, start, end)
  if (!range) return []
  const children = inlines(ctx, range.start, range.end)
  return children.length > 0 ? [{ type: 'paragraph', children }] : []
}

function blocksForRange(
  ctx: InlineContext,
  start: number,
  end: number,
  blockRanges: BlockRange[],
): Block[] {
  const out: Block[] = []
  let cursor = start
  for (const block of blockRanges) {
    out.push(...paragraphsForGap(ctx, cursor, block.start))
    switch (block.kind) {
      case 'heading':
        out.push({
          type: 'heading',
          level: block.level,
          children: inlines(ctx, block.start, block.end),
        })
        break
      case 'codeBlock':
        out.push({
          type: 'codeBlock',
          language: block.language,
          code: ctx.decoder.decode(ctx.bytes.subarray(block.start, block.end)),
        })
        break
      case 'blockquote': {
        const children = blocksForRange(
          ctx,
          block.start,
          block.end,
          block.children,
        ).filter(
          (b): b is ParagraphBlock | HeadingBlock | CodeBlock =>
            b.type !== 'blockquote',
        )
        out.push({ type: 'blockquote', level: block.level, children })
        break
      }
    }
    cursor = block.end
  }
  out.push(...paragraphsForGap(ctx, cursor, end))
  return out
}

/**
 * Build the render tree for `content` annotated by `facets`.
 *
 * `facets` is accepted as `unknown[]` because records arrive from the
 * network unvalidated; malformed entries are silently ignored (the text
 * must stay readable no matter what the facets say).
 */
export function buildRichText(
  content: string,
  facets: unknown[],
): readonly Block[] {
  const bytes = new TextEncoder().encode(content)
  const decoder = new TextDecoder()
  const annotations = parseAnnotations(bytes, decoder, facets)
  const ctx: InlineContext = {
    bytes,
    decoder,
    marks: annotations.marks,
    links: annotations.links,
    spoilers: mergeSpoilers(annotations.spoilers),
  }
  return blocksForRange(ctx, 0, bytes.length, arrangeBlocks(annotations.blocks))
}

// ---------------------------------------------------------------------------
// Image-aware tree assembly
// ---------------------------------------------------------------------------

interface Placement<Image> extends Range {
  facet: number
  image: Image
}

type Piece<Image> =
  | { kind: 'text'; range: Range }
  | { kind: 'image'; placement: Placement<Image> }

/** Cut `[start, end)` around the placements overlapping it: the uncovered
 * text pieces in order, each placement starting inside the range after the
 * text before it. Covered text appears in no piece. */
function cutAround<Image>(
  start: number,
  end: number,
  placements: readonly Placement<Image>[],
): Piece<Image>[] {
  const pieces: Piece<Image>[] = []
  let cursor = start
  for (const placement of placements) {
    if (placement.end <= start || placement.start >= end) continue
    if (placement.start > cursor) {
      pieces.push({
        kind: 'text',
        range: { start: cursor, end: placement.start },
      })
    }
    if (placement.start >= start) pieces.push({ kind: 'image', placement })
    cursor = Math.max(cursor, Math.min(placement.end, end))
  }
  if (cursor < end) pieces.push({ kind: 'text', range: { start: cursor, end } })
  return pieces
}

function placedInlines(
  ctx: InlineContext,
  start: number,
  end: number,
): PlacedInline[] {
  return inlinesWith(
    ctx,
    start,
    end,
    (spoiler, children): PlacedSpoilerSpan => ({
      type: 'spoiler',
      reason: spoiler.reason,
      group: spoilerGroup(ctx, spoiler),
      children,
    }),
  )
}

/** Index of the merged spoiler a range lies in or overlaps, or -1. Merged
 * spoilers are disjoint, so the index identifies one spoiler. */
function spoilerGroup(ctx: InlineContext, range: Range): number {
  return ctx.spoilers.findIndex(
    (spoiler) => spoiler.start < range.end && spoiler.end > range.start,
  )
}

function imageBlock<Image>(
  ctx: InlineContext,
  placement: Placement<Image>,
): PlacedImageBlock<Image> {
  const group = spoilerGroup(ctx, placement)
  const block = {
    type: 'image',
    facet: placement.facet,
    image: placement.image,
  } as const
  return group < 0
    ? block
    : { ...block, spoiler: { group, reason: ctx.spoilers[group].reason } }
}

function placedGap<Image>(
  ctx: InlineContext,
  start: number,
  end: number,
  placements: readonly Placement<Image>[],
): (PlacedParagraphBlock | PlacedImageBlock<Image>)[] {
  const out: (PlacedParagraphBlock | PlacedImageBlock<Image>)[] = []
  for (const piece of cutAround(start, end, placements)) {
    if (piece.kind === 'image') {
      out.push(imageBlock(ctx, piece.placement))
      continue
    }
    const range = trimNewlines(ctx, piece.range.start, piece.range.end)
    if (!range) continue
    const children = placedInlines(ctx, range.start, range.end)
    if (children.length > 0) out.push({ type: 'paragraph', children })
  }
  return out
}

function placedBlocksForRange<Image>(
  ctx: InlineContext,
  start: number,
  end: number,
  blockRanges: BlockRange[],
  placements: readonly Placement<Image>[],
): PlacedBlock<Image>[] {
  const out: PlacedBlock<Image>[] = []
  let cursor = start
  for (const block of blockRanges) {
    out.push(...placedGap(ctx, cursor, block.start, placements))
    const pieces = cutAround(block.start, block.end, placements)
    const textRanges = pieces.flatMap((piece) =>
      piece.kind === 'text' ? [piece.range] : [],
    )
    // A placement in a heading or code block follows it.
    const images = pieces.flatMap((piece) =>
      piece.kind === 'image' ? [imageBlock(ctx, piece.placement)] : [],
    )
    switch (block.kind) {
      case 'heading':
        out.push(
          {
            type: 'heading',
            level: block.level,
            children: textRanges.flatMap((range) =>
              placedInlines(ctx, range.start, range.end),
            ),
          },
          ...images,
        )
        break
      case 'codeBlock':
        out.push(
          {
            type: 'codeBlock',
            language: block.language,
            code: textRanges
              .map((range) =>
                ctx.decoder.decode(ctx.bytes.subarray(range.start, range.end)),
              )
              .join(''),
          },
          ...images,
        )
        break
      case 'blockquote': {
        const children = placedBlocksForRange(
          ctx,
          block.start,
          block.end,
          block.children,
          placements,
        ).filter(
          (child): child is PlacedBlockquoteBlock<Image>['children'][number] =>
            child.type !== 'blockquote',
        )
        out.push({ type: 'blockquote', level: block.level, children })
        break
      }
    }
    cursor = block.end
  }
  out.push(...placedGap(ctx, cursor, end, placements))
  return out
}

/**
 * Build the render tree for `content` with each accepted placement in
 * `placed` (facet position → image, as `imageLayout` returns it) drawn as an
 * image block in place of its covered text. `placed` must hold only accepted
 * placements; `buildRichText` is the tree without them.
 */
export function buildRichTextWithPlacements<Image = EmbedImage>(
  content: string,
  facets: unknown[],
  placed: ReadonlyMap<number, Image>,
): readonly PlacedBlock<Image>[] {
  const bytes = new TextEncoder().encode(content)
  const decoder = new TextDecoder()
  const annotations = parseAnnotations(bytes, decoder, facets)
  const ctx: InlineContext = {
    bytes,
    decoder,
    marks: annotations.marks,
    links: annotations.links,
    spoilers: mergeSpoilers(annotations.spoilers),
  }
  const placements = [...placed]
    .flatMap(([facet, image]): Placement<Image>[] => {
      const range = facetByteRange(facets[facet])
      return range ? [{ ...range, facet, image }] : []
    })
    .sort((a, b) => a.start - b.start)
  return placedBlocksForRange(
    ctx,
    0,
    bytes.length,
    arrangeBlocks(annotations.blocks),
    placements,
  )
}
