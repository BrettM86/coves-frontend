/**
 * Toolbar insertions. Two things make this worth a pure module: the caret has
 * to land somewhere useful (inside the markers, or on the part the author is
 * about to overtype), and the line-based kinds must not staple a blank line
 * onto text that already starts a line.
 *
 * All offsets are JS string indices, matching textarea selection properties.
 * Expected positions are derived from the returned string rather than counted
 * by hand, so a marker changing width does not silently invalidate a test.
 */
import { describe, expect, it } from 'vitest'
import { insertMarkup, type MarkupKind } from './insert-markup'

const URL_PLACEHOLDER = 'https://example.com'
const SPOILER_OPENER = '::: spoiler '

describe('insertMarkup — inline marks', () => {
  it.each([
    { kind: 'bold' as MarkupKind, wrapped: '**loud**' },
    { kind: 'italic' as MarkupKind, wrapped: '*loud*' },
    { kind: 'strikethrough' as MarkupKind, wrapped: '~~loud~~' },
    { kind: 'code' as MarkupKind, wrapped: '`loud`' },
  ])('wraps the selection for $kind', ({ kind, wrapped }) => {
    const result = insertMarkup('say loud now', 4, 8, kind)

    expect(result.value).toBe(`say ${wrapped} now`)
    // The text stays selected, so typing replaces it rather than the markers.
    const textStart = result.value.indexOf('loud')
    expect(result.selectionStart).toBe(textStart)
    expect(result.selectionEnd).toBe(textStart + 'loud'.length)
  })

  it.each([
    { kind: 'bold' as MarkupKind, markers: '****' },
    { kind: 'italic' as MarkupKind, markers: '**' },
    { kind: 'strikethrough' as MarkupKind, markers: '~~~~' },
    { kind: 'code' as MarkupKind, markers: '``' },
  ])(
    'places the caret between the markers for an empty $kind selection',
    ({ kind, markers }) => {
      const result = insertMarkup('say ', 4, 4, kind)

      expect(result.value).toBe(`say ${markers}`)
      const caret = 4 + markers.length / 2
      expect(result.selectionStart).toBe(caret)
      expect(result.selectionEnd).toBe(caret)
    },
  )
})

describe('insertMarkup — links', () => {
  it('wraps the selection as the link text and selects the url', () => {
    const result = insertMarkup('read docs now', 5, 9, 'link')

    expect(result.value).toBe(`read [docs](${URL_PLACEHOLDER}) now`)
    // The url is the placeholder the author has to replace, so it starts
    // selected.
    const urlStart = result.value.indexOf(URL_PLACEHOLDER)
    expect(result.selectionStart).toBe(urlStart)
    expect(result.selectionEnd).toBe(urlStart + URL_PLACEHOLDER.length)
  })

  it('selects the url for an empty selection too', () => {
    const result = insertMarkup('', 0, 0, 'link')

    expect(result.value).toBe(`[](${URL_PLACEHOLDER})`)
    const urlStart = result.value.indexOf(URL_PLACEHOLDER)
    expect(result.selectionStart).toBe(urlStart)
    expect(result.selectionEnd).toBe(urlStart + URL_PLACEHOLDER.length)
  })
})

