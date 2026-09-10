/**
 * `parseMarkup`'s block grammar: headings, blockquotes, fenced code and
 * spoiler containers. Block facets span whole lines and stop before the
 * trailing newline, which is what lets the reader place them without guessing.
 *
 * Inline behavior lives in compose.test.ts. Shared helpers are in
 * ./test-helpers; `readerTree` also enforces the invariants every parse owes
 * the reader (sorted by byteStart, never zero-length, never past the content).
 */
import { describe, expect, it } from 'vitest'
import { parseMarkup } from './compose'
import { byteLength, facetOver, readerTree } from './test-helpers'

const NS = 'social.coves.richtext.facet'

const bold = { $type: `${NS}#bold` }
const heading = (level: number) => ({ $type: `${NS}#heading`, level })
const blockquote = (level: number) => ({ $type: `${NS}#blockquote`, level })
const codeBlockPlain = { $type: `${NS}#codeBlock` }
const codeBlock = (language: string) => ({
  $type: `${NS}#codeBlock`,
  language,
})
const spoiler = (reason: string) => ({ $type: `${NS}#spoiler`, reason })

/** The features of the single facet a source compiles to. */
function onlyFeatures(source: string): Record<string, unknown>[] {
  const parsed = parseMarkup(source)
  expect(parsed.facets).toHaveLength(1)
  return parsed.facets[0].features
}

describe('parseMarkup — headings', () => {
  it.each([1, 2, 3, 4, 5, 6])(
    'strips the level-%i marker and emits a heading facet',
    (level) => {
      const parsed = parseMarkup(`${'#'.repeat(level)} Title`)
      expect(parsed.content).toBe('Title')
      expect(parsed.facets).toEqual([
        facetOver('Title', 'Title', heading(level)),
      ])
    },
  )

  it('leaves a seventh-level marker literal', () => {
    const source = '####### Title'
    const parsed = parseMarkup(source)
    expect(parsed.content).toBe(source)
    expect(parsed.facets).toEqual([])
  })

  it('leaves a marker with no following space literal', () => {
    const source = '##Title'
    const parsed = parseMarkup(source)
    expect(parsed.content).toBe(source)
    expect(parsed.facets).toEqual([])
  })

  it('covers the heading line only, excluding the newlines around it', () => {
    const parsed = parseMarkup('intro\n## Title\ntail')
    expect(parsed.content).toBe('intro\nTitle\ntail')
    expect(parsed.facets).toEqual([
      facetOver(parsed.content, 'Title', heading(2)),
    ])
  })

  it('emits no facet for a heading with no text', () => {
    expect(parseMarkup('# ')).toEqual({
      content: '',
      facets: [],
      mentions: [],
    })
  })

  it('gives an inline mark inside a heading its own facet', () => {
    const parsed = parseMarkup('## A **bold** title')
    expect(parsed.content).toBe('A bold title')
    expect(parsed.facets).toEqual([
      facetOver(parsed.content, 'A bold title', heading(2)),
      facetOver(parsed.content, 'bold', bold),
    ])
  })

  it('produces a heading the reader renders as a heading block', () => {
    expect(readerTree('## Big **news**\nbody')).toEqual([
      {
        type: 'heading',
        level: 2,
        children: [
          { type: 'text', text: 'Big ' },
          { type: 'text', text: 'news', bold: true },
        ],
      },
      { type: 'paragraph', children: [{ type: 'text', text: 'body' }] },
    ])
  })
})

