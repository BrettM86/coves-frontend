/**
 * Inverse of `parseMarkup`: turns canonical content plus facets back into the
 * editor's markup, so an existing record can be loaded into the editor and
 * recompiled on save.
 *
 * The round trip is the contract: `parseMarkup(serializeMarkup(c, f))` must
 * yield `c` and reader-equivalent facets for every tree the reader can build.
 * That is why plain text carrying marker characters comes back escaped.
 *
 * The input is the reader's image-aware render tree rather than the raw
 * facets. Records arrive from the network unvalidated, and the tree builder
 * already drops or clamps everything malformed, so a bad facet costs an
 * annotation here instead of making the editor unopenable.
 *
 * Each accepted `#image` placement goes back as its `![covered text](image:N)`
 * token at its own position. A placement the token cannot express — its range
 * cut by another facet, inside link or mention text, or spanning a line — is
 * dropped and reported, and its covered text stays as ordinary text.
 */

import {
  FEATURE_TYPE,
  MAX_FACETS,
  buildRichTextWithPlacements,
  facetByteRange,
  type CodeBlock,
  type FacetLevel,
  type LinkSpan,
  type PlacedBlock,
  type PlacedInline,
  type Range,
  type TextSegment,
} from './facets'
import { placedImageIndexes } from './image-layout'

const FENCE_MARKER = '```'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Inline markers, which mean something anywhere on a line. */
const ALWAYS_ESCAPED: ReadonlySet<string> = new Set([
  '\\',
  '*',
  '_',
  '~',
  '`',
  '[',
  ']',
])

/** Block markers, which mean something only where a line begins. */
const LINE_START_ESCAPED: ReadonlySet<string> = new Set(['#', '>'])

/** Sticky: matched at a known index, never searched for. */
const URL_SCHEME = /https?:\/\//y

/**
 * Plain text as markup: every character that would compile back into a
 * construct is escaped, so text the author typed literally stays literal.
 *
 * `atLineStart` decides the block markers. A '#' mid-sentence is a '#', and
 * escaping it would put a backslash in front of every C# in the editor.
 */
function escapeText(text: string, atLineStart: boolean): string {
  let out = ''
  let lineStart = atLineStart
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '\n') {
      out += char
      lineStart = true
      index += 1
      continue
    }
    if (
      ALWAYS_ESCAPED.has(char) ||
      (lineStart && LINE_START_ESCAPED.has(char)) ||
      (lineStart && char === ':' && text.startsWith(':::', index))
    ) {
      out += `\\${char}`
      lineStart = false
      index += 1
      continue
    }
    if (char === 'h') {
      URL_SCHEME.lastIndex = index
      const scheme = URL_SCHEME.exec(text)
      if (scheme) {
        // Break the autolink at its colon: the same characters come back out,
        // but the parser no longer sees a scheme and emits no link facet.
        out += scheme[0].replace(':', '\\:')
        index += scheme[0].length
        lineStart = false
        continue
      }
    }
    out += char
    lineStart = false
    index += 1
  }
  return out
}

type MarkName = 'strikethrough' | 'bold' | 'italic' | 'code'

/**
 * A placement written back as its token. `text` is the covered text, which is
 * what the token stands for in the content; `markup` is the token itself. The
 * marks are the emphasis ranges that contain the whole placement.
 */
interface PlacementSegment {
  readonly type: 'placement'
  readonly text: string
  readonly markup: string
  readonly bold?: true
  readonly italic?: true
  readonly strikethrough?: true
}

type Segment = TextSegment | PlacementSegment

/** A spoiler with every piece of one reader group joined back together. */
interface WriteSpoiler {
  readonly type: 'spoiler'
  readonly reason?: string
  readonly group: number
  readonly children: (Segment | LinkSpan)[]
}

type WriteInline = Segment | LinkSpan | WriteSpoiler

interface WriteParagraph {
  readonly type: 'paragraph'
  readonly children: WriteInline[]
}

interface WriteHeading {
  readonly type: 'heading'
  readonly level: FacetLevel
  readonly children: WriteInline[]
}

interface WriteBlockquote {
  readonly type: 'blockquote'
  readonly level: FacetLevel
  readonly children: (WriteParagraph | WriteHeading | CodeBlock)[]
}

