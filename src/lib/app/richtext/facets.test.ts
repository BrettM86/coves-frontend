import { describe, expect, it } from 'vitest'
import {
  buildRichText,
  hasFacets,
  MAX_FACETS,
  MAX_FEATURES_PER_FACET,
  type Block,
  type HeadingBlock,
  type BlockquoteBlock,
  type CodeBlock,
  type LinkSpan,
  type ParagraphBlock,
  type SpoilerSpan,
  type TextSegment,
} from './facets'

const NS = 'social.coves.richtext.facet'

function facet(
  byteStart: number,
  byteEnd: number,
  ...features: Record<string, unknown>[]
) {
  return { index: { byteStart, byteEnd }, features }
}

const bold = { $type: `${NS}#bold` }
const italic = { $type: `${NS}#italic` }
const strikethrough = { $type: `${NS}#strikethrough` }
const code = { $type: `${NS}#code` }
const link = (uri: string) => ({ $type: `${NS}#link`, uri })
const mention = (did: string) => ({ $type: `${NS}#mention`, did })
const spoiler = (reason?: string) => ({ $type: `${NS}#spoiler`, reason })
const blockquote = (level?: number) => ({ $type: `${NS}#blockquote`, level })
const heading = (level?: number) => ({ $type: `${NS}#heading`, level })
const codeBlock = (language?: string) => ({
  $type: `${NS}#codeBlock`,
  language,
})

function paragraph(block: Block): ParagraphBlock {
  expect(block.type).toBe('paragraph')
  return block as ParagraphBlock
}

function text(inline: unknown): TextSegment {
  expect((inline as TextSegment).type).toBe('text')
  return inline as TextSegment
}

/** Concatenate all visible text in the tree, blocks joined by \n. */
function plainText(blocks: readonly Block[]): string {
  const inlineText = (nodes: readonly unknown[]): string =>
    nodes
      .map((n) => {
        const node = n as TextSegment | LinkSpan | SpoilerSpan
        return node.type === 'text' ? node.text : inlineText(node.children)
      })
      .join('')
  return blocks
    .map((b) =>
      b.type === 'codeBlock'
        ? b.code
        : b.type === 'blockquote'
          ? plainText(b.children)
          : inlineText(b.children),
    )
    .join('\n')
}

describe('hasFacets', () => {
  it('is true for a non-empty array', () => {
    expect(hasFacets([{}])).toBe(true)
  })

  it('is false for empty, missing, or non-array values', () => {
    expect(hasFacets([])).toBe(false)
    expect(hasFacets(undefined)).toBe(false)
    expect(hasFacets(null)).toBe(false)
    expect(hasFacets('nope')).toBe(false)
  })
})

describe('buildRichText — plain content', () => {
  it('renders unfaceted content as a single paragraph', () => {
    const blocks = buildRichText('hello world', [])
    expect(blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'hello world' }] },
    ])
  })

  it('returns no blocks for empty content', () => {
    expect(buildRichText('', [])).toEqual([])
  })

  it('preserves interior newlines within a paragraph', () => {
    const blocks = buildRichText('line one\n\nline two', [])
    expect(text(paragraph(blocks[0]).children[0]).text).toBe(
      'line one\n\nline two',
    )
  })
})