describe('parseMarkup — blockquotes', () => {
  it('strips the marker and emits a level-1 quote facet', () => {
    const parsed = parseMarkup('> quoted')
    expect(parsed.content).toBe('quoted')
    expect(parsed.facets).toEqual([
      facetOver('quoted', 'quoted', blockquote(1)),
    ])
  })

  it('covers consecutive lines at the same depth with one facet', () => {
    const parsed = parseMarkup('> one\n> two')
    expect(parsed.content).toBe('one\ntwo')
    // One facet, not two: the reader renders adjacent same-level quote facets
    // as separate blocks, so two facets here would split the quote in half.
    expect(parsed.facets).toEqual([
      facetOver(parsed.content, 'one\ntwo', blockquote(1)),
    ])
  })

  it('emits disjoint facets when the depth changes', () => {
    const parsed = parseMarkup('> one\n>> two')
    expect(parsed.content).toBe('one\ntwo')
    // Nesting is expressed as disjoint ranges with increasing level, never as
    // one range inside another — the reader drops a quote contained in a quote.
    expect(parsed.facets).toEqual([
      facetOver(parsed.content, 'one', blockquote(1)),
      facetOver(parsed.content, 'two', blockquote(2)),
    ])
  })

  it('clamps a depth deeper than six to level six', () => {
    const parsed = parseMarkup('>>>>>>> deep')
    expect(parsed.content).toBe('deep')
    expect(parsed.facets).toEqual([facetOver('deep', 'deep', blockquote(6))])
  })

  it('ends a quote at a blank line', () => {
    const parsed = parseMarkup('> one\n\n> two')
    expect(parsed.content).toBe('one\n\ntwo')
    expect(parsed.facets).toEqual([
      facetOver(parsed.content, 'one', blockquote(1)),
      facetOver(parsed.content, 'two', blockquote(1)),
    ])
  })

  it('lists blockquote before heading on a quoted heading line', () => {
    const parsed = parseMarkup('> # title')
    expect(parsed.content).toBe('title')
    // One facet over one range, and the order of `features` decides which is
    // the container: the reader's first block feature wins.
    expect(parsed.facets).toEqual([
      facetOver('title', 'title', blockquote(1), heading(1)),
    ])
  })

  it('emits no facet for a quote with no text', () => {
    expect(parseMarkup('> ')).toEqual({
      content: '',
      facets: [],
      mentions: [],
    })
  })

  it('gives an inline mark inside a quote its own facet', () => {
    const parsed = parseMarkup('> a **b**')
    expect(parsed.content).toBe('a b')
    expect(parsed.facets).toEqual([
      facetOver('a b', 'a b', blockquote(1)),
      facetOver('a b', 'b', bold),
    ])
  })

  it('produces a quote the reader renders as one blockquote block', () => {
    expect(readerTree('> one\n> two')).toEqual([
      {
        type: 'blockquote',
        level: 1,
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: 'one\ntwo' }] },
        ],
      },
    ])
  })

  it('produces a quoted heading the reader nests inside the quote', () => {
    expect(readerTree('> # title')).toEqual([
      {
        type: 'blockquote',
        level: 1,
        children: [
          {
            type: 'heading',
            level: 1,
            children: [{ type: 'text', text: 'title' }],
          },
        ],
      },
    ])
  })
})

describe('parseMarkup — fenced code', () => {
  it('emits a code block facet over the inner lines', () => {
    const parsed = parseMarkup('```\nfirst\nsecond\n```')
    expect(parsed.content).toBe('first\nsecond')
    expect(parsed.facets).toHaveLength(1)
    expect(parsed.facets[0].index).toEqual({
      byteStart: 0,
      byteEnd: byteLength('first\nsecond'),
    })
  })

  it('omits the language key when the fence has no language', () => {
    // Asserted on the keys: a `language: undefined` value would pass a
    // toEqual against `{ $type }` while still being the wrong record shape.
    const features = onlyFeatures('```\ncode\n```')
    expect(features).toHaveLength(1)
    expect(Object.keys(features[0])).toEqual(['$type'])
    expect(features[0].$type).toBe(`${NS}#codeBlock`)
  })

  it('records the fence language', () => {
    const parsed = parseMarkup('```js\nx = 1\n```')
    expect(parsed.content).toBe('x = 1')
    expect(parsed.facets).toEqual([
      facetOver('x = 1', 'x = 1', codeBlock('js')),
    ])
  })

  it('keeps the fenced lines verbatim, marks and blank lines included', () => {
    const parsed = parseMarkup('```\n**not bold**\n\n# not a heading\n```')
    expect(parsed.content).toBe('**not bold**\n\n# not a heading')
    expect(parsed.facets).toEqual([
      facetOver(parsed.content, parsed.content, codeBlockPlain),
    ])
  })

  it('runs an unclosed fence to the end of the source', () => {
    const parsed = parseMarkup('```js\nline one\nline two')
    expect(parsed.content).toBe('line one\nline two')
    expect(parsed.facets).toEqual([
      facetOver(parsed.content, parsed.content, codeBlock('js')),
    ])
  })

  it('emits no facet for an empty fence', () => {
    expect(parseMarkup('```\n```')).toEqual({
      content: '',
      facets: [],
      mentions: [],
    })
  })

  it('leaves a fence inside a quote literal', () => {
    const parsed = parseMarkup('> ```\n> code\n> ```')
    expect(parsed.content).toBe('```\ncode\n```')
    // The quote strips its own markers; the fence markers are just text.
    expect(parsed.facets).toEqual([
      facetOver(parsed.content, parsed.content, blockquote(1)),
    ])
  })

  it('produces a code block the reader renders verbatim', () => {
    expect(readerTree('```js\nx = 1\n```')).toEqual([
      { type: 'codeBlock', language: 'js', code: 'x = 1' },
    ])
  })
})

