/**
 * Toolbar insertions for the markup editor, as a pure function so the caret
 * arithmetic can be tested without a textarea.
 *
 * Offsets are JS string indices, because that is what `HTMLTextAreaElement`
 * selection properties use. Byte offsets belong to the compiler, not here.
 */

export type MarkupKind =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'link'
  | 'heading'
  | 'quote'
  | 'codeBlock'
  | 'spoiler'

export interface MarkupInsertion {
  value: string
  selectionStart: number
  selectionEnd: number
}

const INLINE_MARKERS: Readonly<Record<string, string>> = {
  bold: '**',
  italic: '*',
  strikethrough: '~~',
  code: '`',
}

const LINE_MARKERS: Readonly<Record<string, string>> = {
  heading: '# ',
  quote: '> ',
}

const URL_PLACEHOLDER = 'https://example.com'
const SPOILER_OPENER = '::: spoiler '
const FENCE = '```'

/** Index where the line holding `index` begins. */
function lineStartOf(value: string, index: number): number {
  return index === 0 ? 0 : value.lastIndexOf('\n', index - 1) + 1
}

/** Whether a line-based construct has to open a new line: it does once there
 * is text ahead of the caret on this one. */
function needsLineBreak(value: string, index: number): boolean {
  return index > lineStartOf(value, index)
}

/** Wrap the selection in `marker` and leave the text selected, so typing
 * replaces the words rather than the markers. */
function wrapInline(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string,
): MarkupInsertion {
  const selected = value.slice(selectionStart, selectionEnd)
  const textStart = selectionStart + marker.length
  return {
    value: `${value.slice(0, selectionStart)}${marker}${selected}${marker}${value.slice(selectionEnd)}`,
    selectionStart: textStart,
    selectionEnd: textStart + selected.length,
  }
}

/** The selection becomes the link text; the placeholder url is what the author
 * has to replace, so it starts selected. */
function insertLink(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): MarkupInsertion {
  const opener = `[${value.slice(selectionStart, selectionEnd)}](`
  const urlStart = selectionStart + opener.length
  return {
    value: `${value.slice(0, selectionStart)}${opener}${URL_PLACEHOLDER})${value.slice(selectionEnd)}`,
    selectionStart: urlStart,
    selectionEnd: urlStart + URL_PLACEHOLDER.length,
  }
}

/** Prefix the caret's line with `marker`, starting a new line only when the
 * caret is not already at the beginning of one. */
function prefixLine(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string,
): MarkupInsertion {
  const selected = value.slice(selectionStart, selectionEnd)
  if (needsLineBreak(value, selectionStart)) {
    const textStart = selectionStart + 1 + marker.length
    return {
      value: `${value.slice(0, selectionStart)}\n${marker}${selected}${value.slice(selectionEnd)}`,
      selectionStart: textStart,
      selectionEnd: textStart + selected.length,
    }
  }
  const lineStart = lineStartOf(value, selectionStart)
  return {
    value: `${value.slice(0, lineStart)}${marker}${value.slice(lineStart)}`,
    selectionStart: selectionStart + marker.length,
    selectionEnd: selectionEnd + marker.length,
  }
}

/**
 * Wrap the selection in a container block. `caretInOpener` is where the caret
 * lands inside the opening line, and `selectsContent` says whether the wrapped
 * text stays selected instead — a fence selects the code, a spoiler leaves the
 * caret on the reason, which is the part that still has to be written.
 */
function wrapBlock(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  opener: string,
  closer: string,
  caretInOpener: number,
  selectsContent: boolean,
): MarkupInsertion {
  const selected = value.slice(selectionStart, selectionEnd)
  const suffix = value.slice(selectionEnd)
  const lead = needsLineBreak(value, selectionStart) ? '\n' : ''
  // The closing marker needs its own line: text left beside it would be read
  // as part of the block, or would stop it closing at all.
  const trail = suffix.length > 0 && !suffix.startsWith('\n') ? '\n' : ''
  const caret = selectionStart + lead.length + caretInOpener
  return {
    value: `${value.slice(0, selectionStart)}${lead}${opener}${selected}${closer}${trail}${suffix}`,
    selectionStart: caret,
    selectionEnd: selectsContent ? caret + selected.length : caret,
  }
}

/** Apply `kind` to the selection in `value` and report the new selection. */
export function insertMarkup(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  kind: MarkupKind,
): MarkupInsertion {
  switch (kind) {
    case 'bold':
    case 'italic':
    case 'strikethrough':
    case 'code':
      return wrapInline(
        value,
        selectionStart,
        selectionEnd,
        INLINE_MARKERS[kind],
      )
    case 'link':
      return insertLink(value, selectionStart, selectionEnd)
    case 'heading':
    case 'quote':
      return prefixLine(value, selectionStart, selectionEnd, LINE_MARKERS[kind])
    case 'codeBlock': {
      const opener = `${FENCE}\n`
      return wrapBlock(
        value,
        selectionStart,
        selectionEnd,
        opener,
        `\n${FENCE}`,
        opener.length,
        true,
      )
    }
    case 'spoiler':
      return wrapBlock(
        value,
        selectionStart,
        selectionEnd,
        `${SPOILER_OPENER}\n`,
        '\n:::',
        SPOILER_OPENER.length,
        false,
      )
  }
}