describe('buildRichText — malformed facets degrade to plain text', () => {
  const content = 'hello world'

  it.each([
    ['non-object facet', ['junk']],
    ['missing index', [{ features: [bold] }]],
    ['non-integer offsets', [facet(0.5, 5, bold)]],
    [
      'negative start',
      [{ index: { byteStart: -1, byteEnd: 5 }, features: [bold] }],
    ],
    ['inverted range', [facet(5, 2, bold)]],
    ['empty range', [facet(3, 3, bold)]],
    ['start beyond content', [facet(50, 60, bold)]],
    [
      'features not an array',
      [{ index: { byteStart: 0, byteEnd: 5 }, features: 'x' }],
    ],
    ['feature without $type', [facet(0, 5, { uri: 'https://x.test' })]],
    ['unknown feature $type', [facet(0, 5, { $type: `${NS}#sparkle` })]],
  ])('%s', (_name, facets) => {
    expect(buildRichText(content, facets as unknown[])).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: content }] },
    ])
  })

  it('clamps byteEnd beyond the content length', () => {
    const blocks = buildRichText('hello', [facet(0, 999, bold)])
    expect(paragraph(blocks[0]).children).toEqual([
      { type: 'text', text: 'hello', bold: true },
    ])
  })

  it('never loses text regardless of facet garbage', () => {
    const content = 'a\nb\nc — テスト 🎉'
    const garbage = [
      facet(0, 4, blockquote(3), heading(2)),
      facet(2, 9, codeBlock('go')),
      facet(1, 3, bold, { $type: `${NS}#wat` }),
      'junk',
      null,
      facet(7, 100, spoiler('x')),
    ]
    // Full equality: block splits happen at line boundaries, so joining
    // blocks with \n must reproduce the exact content.
    expect(plainText(buildRichText(content, garbage as unknown[]))).toBe(
      content,
    )
  })
})

describe('buildRichText — inline marks', () => {
  it('applies bold to a sub-range', () => {
    const blocks = buildRichText('hello world', [facet(6, 11, bold)])
    expect(paragraph(blocks[0]).children).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world', bold: true },
    ])
  })

  it('combines multiple features on one facet', () => {
    const blocks = buildRichText('hi', [facet(0, 2, bold, italic)])
    expect(paragraph(blocks[0]).children).toEqual([
      { type: 'text', text: 'hi', bold: true, italic: true },
    ])
  })

  it('splits partially overlapping marks into segments', () => {
    // bold over [0,6), italic over [4,10)
    const blocks = buildRichText('aaaabbcccc', [
      facet(0, 6, bold),
      facet(4, 10, italic),
    ])
    expect(paragraph(blocks[0]).children).toEqual([
      { type: 'text', text: 'aaaa', bold: true },
      { type: 'text', text: 'bb', bold: true, italic: true },
      { type: 'text', text: 'cccc', italic: true },
    ])
  })

  it('renders strikethrough and inline code marks', () => {
    const blocks = buildRichText('ab cd', [
      facet(0, 2, strikethrough),
      facet(3, 5, code),
    ])
    expect(paragraph(blocks[0]).children).toEqual([
      { type: 'text', text: 'ab', strikethrough: true },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'cd', code: true },
    ])
  })

  it('uses UTF-8 byte offsets, not UTF-16 indices', () => {
    const content = '🎉 party'
    // '🎉' is 4 bytes; bold covers 'party' at bytes 5..10
    const blocks = buildRichText(content, [facet(5, 10, bold)])
    expect(paragraph(blocks[0]).children).toEqual([
      { type: 'text', text: '🎉 ' },
      { type: 'text', text: 'party', bold: true },
    ])
  })

  it('snaps mid-codepoint boundaries inward to whole codepoints', () => {
    // The facet starts inside the 4-byte emoji; it must not split the
    // codepoint (which would decode to U+FFFD replacement characters).
    const blocks = buildRichText('🎉 party', [facet(2, 10, bold)])
    expect(paragraph(blocks[0]).children).toEqual([
      { type: 'text', text: '🎉' },
      { type: 'text', text: ' party', bold: true },
    ])
  })

  it('drops a facet that covers no whole codepoint', () => {
    // bytes 2..4 lie strictly inside the emoji at bytes 1..5 of 'a🎉b'
    const blocks = buildRichText('a🎉b', [facet(2, 4, bold)])
    expect(blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'a🎉b' }] },
    ])
  })

  it('clips an inline mark across a heading boundary', () => {
    const content = 'abc\nHead\ntail'
    const blocks = buildRichText(content, [
      facet(4, 8, heading(2)),
      facet(0, 8, bold),
    ])
    expect(paragraph(blocks[0]).children).toEqual([
      { type: 'text', text: 'abc', bold: true },
    ])
    const h = blocks[1] as HeadingBlock
    expect(h.children).toEqual([{ type: 'text', text: 'Head', bold: true }])
    expect(text(paragraph(blocks[2]).children[0]).text).toBe('tail')
  })
})