describe('parseMarkup — spoiler containers', () => {
  it('emits a spoiler facet over the inner content with its reason', () => {
    const parsed = parseMarkup('::: spoiler the ending\nBob did it\n:::')
    expect(parsed.content).toBe('Bob did it')
    expect(parsed.facets).toEqual([
      facetOver('Bob did it', 'Bob did it', spoiler('the ending')),
    ])
  })

  it('omits the reason key when the container has no reason', () => {
    const features = onlyFeatures('::: spoiler\nhidden\n:::')
    expect(features).toHaveLength(1)
    expect(Object.keys(features[0])).toEqual(['$type'])
    expect(features[0].$type).toBe(`${NS}#spoiler`)
  })

  it('trims the reason', () => {
    const features = onlyFeatures('::: spoiler   the ending  \nhidden\n:::')
    expect(features[0].reason).toBe('the ending')
  })

  it('caps the reason at 32 graphemes', () => {
    const features = onlyFeatures(`::: spoiler ${'a'.repeat(40)}\nhidden\n:::`)
    expect(features[0].reason).toBe('a'.repeat(32))
  })

  it('caps the reason at 128 bytes', () => {
    // Six family emoji are only six graphemes but 150 bytes, so the byte cap
    // is the one that has to bite. Asserted as a prefix within the cap rather
    // than an exact string: where it cuts is an implementation detail, but it
    // must not exceed the lexicon's maxLength.
    const long = '👨‍👩‍👧‍👦'.repeat(6)
    expect(byteLength(long)).toBeGreaterThan(128)
    const reason = onlyFeatures(`::: spoiler ${long}\nhidden\n:::`)[0].reason
    expect(typeof reason).toBe('string')
    const value = String(reason)
    expect(byteLength(value)).toBeLessThanOrEqual(128)
    expect(value.length).toBeGreaterThan(0)
    expect(long.startsWith(value)).toBe(true)
  })

  it('gives an inline mark inside a spoiler its own facet', () => {
    const parsed = parseMarkup('::: spoiler why\na **b**\n:::')
    expect(parsed.content).toBe('a b')
    expect(parsed.facets).toEqual([
      facetOver('a b', 'a b', spoiler('why')),
      facetOver('a b', 'b', bold),
    ])
  })

  it('leaves block constructs inside a spoiler literal', () => {
    const parsed = parseMarkup('::: spoiler why\n# not a heading\n:::')
    expect(parsed.content).toBe('# not a heading')
    expect(parsed.facets).toEqual([
      facetOver(parsed.content, parsed.content, spoiler('why')),
    ])
  })

  it('leaves an unclosed container literal', () => {
    const source = '::: spoiler why\nhidden'
    const parsed = parseMarkup(source)
    expect(parsed.content).toBe(source)
    expect(parsed.facets).toEqual([])
  })

  it('emits no facet for an empty container', () => {
    expect(parseMarkup('::: spoiler why\n:::')).toEqual({
      content: '',
      facets: [],
      mentions: [],
    })
  })

  it('never emits abutting spoiler ranges', () => {
    // The reader merges spoiler ranges that touch, so two adjacent containers
    // must stay separated by the newline between them or they collapse into
    // one revealed block.
    const parsed = parseMarkup(
      '::: spoiler a\none\n:::\n::: spoiler b\ntwo\n:::',
    )
    expect(parsed.content).toBe('one\ntwo')
    expect(parsed.facets).toEqual([
      facetOver(parsed.content, 'one', spoiler('a')),
      facetOver(parsed.content, 'two', spoiler('b')),
    ])
    expect(parsed.facets[0].index.byteEnd).toBeLessThan(
      parsed.facets[1].index.byteStart,
    )
  })

  it('produces a spoiler the reader renders as a spoiler span', () => {
    expect(readerTree('::: spoiler why\nhidden\n:::')).toEqual([
      {
        type: 'paragraph',
        children: [
          {
            type: 'spoiler',
            reason: 'why',
            children: [{ type: 'text', text: 'hidden' }],
          },
        ],
      },
    ])
  })
})

describe('parseMarkup — fence language cap', () => {
  it('caps the language at 40 bytes without splitting a character', () => {
    // The lexicon caps `language` at 40 bytes. A multibyte language string cut
    // at a byte boundary would decode to U+FFFD, so the cut has to land on a
    // character boundary.
    const long = 'ö'.repeat(25)
    expect(byteLength(long)).toBeGreaterThan(40)

    const features = onlyFeatures(`\`\`\`${long}\nx = 1\n\`\`\``)
    const language = features[0].language
    expect(typeof language).toBe('string')

    const value = String(language)
    expect(byteLength(value)).toBeLessThanOrEqual(40)
    expect(value.length).toBeGreaterThan(0)
    expect(long.startsWith(value)).toBe(true)
    expect(value).not.toContain('�')
  })
})
