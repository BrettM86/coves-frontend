/**
 * `parseMarkup` compiles the editor's markup into the canonical plaintext plus
 * facets that go on the wire. These are the paragraph-level behaviors: plain
 * text, inline marks, backslash escapes and links.
 *
 * Two rules bind every case and are checked centrally in `readerTree`: a facet
 * is never zero-length, and the facets come out sorted by `byteStart` with
 * every `byteEnd` inside the content. Offsets are UTF-8 byte offsets, measured
 * with a TextEncoder rather than counted by hand, because "ö" and "🌊" are
 * wider in bytes than in characters and every later offset depends on it.
 */
import { describe, expect, it } from 'vitest'
import {
  buildRichText,
  type Block,
  type LinkSpan,
  type ParagraphBlock,
} from './facets'
import { parseMarkup } from './compose'

const NS = 'social.coves.richtext.facet'

const bold = { $type: `${NS}#bold` }
const italic = { $type: `${NS}#italic` }
const strikethrough = { $type: `${NS}#strikethrough` }
const code = { $type: `${NS}#code` }
const link = (uri: string) => ({ $type: `${NS}#link`, uri })

const encoder = new TextEncoder()
const byteLength = (value: string) => encoder.encode(value).length

/** UTF-8 byte range of `needle` inside `content`. */
function byteRange(
  content: string,
  needle: string,
): { byteStart: number; byteEnd: number } {
  const index = content.indexOf(needle)
  expect(
    index,
    `"${needle}" is not in ${JSON.stringify(content)}`,
  ).toBeGreaterThan(-1)
  const byteStart = byteLength(content.slice(0, index))
  return { byteStart, byteEnd: byteStart + byteLength(needle) }
}

/** A facet covering `needle` within `content`. */
function facetOver(
  content: string,
  needle: string,
  ...features: Record<string, unknown>[]
) {
  return { index: byteRange(content, needle), features }
}

/**
 * Parse `source`, check the invariants every parse owes the reader, and hand
 * back the tree the reader builds from the result. A facet that survives
 * `parseMarkup` but not `buildRichText` is a bug in the writer, not the
 * reader, so the two are asserted together.
 */
function readerTree(source: string): readonly Block[] {
  const parsed = parseMarkup(source)
  const limit = byteLength(parsed.content)
  let previousStart = -1
  for (const facet of parsed.facets) {
    expect(facet.index.byteStart).toBeGreaterThanOrEqual(previousStart)
    // No zero-length facets: an empty construct annotates nothing.
    expect(facet.index.byteStart).toBeLessThan(facet.index.byteEnd)
    expect(facet.index.byteEnd).toBeLessThanOrEqual(limit)
    previousStart = facet.index.byteStart
  }
  return buildRichText(parsed.content, parsed.facets)
}

function paragraph(block: Block): ParagraphBlock {
  expect(block.type).toBe('paragraph')
  return block as ParagraphBlock
}

describe('parseMarkup — plain text', () => {
  it('leaves text without markup unchanged and annotates nothing', () => {
    const source = 'just words, nothing special here'
    expect(parseMarkup(source)).toEqual({
      content: source,
      facets: [],
      mentions: [],
    })
  })

  it('normalizes CRLF line endings to LF', () => {
    // Byte offsets are computed over the content that ships, so the newline
    // normalization has to happen before anything is measured.
    expect(parseMarkup('first\r\nsecond\r\n')).toEqual({
      content: 'first\nsecond\n',
      facets: [],
      mentions: [],
    })
  })

  it('handles an empty source', () => {
    expect(parseMarkup('')).toEqual({ content: '', facets: [], mentions: [] })
  })
})

