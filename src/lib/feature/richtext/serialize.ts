/**
 * Inverse of `parseMarkup`: turns canonical content plus facets back into the
 * editor's markup, so an existing record can be loaded into the editor and
 * recompiled on save.
 *
 * The round trip is the contract: `parseMarkup(serializeMarkup(c, f))` must
 * yield `c` and reader-equivalent facets for every tree the reader can build.
 * That is why plain text carrying marker characters comes back escaped.
 *
 * The input is the reader's render tree rather than the raw facets. Records
 * arrive from the network unvalidated, and `buildRichText` already drops or
 * clamps everything malformed, so a bad facet costs an annotation here instead
 * of making the editor unopenable.
 */

import {
  buildRichText,
  type Block,
  type Inline,
  type LinkSpan,
  type SpoilerSpan,
  type TextSegment,
} from './facets'

const FENCE_MARKER = '```'

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
function spannableCode(segment: TextSegment): boolean {
  return Boolean(segment.code) && !/[`\n]/.test(segment.text)
}

/** The marks this segment is actually written with, in nesting order. */
function marksOf(segment: TextSegment): MarkName[] {
  return MARK_NESTING.filter((mark) =>
    mark === 'code' ? spannableCode(segment) : Boolean(segment[mark]),
  )
}

function isTextSegment(child: Inline): child is TextSegment {
  return child.type === 'text'
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
  segments: readonly TextSegment[],
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

    out += open.includes('code')
      ? segment.text
      : escapeText(segment.text, lineStart && open.length === 0)
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
  span: SpoilerSpan,
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
function opensWithNewline(child: Inline | undefined): boolean {
  return (
    child !== undefined &&
    isTextSegment(child) &&
    marksOf(child).length === 0 &&
    child.text.startsWith('\n')
  )
}

/** A run of inlines, tracking where a line begins so the block markers and the
 * spoiler containers are only written where they read back the same. */
function inlinesToMarkup(
  children: readonly Inline[],
  containers: boolean,
  atLineStart: boolean,
): string {
  let out = ''
  let lineStart = atLineStart

  for (let position = 0; position < children.length; position += 1) {
    const child = children[position]
    if (isTextSegment(child)) {
      // Consecutive segments are one run: a mark spanning several of them has
      // to stay open across the lot.
      const run: TextSegment[] = []
      while (position < children.length) {
        const next = children[position]
        if (!isTextSegment(next)) break
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
function inlineLength(child: Inline): number {
  if (child.type === 'text') return child.text.length
  return child.children.reduce(
    (total, nested) => total + inlineLength(nested),
    0,
  )
}

function inlinesLength(children: readonly Inline[]): number {
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
  block: Block,
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
  blocks: readonly Block[],
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

/** Render `content` and its facets as editor markup. */
export function serializeMarkup(content: string, facets: unknown[]): string {
  const rendered = blocksToMarkup(
    buildRichText(content, facets),
    content,
    0,
    true,
  )
  // Whatever trails the last block is newlines, and they are content too.
  return rendered.markup + newlineRun(content, rendered.end)
}