describe('insertMarkup — line kinds', () => {
  it.each([
    { kind: 'heading' as MarkupKind, marker: '# ' },
    { kind: 'quote' as MarkupKind, marker: '> ' },
  ])(
    'prefixes the current line for $kind with no newline at a line start',
    ({ kind, marker }) => {
      const result = insertMarkup('Title', 0, 0, kind)

      expect(result.value).toBe(`${marker}Title`)
      expect(result.selectionStart).toBe(marker.length)
      expect(result.selectionEnd).toBe(marker.length)
    },
  )

  it.each([
    { kind: 'heading' as MarkupKind, marker: '# ' },
    { kind: 'quote' as MarkupKind, marker: '> ' },
  ])(
    'prefixes a later line for $kind without a newline',
    ({ kind, marker }) => {
      // The caret sits just after a newline, so the line it is on is empty of
      // text before it and needs no extra break.
      const result = insertMarkup('intro\nbody', 6, 6, kind)

      expect(result.value).toBe(`intro\n${marker}body`)
      expect(result.selectionStart).toBe(6 + marker.length)
    },
  )

  it.each([
    { kind: 'heading' as MarkupKind, marker: '# ' },
    { kind: 'quote' as MarkupKind, marker: '> ' },
  ])(
    'starts a new line for $kind when there is text before the caret',
    ({ kind, marker }) => {
      const result = insertMarkup('intro', 5, 5, kind)

      expect(result.value).toBe(`intro\n${marker}`)
      expect(result.selectionStart).toBe(result.value.length)
      expect(result.selectionEnd).toBe(result.value.length)
    },
  )

  it.each([
    { kind: 'heading' as MarkupKind, marker: '# ' },
    { kind: 'quote' as MarkupKind, marker: '> ' },
  ])(
    'keeps a selected line selected after prefixing it with $kind',
    ({ kind, marker }) => {
      const result = insertMarkup('Title', 0, 5, kind)

      expect(result.value).toBe(`${marker}Title`)
      const textStart = result.value.indexOf('Title')
      expect(result.selectionStart).toBe(textStart)
      expect(result.selectionEnd).toBe(textStart + 'Title'.length)
    },
  )
})

describe('insertMarkup — code blocks', () => {
  it('fences the selection on its own lines', () => {
    const result = insertMarkup('x = 1', 0, 5, 'codeBlock')

    expect(result.value).toBe('```\nx = 1\n```')
    const codeStart = result.value.indexOf('x = 1')
    expect(result.selectionStart).toBe(codeStart)
    expect(result.selectionEnd).toBe(codeStart + 'x = 1'.length)
  })

  it('places the caret inside an empty fence', () => {
    const result = insertMarkup('', 0, 0, 'codeBlock')

    expect(result.value).toBe('```\n\n```')
    const caret = result.value.indexOf('\n') + 1
    expect(result.selectionStart).toBe(caret)
    expect(result.selectionEnd).toBe(caret)
  })
})

describe('insertMarkup — spoilers', () => {
  it('wraps the selection in a container and puts the caret on the reason', () => {
    const result = insertMarkup('secret', 0, 6, 'spoiler')

    expect(result.value).toBe(`${SPOILER_OPENER}\nsecret\n:::`)
    // The reason is the one thing the author must fill in, so the caret waits
    // there rather than in the hidden text.
    expect(result.selectionStart).toBe(SPOILER_OPENER.length)
    expect(result.selectionEnd).toBe(SPOILER_OPENER.length)
  })

  it('wraps an empty selection in an empty container', () => {
    const result = insertMarkup('', 0, 0, 'spoiler')

    expect(result.value).toBe(`${SPOILER_OPENER}\n\n:::`)
    expect(result.selectionStart).toBe(SPOILER_OPENER.length)
  })
})

describe('insertMarkup — block kinds with text after the selection', () => {
  it('puts the closing fence on its own line and the remainder on the next', () => {
    // Leaving ' tail' on the fence line would make the closer part of the code
    // and swallow the rest of the paragraph into the block.
    const result = insertMarkup('code tail', 0, 4, 'codeBlock')

    expect(result.value).toBe('```\ncode\n```\n tail')
    const codeStart = result.value.indexOf('code')
    expect(result.selectionStart).toBe(codeStart)
    expect(result.selectionEnd).toBe(codeStart + 'code'.length)
  })

  it('puts the spoiler closer on its own line and the remainder on the next', () => {
    const result = insertMarkup('code tail', 0, 4, 'spoiler')

    expect(result.value).toBe(`${SPOILER_OPENER}\ncode\n:::\n tail`)
    expect(result.selectionStart).toBe(SPOILER_OPENER.length)
    expect(result.selectionEnd).toBe(SPOILER_OPENER.length)
  })

  it.each([
    { kind: 'heading' as MarkupKind, marker: '# ' },
    { kind: 'quote' as MarkupKind, marker: '> ' },
  ])('keeps text after the caret on the new $kind line', ({ kind, marker }) => {
    const result = insertMarkup('bodytext', 4, 4, kind)

    expect(result.value).toBe(`body\n${marker}text`)
    expect(result.selectionStart).toBe(4 + 1 + marker.length)
    expect(result.selectionEnd).toBe(4 + 1 + marker.length)
  })
})
