/**
 * Write side of `social.coves.richtext.facet`: compiles the editor's
 * lightweight markup into the canonical plaintext plus facets that every
 * client renders, and back again for editing.
 *
 * The lexicon requires writers to strip the source markers — the text is
 * canonical and must stay readable without the facets — so the markup never
 * reaches the wire.
 *
 * The compiler runs in two passes, because the grammar is split that way: a
 * line pass decides the block constructs from whole lines, then an inline pass
 * scans each text run for marks, links and escapes. Offsets are recorded as JS
 * string indices while the content is assembled and converted to UTF-8 byte
 * offsets once, against the finished content.
 */

import { parseWebUrl } from '$lib/app/util/url'
import {
  isValidCommunityAddress,
  isValidCommunityName,
  isValidHandle,
} from '$lib/types/atproto'
import { FEATURE_TYPE, MAX_FACETS } from './facets'

/** A lexicon-shaped facet: a UTF-8 byte range plus the features over it. */
export interface RichTextFacet {
  index: { byteStart: number; byteEnd: number }
  features: Record<string, unknown>[]
}

/**
 * An `@handle` or `!community` span found in the source. Turning one into a
 * `#mention` facet needs a DID, which only the AppView can supply, so parsing
 * records the span and the resolver fills it in later.
 */
export interface PendingMention {
  kind: 'user' | 'community'
  /** Handle, community address, or bare community name — no sigil. */
  identifier: string
  byteStart: number
  byteEnd: number
}

export interface ParsedMarkup {
  /** Canonical plaintext: every source marker stripped. */
  content: string
  /** Facets over `content`, sorted by `byteStart`. */
  facets: RichTextFacet[]
  mentions: PendingMention[]
}

type Feature = Record<string, unknown>

/** A facet while the content is still being assembled: JS string indices. */
interface DraftFacet {
  start: number
  end: number
  features: Feature[]
}

/** A pending mention while the content is still being assembled. */
interface DraftMention {
  kind: 'user' | 'community'
  identifier: string
  start: number
  end: number
}

/** The content under construction, plus the facets recorded over it. */
interface Draft {
  chunks: string[]
  /** Length of the content so far, in JS string units. */
  length: number
  facets: DraftFacet[]
  mentions: DraftMention[]
  /** Output lines emitted so far, which is what the newline separators are
   * counted from. Source lines consumed as markup are not output lines. */
  lines: number
  /** Source index where each line starts, so a placement token's source
   * range can be recorded from inside a sliced text run. */
  lineStarts: number[]
  /** How many images are attached; a token naming none of them is literal. */
  imageCount: number
  /** Image numbers already placed: only the first token for each compiles. */
  placedImages: Set<number>
  placements: PlacementTokenRange[]
}

/** Where a recognised `![covered text](image:N)` token sits in the source. */
export interface PlacementTokenRange {
  /** The 1-based image number the token names. */
  number: number
  /** Source indices of the whole token, `start` inclusive, `end` exclusive. */
  start: number
  end: number
}

/**
 * Whether a text run may still produce links. Link text is already a link
 * target, so nothing inside it is autolinked and no mention is recorded there
 * either — a mention becomes a link once it resolves.
 */
interface InlineScope {
  readonly linkable: boolean
}

/** Characters a backslash can escape into a literal. */
const ESCAPABLE: ReadonlySet<string> = new Set([
  '*',
  '_',
  '~',
  '`',
  '[',
  ']',
  '#',
  '>',
  ':',
  '@',
  '!',
  '\\',
])

const EMPHASIS_MARKERS: ReadonlySet<string> = new Set(['*', '_', '~'])

/** Sentence punctuation reads as prose, not as part of a bare URL. */
const URL_TRAILING: ReadonlySet<string> = new Set([
  '.',
  ',',
  '!',
  '?',
  ';',
  ':',
  ')',
])

