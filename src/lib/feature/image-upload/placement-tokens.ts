/**
 * Placement tokens in the composer text. Insert in text writes a
 * `![covered text](image:N)` token for a strip tile, and removing or
 * reordering images renumbers the tokens to match the strip.
 *
 * Recognition is `parseMarkup`'s own (`findPlacementTokens`), so token-shaped
 * text the compiler leaves literal — inside code, inside link text, a repeated
 * or out-of-range number — is never touched.
 */
import {
  findPlacementTokens,
  type PlacementTokenRange,
} from '$lib/feature/richtext/compose'

/** Most graphemes of alt text a token's covered text carries. */
const MAX_COVERED_GRAPHEMES = 100

/** Covered text when the image has no alt text. */
const DEFAULT_COVERED_TEXT = '[image]'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Whether every ']' in `value` closes a '[' that opened before it. */
function bracketsBalanced(value: string): boolean {
  let depth = 0
  for (const char of value) {
    if (char === '[') depth += 1
    else if (char === ']' && --depth < 0) return false
  }
  return depth === 0
}

/**
 * The token for image `number`, its covered text taken from `alt`: whitespace
 * runs collapsed, trimmed, cut to 100 graphemes, `[image]` when nothing is
 * left. Backslashes, and brackets that do not balance, are escaped so the
 * token compiles back to exactly that covered text.
 */
export function placementToken(alt: string, number: number): string {
  const collapsed = alt.replace(/\s+/g, ' ').trim()
  let covered = ''
  let count = 0
  for (const { segment } of graphemes.segment(collapsed)) {
    if (count >= MAX_COVERED_GRAPHEMES) break
    covered += segment
    count += 1
  }
  if (covered.length === 0) covered = DEFAULT_COVERED_TEXT
  let escaped = covered.replaceAll('\\', '\\\\')
  if (!bracketsBalanced(covered)) escaped = escaped.replace(/[[\]]/g, '\\$&')
  return `![${escaped}](image:${number})`
}

/**
 * `text` with the token for image `number` inserted at `caret` on a line of
 * its own, and the caret just after the token.
 */
export function insertPlacementToken(
  text: string,
  caret: number,
  alt: string,
  number: number,
): { text: string; caret: number } {
  const token = placementToken(alt, number)
  const before = text.slice(0, caret)
  const after = text.slice(caret)
  const leading = before.length === 0 || before.endsWith('\n') ? '' : '\n'
  const trailing = after.length === 0 || after.startsWith('\n') ? '' : '\n'
  return {
    text: before + leading + token + trailing + after,
    caret: caret + leading.length + token.length,
  }
}

/**
 * Rewrite each recognised token: `renumber` returns its new number, or null to
 * delete the token. Only the token's own characters change.
 */
function rewriteTokens(
  text: string,
  imageCount: number,
  renumber: (number: number) => number | null,
): string {
  // The recognised ranges are indices into LF text, which a textarea's value
  // already is.
  const source = text.replace(/\r\n?/g, '\n')
  const tokens: PlacementTokenRange[] = findPlacementTokens(source, imageCount)
  let rewritten = ''
  let cursor = 0
  for (const token of tokens) {
    rewritten += source.slice(cursor, token.start)
    const number = renumber(token.number)
    if (number !== null) {
      rewritten += source
        .slice(token.start, token.end)
        .replace(/\(image:[0-9]+\)$/, `(image:${number})`)
    }
    cursor = token.end
  }
  return rewritten + source.slice(cursor)
}

/**
 * `text` after image `removed` left a strip of `imageCount` images: its token
 * is deleted and the tokens for the images after it move down by one.
 */
export function removePlacementToken(
  text: string,
  removed: number,
  imageCount: number,
): string {
  return rewriteTokens(text, imageCount, (number) => {
    if (number === removed) return null
    return number > removed ? number - 1 : number
  })
}

/**
 * `text` after the strip was reordered: `order[i]` is the old number of the
 * image now at position i + 1, and each token takes its image's new number.
 */
export function reorderPlacementTokens(
  text: string,
  order: readonly number[],
): string {
  return rewriteTokens(text, order.length, (number) => {
    const position = order.indexOf(number)
    return position === -1 ? number : position + 1
  })
}