describe('buildRichText — hostile-input caps', () => {
  it('ignores facets beyond MAX_FACETS', () => {
    const facets: unknown[] = Array.from({ length: MAX_FACETS }, () =>
      facet(0, 1, bold),
    )
    facets.push(facet(1, 2, italic))
    const blocks = buildRichText('ab', facets)
    expect(paragraph(blocks[0]).children).toEqual([
      { type: 'text', text: 'a', bold: true },
      { type: 'text', text: 'b' },
    ])
  })

  it('ignores features beyond MAX_FEATURES_PER_FACET on one facet', () => {
    const junk = Array.from({ length: MAX_FEATURES_PER_FACET }, (_, i) => ({
      $type: `${NS}#junk${i}`,
    }))
    const blocks = buildRichText('hi', [facet(0, 2, ...junk, bold)])
    expect(paragraph(blocks[0]).children).toEqual([
      { type: 'text', text: 'hi' },
    ])
  })
})

describe('buildRichText — links and mentions', () => {
  it('renders an http(s) link facet as an external anchor', () => {
    const blocks = buildRichText('see example.com now', [
      facet(4, 15, link('https://example.com')),
    ])
    const span = paragraph(blocks[0]).children[1] as LinkSpan
    expect(span).toEqual({
      type: 'link',
      href: 'https://example.com',
      external: true,
      children: [{ type: 'text', text: 'example.com' }],
    })
  })

  it.each([['javascript:alert(1)'], ['data:text/html,x'], ['not a url']])(
    'degrades unsafe link uri %s to plain text',
    (uri) => {
      const blocks = buildRichText('click here', [facet(0, 10, link(uri))])
      expect(paragraph(blocks[0]).children).toEqual([
        { type: 'text', text: 'click here' },
      ])
    },
  )

  it('routes a user mention to /u/<did>', () => {
    const blocks = buildRichText('cc @mari.coves.dev', [
      facet(3, 18, mention('did:plc:abc123')),
    ])
    const span = paragraph(blocks[0]).children[1] as LinkSpan
    expect(span.type).toBe('link')
    expect(span.href).toBe(`/u/${encodeURIComponent('did:plc:abc123')}`)
    expect(span.external).toBe(false)
  })

  it('routes a community mention (! prefix) to /c/<did>', () => {
    const blocks = buildRichText('join !gaming.coves.dev', [
      facet(5, 22, mention('did:plc:xyz')),
    ])
    const span = paragraph(blocks[0]).children[1] as LinkSpan
    expect(span.href).toBe(`/c/${encodeURIComponent('did:plc:xyz')}`)
  })

  it('drops a mention with a malformed did', () => {
    const blocks = buildRichText('cc @who', [facet(3, 7, mention('not-a-did'))])
    expect(paragraph(blocks[0]).children).toEqual([
      { type: 'text', text: 'cc @who' },
    ])
  })

  it('snaps link boundaries so no replacement characters render', () => {
    const blocks = buildRichText('🎉x', [facet(1, 5, link('https://x.test'))])
    const children = paragraph(blocks[0]).children
    expect(text(children[0]).text).toBe('🎉')
    expect((children[1] as LinkSpan).children).toEqual([
      { type: 'text', text: 'x' },
    ])
  })

  it('keeps the first of overlapping links', () => {
    const blocks = buildRichText('abcdef', [
      facet(0, 4, link('https://first.test')),
      facet(2, 6, link('https://second.test')),
    ])
    const children = paragraph(blocks[0]).children
    expect((children[0] as LinkSpan).href).toBe('https://first.test')
    expect(text(children[1]).text).toBe('ef')
  })

  it('applies marks inside link text', () => {
    const blocks = buildRichText('read this', [
      facet(5, 9, link('https://x.test')),
      facet(5, 9, bold),
    ])
    const span = paragraph(blocks[0]).children[1] as LinkSpan
    expect(span.children).toEqual([{ type: 'text', text: 'this', bold: true }])
  })
})