/** Sticky: matched at a known index, never searched for. */
const BARE_URL = /https?:\/\/[^\s`<>]+/y

/**
 * The characters a handle or a community address is made of. Neither admits an
 * underscore, so the run stops at one rather than capturing an identifier the
 * AppView would reject.
 */
const MENTION_BODY = /[A-Za-z0-9.\-@]+/y

/** Letters, digits and the underscore: what counts as being inside a word,
 * for the flanking rules and for where a URL or a sigil may start. */
const WORD_CHARACTER = /[\p{L}\p{N}_]/u

/** Sticky: the `(image:N)` target of a placement token, N from 1. */
const PLACEMENT_TARGET = /\(image:([1-9][0-9]*)\)/y

/** Line-level constructs, each matched against a whole line. */
const FENCE = /^```(.*)$/
const FENCE_MARKER = '```'
const SPOILER_OPEN = /^:::\s*spoiler\s*(.*)$/
const SPOILER_CLOSE = /^:::\s*$/
const HEADING = /^(#{1,6}) (.*)$/
const QUOTE = /^(>+) ?(.*)$/

/** Deepest quote nesting the lexicon allows. */
const MAX_QUOTE_LEVEL = 6
/** Lexicon bounds on `codeBlock.language` and `spoiler.reason`. */
const MAX_LANGUAGE_BYTES = 40
const MAX_REASON_GRAPHEMES = 32
const MAX_REASON_BYTES = 128

const encoder = new TextEncoder()
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * `value` cut to fit both caps, on grapheme boundaries so a multi-codepoint
 * emoji is never split (half a family emoji is replacement characters, and the
 * byte cap is the one that bites there: six of them are six graphemes but 150
 * bytes).
 */
function capText(
  value: string,
  maximumGraphemes: number,
  maximumBytes: number,
): string {
  let kept = ''
  let count = 0
  let bytes = 0
  for (const { segment } of graphemes.segment(value)) {
    if (count >= maximumGraphemes) break
    const size = encoder.encode(segment).length
    if (bytes + size > maximumBytes) break
    kept += segment
    count += 1
    bytes += size
  }
  return kept
}

function appendText(draft: Draft, text: string): void {
  if (text.length === 0) return
  draft.chunks.push(text)
  draft.length += text.length
}

/**
 * Record a facet starting at the current end of the content; the caller fills
 * in `end` once the annotated text has been appended.
 *
 * Opening the facet before parsing what it contains is what puts a containing
 * construct ahead of the ones nested inside it, so features merged onto one
 * range come out outermost-first — the order the reader resolves them in.
 */
function openFacet(draft: Draft, features: Feature[]): DraftFacet {
  const facet: DraftFacet = {
    start: draft.length,
    end: draft.length,
    features,
  }
  draft.facets.push(facet)
  return facet
}

// ---------------------------------------------------------------------------
// Scanning helpers
// ---------------------------------------------------------------------------

/** Length of the run of `marker` starting at `index`. */
function runLength(text: string, index: number, marker: string): number {
  let end = index
  while (end < text.length && text[end] === marker) end++
  return end - index
}

/**
 * Index just past a backslash escape or a code span at `index`, or null when
 * neither starts there. Both hide their contents from every other construct,
 * so every scan skips them the same way.
 */
function skipLiteral(text: string, index: number): number | null {
  const char = text[index]
  if (char === '\\') return index + 2
  if (char === '`') {
    const close = text.indexOf('`', index + 1)
    return close === -1 ? index + 1 : close + 1
  }
  return null
}

/**
 * An underscore run only opens emphasis when a non-word character precedes it,
 * and only closes when a non-word character follows. Identifiers and filenames
 * are full of underscores, and treating those as emphasis would delete
 * characters from the content. Asterisks carry no such restriction.
 */
function flanksEmphasis(marker: string, neighbor: string): boolean {
  return marker !== '_' || neighbor === '' || !WORD_CHARACTER.test(neighbor)
}

/**
 * Index of the run of `marker` exactly `width` long that closes the emphasis
 * opened at `from`, or -1.
 *
 * The width has to match exactly. A wider run belongs to an emphasis nested
 * inside this one — in `*a **b** c*` the `**` runs are the inner bold, and
 * closing the italic on the first of them would swallow the markers.
 */
function findClosingRun(
  draft: Draft,
  text: string,
  from: number,
  marker: string,
  width: number,
  scope: InlineScope,
): number {
  // A placement's covered text is plain, so an emphasis marker inside it can
  // never close a run opened outside it. The numbers claimed here are a copy:
  // nothing is placed until the inner text is actually compiled.
  const claimed = new Set(draft.placedImages)
  let index = from
  while (index < text.length) {
    const skipped = skipLiteral(text, index)
    if (skipped !== null) {
      index = skipped
      continue
    }
    if (scope.linkable && text[index] === '!') {
      const token = matchPlacementToken(text, index)
      if (token && acceptsPlacement(draft.imageCount, claimed, token.number)) {
        claimed.add(token.number)
        index = token.end
        continue
      }
    }
    if (text[index] === marker) {
      const length = runLength(text, index, marker)
      if (
        length === width &&
        flanksEmphasis(marker, text.slice(index + length, index + length + 1))
      ) {
        return index
      }
      index += length
      continue
    }
    index++
  }
  return -1
}

/** Index of the first unescaped `target` at or after `from`, or -1. */
function findUnescaped(text: string, from: number, target: string): number {
  let index = from
  while (index < text.length) {
    const skipped = skipLiteral(text, index)
    if (skipped !== null) {
      index = skipped
      continue
    }
    if (text[index] === target) return index
    index++
  }
  return -1
}

/**
 * A token-shaped `![covered text](image:N)` at `index`, or null. The bracket
 * text may hold balanced brackets (`[image]`); a backslash escape inside it
 * resolves to the escaped character and nothing else in it is markup.
 */
function matchPlacementToken(
  text: string,
  index: number,
): { covered: string; number: number; end: number } | null {
  if (!text.startsWith('![', index)) return null
  let covered = ''
  let depth = 0
  let cursor = index + 2
  while (cursor < text.length) {
    const char = text[cursor]
    const escaped = text.slice(cursor + 1, cursor + 2)
    if (char === '\\' && ESCAPABLE.has(escaped)) {
      covered += escaped
      cursor += 2
      continue
    }
    if (char === ']') {
      if (depth === 0) break
      depth -= 1
    } else if (char === '[') {
      depth += 1
    }
    covered += char
    cursor += 1
  }
  if (cursor >= text.length || covered.length === 0) return null
  PLACEMENT_TARGET.lastIndex = cursor + 1
  const target = PLACEMENT_TARGET.exec(text)
  if (!target) return null
  return {
    covered,
    number: Number(target[1]),
    end: PLACEMENT_TARGET.lastIndex,
  }
}

/** Whether a token for image `number` compiles: it names an attached image
 * and no earlier token placed that image. */
function acceptsPlacement(
  imageCount: number,
  placed: ReadonlySet<number>,
  number: number,
): boolean {
  return number <= imageCount && !placed.has(number)
}

// ---------------------------------------------------------------------------
// Inline constructs
// ---------------------------------------------------------------------------

/** Features for a `width`-wide run of `marker`, or null when that width means
 * nothing (a lone `~`, four asterisks). */
function emphasisFeatures(marker: string, width: number): Feature[] | null {
  if (marker === '~') {
    return width === 2 ? [{ $type: FEATURE_TYPE.strikethrough }] : null
  }
  switch (width) {
    case 3:
      // One facet carrying both features, outer emphasis first.
      return [{ $type: FEATURE_TYPE.bold }, { $type: FEATURE_TYPE.italic }]
    case 2:
      return [{ $type: FEATURE_TYPE.bold }]
    case 1:
      return [{ $type: FEATURE_TYPE.italic }]
    default:
      return null
  }
}

function maximumEmphasisWidth(marker: string): number {
  return marker === '~' ? 2 : 3
}

/**
 * Emphasis at `index`, returning the index just past the closing marker, or
 * null when the run opens nothing and stays literal.
 *
 * A run too wide to close at its full width falls back to the next narrower
 * emphasis — `****` closes as two `**` around nothing — but never to a single
 * marker, so an unclosed `**loud` stays literal instead of turning into
 * italics over `*loud`.
 */
function appendEmphasis(
  draft: Draft,
  text: string,
  index: number,
  marker: string,
  scope: InlineScope,
  offset: number,
): number | null {
  if (!flanksEmphasis(marker, text.slice(Math.max(index - 1, 0), index))) {
    return null
  }
  const opened = runLength(text, index, marker)
  const widest = Math.min(opened, maximumEmphasisWidth(marker))
  const narrowest = widest === 1 ? 1 : 2
  for (let width = widest; width >= narrowest; width--) {
    const features = emphasisFeatures(marker, width)
    if (!features) continue
    const close = findClosingRun(
      draft,
      text,
      index + width,
      marker,
      width,
      scope,
    )
    if (close === -1) continue
    const facet = openFacet(draft, features)
    appendInline(
      draft,
      text.slice(index + width, close),
      scope,
      offset + index + width,
    )
    facet.end = draft.length
    return close + width
  }
  return null
}

/** A code span's contents are verbatim: no marks, no links, no escapes. */
function appendCodeSpan(draft: Draft, text: string, index: number): number {
  const close = text.indexOf('`', index + 1)
  if (close === -1) {
    appendText(draft, '`')
    return index + 1
  }
  // An empty span annotates nothing, so the pair is literal text and neither
  // backtick opens anything. That is also what keeps a ``` fence marker intact
  // where it is not a fence, such as inside a quote line.
  if (close === index + 1) {
    appendText(draft, '``')
    return index + 2
  }
  const facet = openFacet(draft, [{ $type: FEATURE_TYPE.code }])
  appendText(draft, text.slice(index + 1, close))
  facet.end = draft.length
  return close + 1
}

/** Whether every ')' in `value` closes a '(' that opened before it. */
function parensBalanced(value: string): boolean {
  let depth = 0
  for (const char of value) {
    if (char === '(') depth += 1
    else if (char === ')' && --depth < 0) return false
  }
  return depth === 0
}

/** Index of the ')' matching the '(' at `open`, or -1. The last ')' closes the
 * markdown target; the ones a '(' in the URL opened belong to the URL. */
function findLinkTargetEnd(text: string, open: number): number {
  let depth = 0
  for (let index = open; index < text.length; index++) {
    const char = text[index]
    if (char === '(') depth += 1
    else if (char === ')' && --depth === 0) return index
  }
  return -1
}

/** Index of the ']' that balances the '[' just before `from`, or -1. */
function findBalancedClose(text: string, from: number): number {
  let depth = 0
  let index = from
  while (index < text.length) {
    const skipped = skipLiteral(text, index)
    if (skipped !== null) {
      index = skipped
      continue
    }
    if (text[index] === '[') depth += 1
    else if (text[index] === ']' && --depth < 0) return index
    index++
  }
  return -1
}

/**
 * `[text](url)`, or null when the markup is not a web link and stays literal.
 *
 * The label normally ends at the first ']'. When that reads as no link, a
 * label with balanced brackets is tried, so `[![x](image:1)](https://…)` is a
 * link whose text holds the token, and the token stays literal link text.
 */
function appendTitledLink(
  draft: Draft,
  text: string,
  index: number,
  offset: number,
): number | null {
  const first = findUnescaped(text, index + 1, ']')
  const linked = appendLinkWithLabelEnd(draft, text, index, first, offset)
  if (linked !== null) return linked
  const balanced = findBalancedClose(text, index + 1)
  if (balanced === first) return null
  return appendLinkWithLabelEnd(draft, text, index, balanced, offset)
}

function appendLinkWithLabelEnd(
  draft: Draft,
  text: string,
  index: number,
  labelEnd: number,
  offset: number,
): number | null {
  if (labelEnd === -1) return null
  if (text.slice(labelEnd + 1, labelEnd + 2) !== '(') return null
  const targetEnd = findLinkTargetEnd(text, labelEnd + 1)
  if (targetEnd === -1) return null
  const label = text.slice(index + 1, labelEnd)
  const target = text.slice(labelEnd + 2, targetEnd)
  // Only http(s) targets become facets; anything else (`javascript:`, a
  // relative path) leaves the whole construct as literal text.
  if (label.length === 0 || !parseWebUrl(target)) return null
  const facet = openFacet(draft, [{ $type: FEATURE_TYPE.link, uri: target }])
  appendInline(draft, label, { linkable: false }, offset + index + 1)
  facet.end = draft.length
  return targetEnd + 1
}

/** A bare `https?://…`, or null when nothing linkable starts at `index`. */
function appendBareUrl(
  draft: Draft,
  text: string,
  index: number,
): number | null {
  BARE_URL.lastIndex = index
  const match = BARE_URL.exec(text)
  if (!match) return null
  let url = match[0]
  while (url.length > 0 && URL_TRAILING.has(url.slice(-1))) {
    // A ')' the URL opened itself is part of the address, not the sentence.
    if (url.endsWith(')') && parensBalanced(url)) break
    url = url.slice(0, -1)
  }
  if (!parseWebUrl(url)) return null
  const facet = openFacet(draft, [{ $type: FEATURE_TYPE.link, uri: url }])
  appendText(draft, url)
  facet.end = draft.length
  return index + url.length
}

/**
 * The kind of mention `identifier` names under `sigil`, or null when it names
 * nothing the AppView could resolve. A community is either an address or a
 * bare name; the shapes come from the branded types so the grammar and they
 * admit exactly the same strings.
 */
function mentionKind(
  sigil: string,
  identifier: string,
): 'user' | 'community' | null {
  if (sigil === '@') return isValidHandle(identifier) ? 'user' : null
  return isValidCommunityAddress(identifier) || isValidCommunityName(identifier)
    ? 'community'
    : null
}

/**
 * An `@handle` or `!community` at `index`, or null when what follows the sigil
 * is not an identifier and the sigil stays literal text.
 *
 * The span is recorded rather than turned into a facet: a `#mention` needs a
 * DID, which only the AppView can supply. It covers the sigil, because that is
 * how the reader tells a community mention from a user one. Occurrences are not
 * deduplicated here — that belongs to the resolver, which makes the calls.
 */
function appendMention(
  draft: Draft,
  text: string,
  index: number,
  sigil: string,
): number | null {
  MENTION_BODY.lastIndex = index + 1
  const match = MENTION_BODY.exec(text)
  if (!match) return null
  let identifier = match[0]
  // Sentence punctuation after a mention reads as prose, the same way it does
  // after a bare URL.
  while (identifier.length > 0 && URL_TRAILING.has(identifier.slice(-1))) {
    identifier = identifier.slice(0, -1)
  }
  const kind = mentionKind(sigil, identifier)
  if (!kind) return null
  const start = draft.length
  appendText(draft, sigil + identifier)
  draft.mentions.push({ kind, identifier, start, end: draft.length })
  return index + 1 + identifier.length
}

/**
 * A URL or a mention starts where a word starts: `xhttps://example.com` is not
 * a link, and the sigil in `mail a@b.com` is not a mention.
 */
function startsWord(text: string, index: number): boolean {
  return index === 0 || !WORD_CHARACTER.test(text[index - 1])
}

/**
 * A placement token at `index`, or null when none compiles there and the text
 * stays literal. The covered text goes in as plain text under one facet whose
 * only feature is the `#image`.
 */
function appendPlacement(
  draft: Draft,
  text: string,
  index: number,
  offset: number,
): number | null {
  const token = matchPlacementToken(text, index)
  if (
    !token ||
    !acceptsPlacement(draft.imageCount, draft.placedImages, token.number)
  ) {
    return null
  }
  draft.placedImages.add(token.number)
  const facet = openFacet(draft, [
    { $type: FEATURE_TYPE.image, index: token.number - 1 },
  ])
  appendText(draft, token.covered)
  facet.end = draft.length
  draft.placements.push({
    number: token.number,
    start: offset + index,
    end: offset + token.end,
  })
  return token.end
}

/**
 * Scan one text run for inline constructs, appending its content and facets.
 * `offset` is the source index of the run's first character.
 */
function appendInline(
  draft: Draft,
  text: string,
  scope: InlineScope,
  offset: number,
): void {
  let index = 0
  while (index < text.length) {
    const char = text[index]

    // Link text is never a placement, the same way it is never a mention.
    if (char === '!' && scope.linkable) {
      const next = appendPlacement(draft, text, index, offset)
      if (next !== null) {
        index = next
        continue
      }
    }

    if (char === '\\') {
      const escaped = text.slice(index + 1, index + 2)
      if (ESCAPABLE.has(escaped)) {
        appendText(draft, escaped)
        index += 2
        continue
      }
      appendText(draft, char)
      index++
      continue
    }

    if (char === '`') {
      index = appendCodeSpan(draft, text, index)
      continue
    }

    if (char === '[' && scope.linkable) {
      const next = appendTitledLink(draft, text, index, offset)
      if (next !== null) {
        index = next
        continue
      }
    }

    if (char === 'h' && scope.linkable && startsWord(text, index)) {
      const next = appendBareUrl(draft, text, index)
      if (next !== null) {
        index = next
        continue
      }
    }

    if (
      (char === '@' || char === '!') &&
      scope.linkable &&
      startsWord(text, index)
    ) {
      const next = appendMention(draft, text, index, char)
      if (next !== null) {
        index = next
        continue
      }
    }

    if (EMPHASIS_MARKERS.has(char)) {
      const next = appendEmphasis(draft, text, index, char, scope, offset)
      if (next !== null) {
        index = next
        continue
      }
    }

    appendText(draft, char)
    index++
  }
}

// ---------------------------------------------------------------------------
// Block pass
// ---------------------------------------------------------------------------

const LINKABLE: InlineScope = { linkable: true }

/**
 * Start the next output line, emitting the separator that precedes it.
 *
 * Lines consumed as markup — a fence marker, a container marker — never get
 * here, so separators land only between lines that carry content. That is also
 * what keeps two adjacent spoiler containers from producing abutting ranges:
 * the newline between them belongs to neither facet, and the reader merges
 * spoiler ranges that touch.
 */
function startLine(draft: Draft): void {
  if (draft.lines > 0) appendText(draft, '\n')
  draft.lines += 1
}

/** Heading content and facet on a line that has already been started. */
function appendHeadingText(
  draft: Draft,
  level: number,
  text: string,
  offset: number,
): void {
  const facet = openFacet(draft, [{ $type: FEATURE_TYPE.heading, level }])
  appendInline(draft, text, LINKABLE, offset)
  facet.end = draft.length
}

/**
 * A run of quote lines at one depth, as ONE facet: the reader renders adjacent
 * same-level quote facets as separate blocks, so a run split across facets
 * would come out as several quotes. A depth change or any non-quote line —
 * a blank one included — ends the run, which is how nesting stays disjoint
 * ranges with increasing level; a quote range inside a quote range is invalid
 * to the reader.
 *
 * A heading is the one construct honored on a quote line; the quote facet is
 * opened first so the merged features name the container before the heading.
 */
function appendBlockquote(
  draft: Draft,
  lines: string[],
  index: number,
): number {
  const level = quoteLevel(lines[index])
  let facet: DraftFacet | null = null
  let cursor = index
  while (cursor < lines.length) {
    const quote = QUOTE.exec(lines[cursor])
    if (!quote || quoteLevel(lines[cursor]) !== level) break
    startLine(draft)
    facet ??= openFacet(draft, [{ $type: FEATURE_TYPE.blockquote, level }])
    // The quoted text runs to the end of the line, so it starts that far
    // back from the line's end.
    const quoted =
      draft.lineStarts[cursor] + lines[cursor].length - quote[2].length
    const heading = HEADING.exec(quote[2])
    if (heading) {
      const level = heading[1].length
      appendHeadingText(draft, level, heading[2], quoted + level + 1)
    } else {
      appendInline(draft, quote[2], LINKABLE, quoted)
    }
    cursor += 1
  }
  if (facet) facet.end = draft.length
  return cursor
}

/** Quote depth of `line`, clamped to what the lexicon can express. */
function quoteLevel(line: string): number {
  const quote = QUOTE.exec(line)
  return quote ? Math.min(quote[1].length, MAX_QUOTE_LEVEL) : 0
}

/** A fenced block: its lines are verbatim code, so no inline pass runs over
 * them. An unclosed fence runs to the end of the source. */
function appendFencedCode(
  draft: Draft,
  lines: string[],
  index: number,
  language: string,
): number {
  let close = index + 1
  while (close < lines.length && !lines[close].startsWith(FENCE_MARKER)) {
    close += 1
  }
  const feature: Feature = { $type: FEATURE_TYPE.codeBlock }
  const hint = capText(language, MAX_LANGUAGE_BYTES, MAX_LANGUAGE_BYTES)
  // A fence with no language has no `language` key at all, not an undefined
  // one: the wire record must match the lexicon's shape.
  if (hint.length > 0) feature.language = hint
  let facet: DraftFacet | null = null
  for (let inner = index + 1; inner < close; inner++) {
    startLine(draft)
    facet ??= openFacet(draft, [feature])
    appendText(draft, lines[inner])
  }
  if (facet) facet.end = draft.length
  return Math.min(close + 1, lines.length)
}

/**
 * A spoiler container, or null when it never closes and the opening line is
 * therefore literal text. Block constructs inside are literal; inline marks
 * are parsed.
 */
function appendSpoiler(
  draft: Draft,
  lines: string[],
  index: number,
  reason: string,
): number | null {
  let close = index + 1
  while (close < lines.length && !SPOILER_CLOSE.test(lines[close])) {
    close += 1
  }
  if (close >= lines.length) return null
  const feature: Feature = { $type: FEATURE_TYPE.spoiler }
  const trimmed = capText(reason, MAX_REASON_GRAPHEMES, MAX_REASON_BYTES)
  if (trimmed.length > 0) feature.reason = trimmed
  let facet: DraftFacet | null = null
  for (let inner = index + 1; inner < close; inner++) {
    startLine(draft)
    facet ??= openFacet(draft, [feature])
    appendInline(draft, lines[inner], LINKABLE, draft.lineStarts[inner])
  }
  if (facet) facet.end = draft.length
  return close + 1
}

/** Compile the block construct at `index`, returning the next line to read. */
function appendBlock(draft: Draft, lines: string[], index: number): number {
  const line = lines[index]

  const fence = FENCE.exec(line)
  if (fence) return appendFencedCode(draft, lines, index, fence[1].trim())

  const container = SPOILER_OPEN.exec(line)
  if (container) {
    const next = appendSpoiler(draft, lines, index, container[1].trim())
    if (next !== null) return next
  }

  if (QUOTE.test(line)) return appendBlockquote(draft, lines, index)

  const heading = HEADING.exec(line)
  if (heading) {
    startLine(draft)
    const level = heading[1].length
    appendHeadingText(
      draft,
      level,
      heading[2],
      draft.lineStarts[index] + level + 1,
    )
    return index + 1
  }

  startLine(draft)
  appendInline(draft, line, LINKABLE, draft.lineStarts[index])
  return index + 1
}

/**
 * The block grammar is line-based, so the source is split once and every
 * construct is decided from whole lines before any inline scanning happens.
 * A block facet spans whole lines and stops before the trailing newline, which
 * is what lets the reader place it without guessing.
 */
function appendBlocks(draft: Draft, source: string): void {
  const lines = source.split('\n')
  let start = 0
  for (const line of lines) {
    draft.lineStarts.push(start)
    start += line.length + 1
  }
  let index = 0
  while (index < lines.length) {
    index = appendBlock(draft, lines, index)
  }
}

// ---------------------------------------------------------------------------
// Offsets and output
// ---------------------------------------------------------------------------

/**
 * UTF-8 byte offset of every JS string index in `content`, computed once so a
 * facet's range is never re-encoded. A surrogate pair's four bytes are
 * attributed to its leading unit; the parser never splits one.
 */
function byteOffsets(content: string): number[] {
  const offsets = new Array<number>(content.length + 1)
  let bytes = 0
  let index = 0
  while (index < content.length) {
    offsets[index] = bytes
    const code = content.charCodeAt(index)
    if (code < 0x80) {
      bytes += 1
      index += 1
      continue
    }
    if (code < 0x800) {
      bytes += 2
      index += 1
      continue
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const trailing = content.charCodeAt(index + 1)
      if (trailing >= 0xdc00 && trailing <= 0xdfff) {
        bytes += 4
        offsets[index + 1] = bytes
        index += 2
        continue
      }
    }
    // Everything else, unpaired surrogates included, encodes as three bytes.
    bytes += 3
    index += 1
  }
  offsets[content.length] = bytes
  return offsets
}

function toFacets(draft: Draft, offsets: number[]): RichTextFacet[] {
  const ranged = draft.facets
    .map((facet) => ({
      index: {
        byteStart: offsets[facet.start],
        byteEnd: offsets[facet.end],
      },
      features: facet.features,
    }))
    // An empty construct (`****`) strips its markers but annotates nothing,
    // and a zero-length facet is never valid.
    .filter((facet) => facet.index.byteStart < facet.index.byteEnd)
    // Sorted by byteStart, as the lexicon asks. The sort is stable, so
    // features merged onto one range stay outermost-first.
    .sort((a, b) => a.index.byteStart - b.index.byteStart)

  const byRange = new Map<string, RichTextFacet>()
  const merged: RichTextFacet[] = []
  for (const facet of ranged) {
    // A placement keeps a facet of its own, whatever else covers its bytes:
    // the `#image` feature is the facet's only feature.
    if (
      facet.features.some((feature) => feature.$type === FEATURE_TYPE.image)
    ) {
      merged.push(facet)
      continue
    }
    const existing = byRange.get(
      `${facet.index.byteStart}:${facet.index.byteEnd}`,
    )
    if (existing) {
      // The reader applies a facet's features to the same bytes as a set, so
      // one range is one facet.
      existing.features.push(...facet.features)
      continue
    }
    byRange.set(`${facet.index.byteStart}:${facet.index.byteEnd}`, facet)
    merged.push(facet)
  }
  // The lexicon caps a record at 200 facets; the earliest ones survive.
  return merged.slice(0, MAX_FACETS)
}

/**
 * The same content and facets with the content trimmed, every facet shifted by
 * what was removed from the front and clipped to what is left at the back.
 *
 * The trim has to happen to the CANONICAL content, not to the source: markup
 * strips characters, so whitespace can end up at the edges of the compiled text
 * even when the source had none there (a code span holding padding, a fence
 * with a trailing blank line). The backend trims the content and then validates
 * the facets against the trimmed text, so a facet measured before the trim
 * points at the wrong bytes — or past the end.
 *
 * A facet left with nothing to annotate is dropped, and `facets` is absent when
 * none remain.
 */
export function trimRichText(composed: {
  content: string
  facets?: RichTextFacet[]
}): { content: string; facets?: RichTextFacet[] } {
  const trimmed = composed.content.trim()
  if (trimmed === composed.content) return composed

  const removed = composed.content.length - composed.content.trimStart().length
  // Measured with the encoder rather than counted: trimmed whitespace is not
  // always one byte per character.
  const leading = encoder.encode(composed.content.slice(0, removed)).length
  const limit = encoder.encode(trimmed).length

  const facets: RichTextFacet[] = []
  for (const facet of composed.facets ?? []) {
    const byteStart = Math.max(facet.index.byteStart - leading, 0)
    const byteEnd = Math.min(facet.index.byteEnd - leading, limit)
    if (byteStart >= byteEnd) continue
    facets.push({ index: { byteStart, byteEnd }, features: facet.features })
  }

  return facets.length > 0 ? { content: trimmed, facets } : { content: trimmed }
}

function compile(source: string, imageCount: number): Draft {
  const draft: Draft = {
    chunks: [],
    length: 0,
    facets: [],
    mentions: [],
    lines: 0,
    lineStarts: [],
    imageCount,
    placedImages: new Set(),
    placements: [],
  }
  appendBlocks(draft, source)
  return draft
}

/**
 * The placement tokens `parseMarkup` would compile in `source` given
 * `imageCount` attached images, in source order. `source` must already use
 * `\n` line endings (a textarea's value does), or the indices drift.
 */
export function findPlacementTokens(
  source: string,
  imageCount: number,
): PlacementTokenRange[] {
  return compile(source, imageCount).placements
}

/**
 * Compile editor markup into canonical plaintext, facets and pending mentions.
 * A `![covered text](image:N)` token compiles to a placement only when
 * `imageCount` (0 when omitted) covers N.
 */
export function parseMarkup(
  source: string,
  options?: { imageCount?: number },
): ParsedMarkup {
  // Offsets are measured over the content that ships, so line endings are
  // normalized before anything else looks at the source.
  const normalized = source.replace(/\r\n?/g, '\n')
  const draft = compile(normalized, options?.imageCount ?? 0)
  const content = draft.chunks.join('')
  const offsets = byteOffsets(content)
  return {
    content,
    facets: toFacets(draft, offsets),
    mentions: draft.mentions.map((mention) => ({
      kind: mention.kind,
      identifier: mention.identifier,
      byteStart: offsets[mention.start],
      byteEnd: offsets[mention.end],
    })),
  }
}