describe('parseMarkup — inline marks', () => {
  it.each([
    { source: '**loud**', text: 'loud', feature: bold, name: 'bold (**)' },
    { source: '__loud__', text: 'loud', feature: bold, name: 'bold (__)' },
    { source: '*soft*', text: 'soft', feature: italic, name: 'italic (*)' },
    { source: '_soft_', text: 'soft', feature: italic, name: 'italic (_)' },
    {
      source: '~~gone~~',
      text: 'gone',
      feature: strikethrough,
      name: 'strikethrough',
    },
    { source: '`x = 1`', text: 'x = 1', feature: code, name: 'inline code' },
  ])(
    'strips the markers and emits one $name facet',
    ({ source, text, feature }) => {
      const parsed = parseMarkup(source)
      expect(parsed.content).toBe(text)
      expect(parsed.facets).toEqual([facetOver(text, text, feature)])
      expect(parsed.mentions).toEqual([])
    },
  )

  it('measures offsets in UTF-8 bytes after multibyte characters', () => {
    const parsed = parseMarkup('wörld 🌊 **deep** water')
    expect(parsed.content).toBe('wörld 🌊 deep water')
    expect(parsed.facets).toEqual([facetOver(parsed.content, 'deep', bold)])
  })

  it('merges marks on an identical range into one facet', () => {
    // Two features over one range are one facet, not two — the reader treats
    // a facet's features as a set applied to the same bytes. Outer emphasis
    // is listed first, the same convention as blockquote-before-heading.
    const parsed = parseMarkup('***both***')
    expect(parsed.content).toBe('both')
    expect(parsed.facets).toEqual([facetOver('both', 'both', bold, italic)])
  })

  it('emits no facet for an empty construct', () => {
    // The markers close, so they are stripped, but there is nothing to
    // annotate and a zero-length facet is never valid.
    expect(parseMarkup('****')).toEqual({
      content: '',
      facets: [],
      mentions: [],
    })
  })

  it.each([['**loud'], ['~~gone'], ['`x = 1'], ['_soft']])(
    'leaves the unclosed marker in %s literal',
    (source) => {
      const parsed = parseMarkup(source)
      expect(parsed.content).toBe(source)
      expect(parsed.facets).toEqual([])
    },
  )

  it('does not parse markup inside a code span', () => {
    const parsed = parseMarkup('`**not bold**`')
    expect(parsed.content).toBe('**not bold**')
    expect(parsed.facets).toEqual([
      facetOver('**not bold**', '**not bold**', code),
    ])
  })

  it('produces marks the reader renders as marked segments', () => {
    const blocks = readerTree('Hello **wörld** and ~~old news~~')
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'wörld', bold: true },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'old news', strikethrough: true },
        ],
      },
    ])
  })
})

describe('parseMarkup — backslash escapes', () => {
  it.each([
    { source: '\\*not italic\\*', content: '*not italic*' },
    { source: '\\_not italic\\_', content: '_not italic_' },
    { source: '\\~\\~not struck\\~\\~', content: '~~not struck~~' },
    { source: '\\`not code\\`', content: '`not code`' },
    { source: '\\[not a link\\](nope)', content: '[not a link](nope)' },
    { source: '\\# not a heading', content: '# not a heading' },
    { source: '\\> not a quote', content: '> not a quote' },
    { source: '\\::: not a spoiler', content: '::: not a spoiler' },
    { source: '\\@alice.coves.social', content: '@alice.coves.social' },
    { source: '\\!gaming', content: '!gaming' },
    { source: 'back\\\\slash', content: 'back\\slash' },
  ])(
    'emits the literal characters of $source with no facet',
    ({ source, content }) => {
      const parsed = parseMarkup(source)
      expect(parsed.content).toBe(content)
      expect(parsed.facets).toEqual([])
      expect(parsed.mentions).toEqual([])
    },
  )

  it('treats a backslash inside a code span as a literal character', () => {
    const parsed = parseMarkup('`a\\*b`')
    expect(parsed.content).toBe('a\\*b')
    expect(parsed.facets).toEqual([facetOver('a\\*b', 'a\\*b', code)])
  })
})