describe('buildRichText — spoilers', () => {
  it('wraps the range in a spoiler span with reason', () => {
    const blocks = buildRichText('the killer is Bob', [
      facet(14, 17, spoiler('ending')),
    ])
    const span = paragraph(blocks[0]).children[1] as SpoilerSpan
    expect(span).toEqual({
      type: 'spoiler',
      reason: 'ending',
      children: [{ type: 'text', text: 'Bob' }],
    })
  })

  it('merges overlapping spoiler ranges', () => {
    const blocks = buildRichText('abcdef', [
      facet(0, 3, spoiler()),
      facet(2, 6, spoiler('later')),
    ])
    const children = paragraph(blocks[0]).children
    expect(children).toHaveLength(1)
    const span = children[0] as SpoilerSpan
    expect(span.type).toBe('spoiler')
    expect(text(span.children[0]).text).toBe('abcdef')
  })

  it('nests links inside spoilers', () => {
    const blocks = buildRichText('go here', [
      facet(0, 7, spoiler()),
      facet(3, 7, link('https://x.test')),
    ])
    const span = paragraph(blocks[0]).children[0] as SpoilerSpan
    expect(span.children).toHaveLength(2)
    expect((span.children[1] as LinkSpan).href).toBe('https://x.test')
  })
})

describe('buildRichText — headings', () => {
  it('renders a whole-line heading with surrounding paragraphs', () => {
    const content = 'intro\nBig Title\nbody text'
    const blocks = buildRichText(content, [facet(6, 15, heading(2))])
    expect(blocks).toHaveLength(3)
    expect(text(paragraph(blocks[0]).children[0]).text).toBe('intro')
    const h = blocks[1] as HeadingBlock
    expect(h.type).toBe('heading')
    expect(h.level).toBe(2)
    expect(text(h.children[0]).text).toBe('Big Title')
    expect(text(paragraph(blocks[2]).children[0]).text).toBe('body text')
  })

  it('extends a mid-line heading range to line boundaries', () => {
    const content = 'intro\nBig Title\nbody'
    const blocks = buildRichText(content, [facet(10, 12, heading(1))])
    const h = blocks[1] as HeadingBlock
    expect(h.type).toBe('heading')
    expect(text(h.children[0]).text).toBe('Big Title')
  })

  it('degrades a heading without a level to plain text', () => {
    const blocks = buildRichText('Title', [facet(0, 5, heading())])
    expect(blocks[0].type).toBe('paragraph')
  })

  it('clamps out-of-range heading levels', () => {
    const blocks = buildRichText('Title', [facet(0, 5, heading(9))])
    expect((blocks[0] as HeadingBlock).level).toBe(6)
  })

  it('applies inline marks inside a heading', () => {
    const blocks = buildRichText('Big Title', [
      facet(0, 9, heading(1)),
      facet(0, 3, italic),
    ])
    const h = blocks[0] as HeadingBlock
    expect(h.children).toEqual([
      { type: 'text', text: 'Big', italic: true },
      { type: 'text', text: ' Title' },
    ])
  })
})