/** The render tree with every placement back inside the text it came from. */
type WriteBlock = WriteParagraph | WriteHeading | CodeBlock | WriteBlockquote

const MARK_MARKERS: Readonly<Record<MarkName, string>> = {
  strikethrough: '~~',
  bold: '**',
  italic: '*',
  code: '`',
}

/** Fixed nesting order, outermost first, so a given set of marks always comes
 * back out as the same set. */
const MARK_NESTING: readonly MarkName[] = [
  'strikethrough',
  'bold',
  'italic',
  'code',
]

/**
 * A code span's contents are verbatim, which is also its limit: a backtick
 * would close the span early and a newline would end the line it lives on.
 * Either way the mark is dropped and the characters are escaped instead,
 * because the content has to come back identical and the mark does not.
 */
function spannableCode(segment: Segment): boolean {
  return (
    segment.type === 'text' &&
    Boolean(segment.code) &&
    !/[`\n]/.test(segment.text)
  )
}

/** The marks this segment is actually written with, in nesting order. */
function marksOf(segment: Segment): MarkName[] {
  return MARK_NESTING.filter((mark) =>
    mark === 'code' ? spannableCode(segment) : Boolean(segment[mark]),
  )
}

function isSegment(child: WriteInline): child is Segment {
  return child.type === 'text' || child.type === 'placement'
}

/**
 * A run of text segments, opening and closing markers only where the marks
 * change.
 *
 * Wrapping each segment on its own would re-open an enclosing mark on every one
 * of them: the parse of `*a **b** c*` is an italic range with a bold range
 * inside it, and per-segment wrapping writes that back as `*a ****b**** c*`,
 * which reparses as something else entirely. Marks already open stay open, so
 * they nest; the rest open in a fixed order.
 */
function segmentsToMarkup(
  segments: readonly Segment[],
  atLineStart: boolean,
): string {
  let out = ''
  let open: MarkName[] = []
  let lineStart = atLineStart

  for (const segment of segments) {
    const wanted = marksOf(segment)
    // Marks stay open only while they match from the outside in; the first
    // mismatch closes everything inside it too.
    let kept = 0
    while (kept < open.length && wanted.includes(open[kept])) kept += 1
    for (let index = open.length - 1; index >= kept; index -= 1) {
      out += MARK_MARKERS[open[index]]
    }
    open = open.slice(0, kept)
    for (const mark of MARK_NESTING) {
      if (wanted.includes(mark) && !open.includes(mark)) {
        out += MARK_MARKERS[mark]
        open.push(mark)
      }
    }

    if (segment.type === 'placement') out += segment.markup
    else if (open.includes('code')) out += segment.text
    else out += escapeText(segment.text, lineStart && open.length === 0)
    lineStart = open.length === 0 && segment.text.endsWith('\n')
  }

  for (let index = open.length - 1; index >= 0; index -= 1) {
    out += MARK_MARKERS[open[index]]
  }
  return out
}

/**
 * A link target that survives being read back. The markdown target ends at the
 * ')' matching its '(', so a balanced pair inside the URL comes back intact and
 * is left alone; an unbalanced one would truncate the link, so it is
 * percent-encoded instead.
 */
function linkTarget(href: string): string {
  if (parensBalanced(href)) return href
  return href.replaceAll('(', '%28').replaceAll(')', '%29')
}

function parensBalanced(value: string): boolean {
  let depth = 0
  for (const char of value) {
    if (char === '(') depth += 1
    else if (char === ')' && --depth < 0) return false
  }
  return depth === 0
}

/** A link's text never begins a line — a marker or a '[' always precedes it —
 * so nothing here needs the line-start rules. */
function linkToMarkup(span: LinkSpan): string {
  const text = span.children.map((child) => child.text).join('')
  const marked = span.children.some((child) => marksOf(child).length > 0)
  // A mention has nowhere to put its DID, so the text goes back as it is and
  // the resolver looks the handle up again on save. Marks over it are markup
  // and still have to be written.
  if (!span.external) {
    return marked ? segmentsToMarkup(span.children, false) : text
  }
  // Text that is already its own target reads better bare than as [x](x), and
  // the parser autolinks it back — but only while there is no mark to carry,
  // since a bare URL has nowhere to put one.
  if (text === span.href && !marked) return text
  return `[${segmentsToMarkup(span.children, false)}](${linkTarget(span.href)})`
}

/**
 * A spoiler is inline in the render tree but a block in the markup, so it can
 * only be written as a container where the content already begins and ends a
 * line. Anywhere else — mid-paragraph, or inside a quote where a container is
 * literal — it degrades to its contents: the annotation is lost, the words are
 * not. Inventing the line breaks would change the author's text.
 */
function spoilerToMarkup(
  span: WriteSpoiler,
  asContainer: boolean,
  atLineStart: boolean,
): string {
  const inner = inlinesToMarkup(
    span.children,
    false,
    asContainer || atLineStart,
  )
  if (!asContainer) return inner
  const opening = span.reason ? `::: spoiler ${span.reason}` : '::: spoiler'
  return `${opening}\n${inner}\n:::`
}

/** Whether this child's own content begins a new line, so a container before
 * it already has the break that closes it. */
function opensWithNewline(child: WriteInline | undefined): boolean {
  return (
    child !== undefined &&
    isSegment(child) &&
    marksOf(child).length === 0 &&
    child.text.startsWith('\n')
  )
}

/** A run of inlines, tracking where a line begins so the block markers and the
 * spoiler containers are only written where they read back the same. */
function inlinesToMarkup(
  children: readonly WriteInline[],
  containers: boolean,
  atLineStart: boolean,
): string {
  let out = ''
  let lineStart = atLineStart

  for (let position = 0; position < children.length; position += 1) {
    const child = children[position]
    if (isSegment(child)) {
      // Consecutive segments are one run: a mark spanning several of them has
      // to stay open across the lot.
      const run: Segment[] = []
      while (position < children.length) {
        const next = children[position]
        if (!isSegment(next)) break
        run.push(next)
        position += 1
      }
      position -= 1
      out += segmentsToMarkup(run, lineStart)
      const last = run[run.length - 1]
      lineStart = marksOf(last).length === 0 && last.text.endsWith('\n')
      continue
    }
    switch (child.type) {
      case 'link':
        out += linkToMarkup(child)
        lineStart = false
        break
      case 'spoiler': {
        // The container needs a line of its own at both ends, and may only use
        // breaks the content already has.
        const next = children[position + 1]
        const asContainer =
          containers &&
          lineStart &&
          (next === undefined || opensWithNewline(next))
        const written = spoilerToMarkup(child, asContainer, lineStart)
        out += written
        lineStart = asContainer ? false : written.endsWith('\n')
        break
      }
    }
  }

  return out
}

/** Whether `code` can go inside a fence without closing it early. */
function canFence(code: string): boolean {
  return !code.split('\n').some((line) => line.startsWith(FENCE_MARKER))
}

/**
 * Length of the content these inlines cover, in JS string units. The cursor
 * advances by this, never by the length of the markup.
 */
function inlineLength(child: WriteInline): number {
  if (isSegment(child)) return child.text.length
  return child.children.reduce(
    (total, nested) => total + inlineLength(nested),
    0,
  )
}

function inlinesLength(children: readonly WriteInline[]): number {
  return children.reduce((total, child) => total + inlineLength(child), 0)
}

/** The run of newlines at `start`: the block separator, which the render tree
 * does not carry. */
function newlineRun(content: string, start: number): string {
  let end = start
  while (end < content.length && content[end] === '\n') end += 1
  return content.slice(start, end)
}

interface Rendered {
  markup: string
  /** Index just past the content the block covers. */
  end: number
}

function blockToMarkup(
  block: WriteBlock,
  content: string,
  start: number,
  containers: boolean,
): Rendered {
  switch (block.type) {
    case 'paragraph':
      return {
        markup: inlinesToMarkup(block.children, containers, true),
        end: start + inlinesLength(block.children),
      }
    case 'heading':
      return {
        markup: `${'#'.repeat(block.level)} ${inlinesToMarkup(block.children, containers, false)}`,
        end: start + inlinesLength(block.children),
      }
    case 'codeBlock': {
      const end = start + block.code.length
      // A fence inside a quote is literal, and code holding a fence marker
      // would close its own block early. Both degrade to escaped text, which
      // costs the annotation rather than the code.
      if (!containers || !canFence(block.code)) {
        return { markup: escapeText(block.code, true), end }
      }
      const language = block.language ?? ''
      return {
        markup: `${FENCE_MARKER}${language}\n${block.code}\n${FENCE_MARKER}`,
        end,
      }
    }
    case 'blockquote': {
      const inner = blocksToMarkup(block.children, content, start, false)
      const prefix = '>'.repeat(block.level)
      // Every line of the quoted block carries the marker; the parser reads a
      // run of same-depth lines back as the one facet it came from.
      return {
        markup: inner.markup
          .split('\n')
          .map((line) => `${prefix} ${line}`)
          .join('\n'),
        end: inner.end,
      }
    }
  }
}

/**
 * A run of blocks, walking `content` alongside them.
 *
 * The render tree says what each block is but not how many blank lines sat
 * around it — the reader trims newlines at block boundaries. Those newlines are
 * canonical content, though, so losing one would turn opening an old comment in
 * the editor into a silent rewrite of it. The separators are therefore read
 * back off the content as the blocks are emitted; everything between two blocks
 * is newlines by construction, because any other character would itself have
 * become a block.
 */
function blocksToMarkup(
  blocks: readonly WriteBlock[],
  content: string,
  start: number,
  containers: boolean,
): Rendered {
  let markup = ''
  let cursor = start
  for (const block of blocks) {
    const separator = newlineRun(content, cursor)
    markup += separator
    cursor += separator.length
    const rendered = blockToMarkup(block, content, cursor, containers)
    markup += rendered.markup
    cursor = rendered.end
  }
  return { markup, end: cursor }
}

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------

/** A placement that will be written as a token, in content string indices. */
interface PlacementToken {
  readonly start: number
  readonly end: number
  readonly segment: PlacementSegment
  /** The reader's spoiler group the placement lies in, if any. */
  spoiler?: { readonly group: number; readonly reason?: string }
}

const MARK_FEATURES: Readonly<
  Record<string, 'bold' | 'italic' | 'strikethrough'>
> = {
  [FEATURE_TYPE.bold]: 'bold',
  [FEATURE_TYPE.italic]: 'italic',
  [FEATURE_TYPE.strikethrough]: 'strikethrough',
}

/** Feature types the reader draws, other than a placement's own. */
const DRAWN_FEATURES: ReadonlySet<string> = new Set(
  Object.values(FEATURE_TYPE).filter((type) => type !== FEATURE_TYPE.image),
)

/** Text inside a token's brackets, escaped so it compiles back to `text`. */
function escapeCovered(text: string): string {
  return text.replace(/[\\[\]]/g, '\\$&')
}

function drawnFeatureTypes(facet: unknown): string[] {
  if (typeof facet !== 'object' || facet === null) return []
  if (!('features' in facet) || !Array.isArray(facet.features)) return []
  return facet.features.flatMap((feature: unknown) =>
    typeof feature === 'object' &&
    feature !== null &&
    '$type' in feature &&
    typeof feature.$type === 'string' &&
    DRAWN_FEATURES.has(feature.$type)
      ? [feature.$type]
      : [],
  )
}

/**
 * The accepted placements the token can express, by facet position. A token's
 * covered text is plain and on one line, so a placement is dropped when
 * another drawn facet cuts its range rather than containing it, when it lies
 * in link or mention text, when another placement already covers its bytes,
 * or when its covered text spans a line.
 */
function placementTokens(
  content: string,
  facets: unknown[],
  imageCount: number,
  onDroppedPlacement: (() => void) | undefined,
): Map<number, PlacementToken> {
  const accepted = placedImageIndexes(imageCount, content, facets)
  const bytes = encoder.encode(content)
  const others = facets.slice(0, MAX_FACETS).flatMap((facet, position) => {
    const range = facetByteRange(facet)
    const types = drawnFeatureTypes(facet)
    return accepted.has(position) || !range || types.length === 0
      ? []
      : [{ range, types }]
  })
  const kept: Range[] = []
  const tokens = new Map<number, PlacementToken>()
  for (const [position, index] of accepted) {
    const range = facetByteRange(facets[position])
    if (!range) continue
    const covered = decoder.decode(bytes.subarray(range.start, range.end))
    const intersects = (other: Range) =>
      other.start < range.end && other.end > range.start
    const marks: Partial<Record<'bold' | 'italic' | 'strikethrough', true>> = {}
    let representable = !covered.includes('\n') && !kept.some(intersects)
    for (const other of others) {
      if (!intersects(other.range)) continue
      const contains =
        other.range.start <= range.start && other.range.end >= range.end
      const linked = other.types.some(
        (type) => type === FEATURE_TYPE.link || type === FEATURE_TYPE.mention,
      )
      if (!contains || linked) representable = false
      for (const type of other.types) {
        const mark = MARK_FEATURES[type]
        if (mark) marks[mark] = true
      }
    }
    if (!representable) {
      onDroppedPlacement?.()
      continue
    }
    kept.push(range)
    const start = decoder.decode(bytes.subarray(0, range.start)).length
    tokens.set(position, {
      start,
      end: start + covered.length,
      segment: {
        type: 'placement',
        text: covered,
        markup: `![${escapeCovered(covered)}](image:${index + 1})`,
        ...marks,
      },
    })
  }
  return tokens
}

/** Record the spoiler each placed image block lies in on its token. */
function collectSpoilers(
  blocks: readonly PlacedBlock<number>[],
  tokens: ReadonlyMap<number, PlacementToken>,
): void {
  for (const block of blocks) {
    if (block.type === 'blockquote') collectSpoilers(block.children, tokens)
    if (block.type !== 'image' || !block.spoiler) continue
    const token = tokens.get(block.facet)
    if (token) token.spoiler = block.spoiler
  }
}

function unreachable(node: never): never {
  throw new Error(`Unhandled render node: ${JSON.stringify(node)}`)
}

/** Append `inline`, joining a spoiler piece onto the piece of the same group
 * before it: the tree cuts a spoiler around each image it holds. */
function pushInline(children: WriteInline[], inline: WriteInline): void {
  const last = children[children.length - 1]
  if (
    inline.type === 'spoiler' &&
    last?.type === 'spoiler' &&
    last.group === inline.group
  ) {
    last.children.push(...inline.children)
    return
  }
  children.push(inline)
}

function writeInline(child: PlacedInline): WriteInline {
  switch (child.type) {
    case 'text':
    case 'link':
      return child
    case 'spoiler':
      return {
        type: 'spoiler',
        reason: child.reason,
        group: child.group,
        children: [...child.children],
      }
    default:
      return unreachable(child)
  }
}

function placementInline(token: PlacementToken): WriteInline {
  if (!token.spoiler) return token.segment
  return {
    type: 'spoiler',
    reason: token.spoiler.reason,
    group: token.spoiler.group,
    children: [token.segment],
  }
}

interface WriteContext {
  readonly content: string
  readonly tokens: ReadonlyMap<number, PlacementToken>
  /** The same tokens by start index. */
  readonly tokensByStart: ReadonlyMap<number, PlacementToken>
}

/**
 * A heading's inlines with its placements back in place. The tree draws a
 * heading's images after it with their covered text cut out, so each token
 * goes back at the child boundary where its covered text started.
 */
function headingInlines(
  context: WriteContext,
  children: readonly PlacedInline[],
  start: number,
): WriteInline[] {
  const out: WriteInline[] = []
  let cursor = start
  const insertTokens = () => {
    let token = context.tokensByStart.get(cursor)
    while (token) {
      pushInline(out, placementInline(token))
      cursor = token.end
      token = context.tokensByStart.get(cursor)
    }
  }
  for (const child of children) {
    insertTokens()
    const written = writeInline(child)
    pushInline(out, written)
    cursor += inlineLength(written)
  }
  insertTokens()
  return out
}

/**
 * Carry a spoiler across the line break before `first` when the open
 * paragraph ends in a piece of the same reader group: the tree cuts a spoiler
 * around each image block it holds, and only one container compiles back to
 * one facet. The break goes inside the spoiler so the two pieces can join.
 */
function joinSpoilerAcrossBreak(
  open: WriteParagraph,
  separator: string,
  first: WriteInline | undefined,
): boolean {
  const last = open.children[open.children.length - 1]
  if (
    last?.type !== 'spoiler' ||
    first?.type !== 'spoiler' ||
    last.group !== first.group
  )
    return false
  last.children.push({ type: 'text', text: separator })
  return true
}

/**
 * The image-aware tree turned back into text blocks, walking `content` from
 * `start`. An image block on the same line as the text around it rejoins that
 * text as one paragraph, so marks and spoilers around it stay one range, and
 * a spoiler running across lines around an image block stays one spoiler.
 */
function writeBlocks(
  context: WriteContext,
  blocks: readonly PlacedBlock<number>[],
  start: number,
): { blocks: WriteBlock[]; end: number } {
  const out: WriteBlock[] = []
  let cursor = start
  // The paragraph the next same-line piece joins, if the last block was one.
  let open: WriteParagraph | null = null
  const separate = () => {
    const separator = newlineRun(context.content, cursor)
    cursor += separator.length
    return separator
  }
  for (const block of blocks) {
    switch (block.type) {
      case 'image': {
        const token = context.tokens.get(block.facet)
        // A heading's placement was already written inside the heading.
        if (!token || token.start < cursor) break
        const inline = placementInline(token)
        const separator = context.content.slice(cursor, token.start)
        cursor = token.end
        if (
          open &&
          (separator === '' || joinSpoilerAcrossBreak(open, separator, inline))
        ) {
          pushInline(open.children, inline)
          break
        }
        open = { type: 'paragraph', children: [inline] }
        out.push(open)
        break
      }
      case 'paragraph': {
        const separator = separate()
        const children: WriteInline[] = []
        for (const child of block.children) {
          pushInline(children, writeInline(child))
        }
        cursor += inlinesLength(children)
        if (
          open &&
          (separator === '' ||
            joinSpoilerAcrossBreak(open, separator, children[0]))
        ) {
          for (const child of children) pushInline(open.children, child)
          break
        }
        open = { type: 'paragraph', children }
        out.push(open)
        break
      }
      case 'heading': {
        separate()
        const children = headingInlines(context, block.children, cursor)
        cursor += inlinesLength(children)
        out.push({ type: 'heading', level: block.level, children })
        open = null
        break
      }
      case 'codeBlock':
        separate()
        cursor += block.code.length
        out.push(block)
        open = null
        break
      case 'blockquote': {
        separate()
        const inner = writeBlocks(context, block.children, cursor)
        cursor = inner.end
        out.push({
          type: 'blockquote',
          level: block.level,
          children: inner.blocks.filter(
            (child): child is WriteBlockquote['children'][number] =>
              child.type !== 'blockquote',
          ),
        })
        open = null
        break
      }
      default:
        unreachable(block)
    }
  }
  return { blocks: out, end: cursor }
}

/**
 * Render `content` and its facets as editor markup. Placements are written as
 * tokens only for the `imageCount` images the record carries (none when
 * omitted); `onDroppedPlacement` hears about each one the token can't express.
 */
export function serializeMarkup(
  content: string,
  facets: unknown[],
  options?: { imageCount?: number; onDroppedPlacement?: () => void },
): string {
  const tokens = placementTokens(
    content,
    facets,
    options?.imageCount ?? 0,
    options?.onDroppedPlacement,
  )
  // Only the facet position matters here, so it stands in for the image.
  const placed = new Map([...tokens.keys()].map((facet) => [facet, facet]))
  const tree = buildRichTextWithPlacements(content, facets, placed)
  collectSpoilers(tree, tokens)
  const context: WriteContext = {
    content,
    tokens,
    tokensByStart: new Map(
      [...tokens.values()].map((token) => [token.start, token]),
    ),
  }
  const rendered = blocksToMarkup(
    writeBlocks(context, tree, 0).blocks,
    content,
    0,
    true,
  )
  // Whatever trails the last block is newlines, and they are content too.
  return rendered.markup + newlineRun(content, rendered.end)
}