describe('parseMarkup — links', () => {
  it('compiles a titled link into a link facet over its text', () => {
    const parsed = parseMarkup('read the [docs](https://example.com/d) first')
    expect(parsed.content).toBe('read the docs first')
    expect(parsed.facets).toEqual([
      facetOver(parsed.content, 'docs', link('https://example.com/d')),
    ])
  })

  it.each([['ftp://example.com/f'], ['javascript:alert(1)'], ['/local/path']])(
    'leaves a link with the non-http(s) target %s literal',
    (target) => {
      const source = `[text](${target})`
      const parsed = parseMarkup(source)
      expect(parsed.content).toBe(source)
      expect(parsed.facets).toEqual([])
    },
  )

  it('autolinks a bare url', () => {
    const parsed = parseMarkup('see https://example.com/a for more')
    expect(parsed.content).toBe('see https://example.com/a for more')
    expect(parsed.facets).toEqual([
      facetOver(
        parsed.content,
        'https://example.com/a',
        link('https://example.com/a'),
      ),
    ])
  })

  it.each([['.'], [','], ['!'], ['?'], [';'], [':'], [')']])(
    'excludes a trailing %s from a bare url',
    (punctuation) => {
      const parsed = parseMarkup(`visit https://example.com/a${punctuation} ok`)
      expect(parsed.content).toBe(
        `visit https://example.com/a${punctuation} ok`,
      )
      expect(parsed.facets).toEqual([
        facetOver(
          parsed.content,
          'https://example.com/a',
          link('https://example.com/a'),
        ),
      ])
    },
  )

  it('does not autolink a url inside a code span', () => {
    const parsed = parseMarkup('`https://example.com/a`')
    expect(parsed.content).toBe('https://example.com/a')
    expect(parsed.facets).toEqual([
      facetOver('https://example.com/a', 'https://example.com/a', code),
    ])
  })

  it('does not autolink or mention inside a titled link text', () => {
    // The link text is already a link target; a second link facet over part
    // of it, or a mention inside it, would fight the enclosing one.
    const parsed = parseMarkup(
      '[see https://a.example and @alice.coves.social](https://b.example/x)',
    )
    const text = 'see https://a.example and @alice.coves.social'
    expect(parsed.content).toBe(text)
    expect(parsed.facets).toEqual([
      facetOver(text, text, link('https://b.example/x')),
    ])
    expect(parsed.mentions).toEqual([])
  })

  it('produces links the reader renders as external anchors', () => {
    const blocks = readerTree('see [docs](https://example.com/d) now')
    const children = paragraph(blocks[0]).children
    expect(children[0]).toEqual({ type: 'text', text: 'see ' })
    expect(children[1] as LinkSpan).toEqual({
      type: 'link',
      href: 'https://example.com/d',
      external: true,
      children: [{ type: 'text', text: 'docs' }],
    })
    expect(children[2]).toEqual({ type: 'text', text: ' now' })
  })
})

describe('parseMarkup — urls containing parentheses', () => {
  const WIKI = 'https://en.wikipedia.org/wiki/Foo_(bar)'

  it('keeps a balanced closing paren inside a titled link target', () => {
    // The last ')' closes the markdown target; the one before it belongs to
    // the URL. Stopping at the first ')' truncates the link.
    const parsed = parseMarkup(`[x](${WIKI})`)
    expect(parsed.content).toBe('x')
    expect(parsed.facets).toEqual([facetOver('x', 'x', link(WIKI))])
  })

  it('keeps a balanced closing paren in a bare url', () => {
    const parsed = parseMarkup(`see ${WIKI} now`)
    expect(parsed.content).toBe(`see ${WIKI} now`)
    expect(parsed.facets).toEqual([facetOver(parsed.content, WIKI, link(WIKI))])
  })

  it('excludes an unbalanced closing paren from a bare url', () => {
    const parsed = parseMarkup('(https://example.com/a)')
    expect(parsed.content).toBe('(https://example.com/a)')
    expect(parsed.facets).toEqual([
      facetOver(
        parsed.content,
        'https://example.com/a',
        link('https://example.com/a'),
      ),
    ])
  })
})

describe('parseMarkup — intraword underscores', () => {
  it('leaves underscores inside a word literal while still marking a whole word', () => {
    // Identifiers and filenames are full of underscores. Treating them as
    // emphasis would silently delete characters from the content.
    const names = parseMarkup('file_name.txt and other_name.txt')
    expect(names.content).toBe('file_name.txt and other_name.txt')
    expect(names.facets).toEqual([])

    const word = parseMarkup('_word_')
    expect(word.content).toBe('word')
    expect(word.facets).toEqual([facetOver('word', 'word', italic)])
  })

  it('leaves a snake_case identifier untouched', () => {
    const parsed = parseMarkup('snake_case_id')
    expect(parsed.content).toBe('snake_case_id')
    expect(parsed.facets).toEqual([])
  })
})

describe('parseMarkup — nested emphasis', () => {
  it('marks bold inside italic as two facets over their own ranges', () => {
    const parsed = parseMarkup('*a **b** c*')
    expect(parsed.content).toBe('a b c')
    expect(parsed.facets).toEqual([
      facetOver('a b c', 'a b c', italic),
      facetOver('a b c', 'b', bold),
    ])
  })
})

describe('parseMarkup — empty code spans', () => {
  it('leaves an empty pair of backticks literal and marks the real span', () => {
    const parsed = parseMarkup('a `` b `x` c')
    expect(parsed.content).toBe('a `` b x c')
    expect(parsed.facets).toEqual([facetOver(parsed.content, 'x', code)])
  })
})