describe('buildRichText — blockquotes', () => {
  it('renders a quote block, defaulting level to 1', () => {
    const content = 'said:\nquoted line\nreply'
    const blocks = buildRichText(content, [facet(6, 17, blockquote())])
    const q = blocks[1] as BlockquoteBlock
    expect(q.type).toBe('blockquote')
    expect(q.level).toBe(1)
    expect(text(paragraph(q.children[0]).children[0]).text).toBe('quoted line')
  })

  it('keeps adjacent same-level quotes as separate blocks', () => {
    const content = 'first quote\nsecond quote'
    const blocks = buildRichText(content, [
      facet(0, 11, blockquote(1)),
      facet(12, 24, blockquote(1)),
    ])
    expect(blocks.map((b) => b.type)).toEqual(['blockquote', 'blockquote'])
    expect(plainText(blocks)).toBe(content)
  })

  it('renders adjacent quotes with increasing level as separate blocks', () => {
    const content = 'outer quote\ninner quote\nreply'
    const blocks = buildRichText(content, [
      facet(0, 11, blockquote(1)),
      facet(12, 23, blockquote(2)),
    ])
    expect(blocks.map((b) => b.type)).toEqual([
      'blockquote',
      'blockquote',
      'paragraph',
    ])
    expect((blocks[0] as BlockquoteBlock).level).toBe(1)
    expect((blocks[1] as BlockquoteBlock).level).toBe(2)
  })

  it('drops a quote contained inside another quote', () => {
    const content = 'line one\nline two'
    const blocks = buildRichText(content, [
      facet(0, 17, blockquote(1)),
      facet(9, 17, blockquote(2)),
    ])
    expect(blocks).toHaveLength(1)
    const q = blocks[0] as BlockquoteBlock
    expect(plainText(q.children)).toBe('line one\nline two')
  })

  it('nests a codeBlock inside a blockquote by containment', () => {
    const content = 'they said:\nfmt.Println("hi")\nend quote'
    const blocks = buildRichText(content, [
      facet(0, 38, blockquote(1)),
      facet(11, 28, codeBlock('go')),
    ])
    expect(blocks).toHaveLength(1)
    const q = blocks[0] as BlockquoteBlock
    expect(q.children.map((b) => b.type)).toEqual([
      'paragraph',
      'codeBlock',
      'paragraph',
    ])
    expect((q.children[1] as CodeBlock).code).toBe('fmt.Println("hi")')
    expect((q.children[1] as CodeBlock).language).toBe('go')
  })

  it('clamps quote levels above 6', () => {
    const blocks = buildRichText('deep', [facet(0, 4, blockquote(9))])
    expect((blocks[0] as BlockquoteBlock).level).toBe(6)
  })
})

describe('buildRichText — code blocks', () => {
  it('renders literal code with language and no inline processing', () => {
    const content = 'before\nconst x = 1 // **not bold**\nafter'
    const blocks = buildRichText(content, [
      facet(7, 34, codeBlock('ts')),
      facet(19, 27, bold),
    ])
    const cb = blocks[1] as CodeBlock
    expect(cb.type).toBe('codeBlock')
    expect(cb.language).toBe('ts')
    expect(cb.code).toBe('const x = 1 // **not bold**')
  })

  it('omits a non-string language', () => {
    const blocks = buildRichText('code', [
      facet(0, 4, { $type: `${NS}#codeBlock`, language: 42 }),
    ])
    expect((blocks[0] as CodeBlock).language).toBeUndefined()
  })

  it('drops overlapping (non-contained) block facets', () => {
    const content = 'aaa\nbbb\nccc'
    const blocks = buildRichText(content, [
      facet(0, 7, codeBlock()),
      facet(4, 11, heading(1)),
    ])
    expect(blocks.map((b) => b.type)).toEqual(['codeBlock', 'paragraph'])
    expect(plainText(blocks)).toBe('aaa\nbbb\nccc')
  })
})

describe('buildRichText — bridged-content shape', () => {
  it('renders the canonical bridged-Lemmy structure', () => {
    // heading + nested quote (disjoint increasing levels) + code block,
    // mirroring the backend's TestBlockFacetConventions.
    const content =
      'Release notes\nsomeone wrote this\nsomeone quoted that\nmy reply\nx = 1\ndone'
    const blocks = buildRichText(content, [
      facet(0, 13, heading(2)),
      facet(14, 32, blockquote(1)),
      facet(33, 52, blockquote(2)),
      facet(62, 67, codeBlock('python')),
    ])
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'blockquote',
      'blockquote',
      'paragraph',
      'codeBlock',
      'paragraph',
    ])
    expect(plainText(blocks)).toBe(content)
  })
})
