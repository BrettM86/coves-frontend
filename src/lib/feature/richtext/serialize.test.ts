/**
 * `serializeMarkup` is the inverse of `parseMarkup`, and the round trip is the
 * whole contract: an existing record is serialized into the editor, edited, and
 * recompiled on save. If the trip is not lossless, editing a comment silently
 * rewrites content the author never touched.
 *
 * So almost every test here goes content+facets → markup → parse and asserts
 * two things: the content came back byte-identical, and the reader builds the
 * same tree from both sides. A few cases also pin the markup itself, where the
 * shape is a product decision rather than an implementation detail.
 */
import { describe, expect, it } from 'vitest'
import { parseMarkup } from './compose'
import { buildRichText } from './facets'
import { serializeMarkup } from './serialize'
import { byteRange, facetOver } from './test-helpers'

const NS = 'social.coves.richtext.facet'

const bold = { $type: `${NS}#bold` }
const italic = { $type: `${NS}#italic` }
const strikethrough = { $type: `${NS}#strikethrough` }
const code = { $type: `${NS}#code` }
const link = (uri: string) => ({ $type: `${NS}#link`, uri })
const mentionFeature = (did: string) => ({ $type: `${NS}#mention`, did })
const heading = (level: number) => ({ $type: `${NS}#heading`, level })
const blockquote = (level: number) => ({ $type: `${NS}#blockquote`, level })
const codeBlock = (language?: string) =>
  language === undefined
    ? { $type: `${NS}#codeBlock` }
    : { $type: `${NS}#codeBlock`, language }
const spoiler = (reason?: string) =>
  reason === undefined
    ? { $type: `${NS}#spoiler` }
    : { $type: `${NS}#spoiler`, reason }

/**
 * Serialize, parse the result back, and assert the trip was lossless: the
 * content is byte-identical and the reader builds the same tree from the
 * original facets and from the recompiled ones.
 */
function roundTrip(content: string, facets: unknown[]) {
  const markup = serializeMarkup(content, facets)
  const parsed = parseMarkup(markup)
  expect(parsed.content).toBe(content)
  expect(buildRichText(parsed.content, parsed.facets)).toEqual(
    buildRichText(content, facets),
  )
  return { markup, parsed }
}

describe('serializeMarkup — paragraphs and inline marks', () => {
  it('round-trips plain text', () => {
    roundTrip('just words, nothing special here', [])
  })

  it.each([
    { name: 'bold', feature: bold },
    { name: 'italic', feature: italic },
    { name: 'strikethrough', feature: strikethrough },
    { name: 'code', feature: code },
  ])('round-trips a $name mark', ({ feature }) => {
    const content = 'say loud now'
    roundTrip(content, [facetOver(content, 'loud', feature)])
  })

  it('round-trips a range carrying both bold and italic', () => {
    const content = 'say both now'
    roundTrip(content, [facetOver(content, 'both', bold, italic)])
  })

  it('round-trips marks on adjacent ranges', () => {
    const content = 'one two three'
    roundTrip(content, [
      facetOver(content, 'one', bold),
      facetOver(content, 'three', italic),
    ])
  })
})

describe('serializeMarkup — links', () => {
  it('writes a titled link when the text differs from the target', () => {
    const content = 'read the docs first'
    const { markup } = roundTrip(content, [
      facetOver(content, 'docs', link('https://example.com/d')),
    ])
    expect(markup).toContain('[docs](https://example.com/d)')
  })

  it('writes a bare url when the text is the target', () => {
    // Wrapping it as [https://x](https://x) would be noise in the editor.
    const content = 'see https://example.com/a now'
    const { markup } = roundTrip(content, [
      facetOver(
        content,
        'https://example.com/a',
        link('https://example.com/a'),
      ),
    ])
    expect(markup).toBe(content)
  })
})

describe('serializeMarkup — mentions', () => {
  it('writes the mention text as-is and leaves the did to re-resolution', () => {
    // The markup has no room for a DID, so the handle is what goes in the
    // editor and the resolver looks it up again on save. Reader trees
    // therefore do NOT agree until that happens: the facet is gone and a
    // pending mention takes its place.
    const content = 'cc @alice.coves.social'
    const markup = serializeMarkup(content, [
      facetOver(
        content,
        '@alice.coves.social',
        mentionFeature('did:plc:alice'),
      ),
    ])
    expect(markup).toContain('@alice.coves.social')

    const parsed = parseMarkup(markup)
    expect(parsed.content).toBe(content)
    expect(parsed.facets).toEqual([])
    expect(parsed.mentions).toEqual([
      {
        kind: 'user',
        identifier: 'alice.coves.social',
        ...byteRange(content, '@alice.coves.social'),
      },
    ])
  })
})

describe('serializeMarkup — blocks', () => {
  it.each([1, 2, 3, 4, 5, 6])('round-trips a level-%i heading', (level) => {
    const content = 'Title\nbody text'
    roundTrip(content, [facetOver(content, 'Title', heading(level))])
  })

  it('round-trips a heading containing a mark', () => {
    const content = 'Big news\nbody'
    roundTrip(content, [
      facetOver(content, 'Big news', heading(2)),
      facetOver(content, 'news', bold),
    ])
  })

  it('round-trips a multi-line quote as one facet', () => {
    const content = 'one\ntwo'
    roundTrip(content, [facetOver(content, 'one\ntwo', blockquote(1))])
  })

  it('round-trips adjacent quotes at different levels', () => {
    const content = 'outer\ninner'
    roundTrip(content, [
      facetOver(content, 'outer', blockquote(1)),
      facetOver(content, 'inner', blockquote(2)),
    ])
  })

  it('round-trips a code block with a language', () => {
    const content = 'x = 1\ny = 2'
    roundTrip(content, [facetOver(content, content, codeBlock('js'))])
  })

  it('round-trips a code block without a language', () => {
    const content = 'x = 1'
    roundTrip(content, [facetOver(content, content, codeBlock())])
  })

  it('round-trips code block contents that look like markup', () => {
    // Inside a fence nothing is parsed, so the marker characters must NOT be
    // escaped here — escaping them would change the code the author wrote.
    const content = '**not bold** and # not a heading'
    roundTrip(content, [facetOver(content, content, codeBlock())])
  })

  it('round-trips a spoiler with a reason as a container block', () => {
    const content = 'Bob did it'
    const { markup } = roundTrip(content, [
      facetOver(content, content, spoiler('the ending')),
    ])
    expect(markup).toContain('::: spoiler the ending')
    expect(markup.trimEnd().endsWith(':::')).toBe(true)
  })

  it('round-trips a spoiler without a reason', () => {
    const content = 'Bob did it'
    const { markup } = roundTrip(content, [
      facetOver(content, content, spoiler()),
    ])
    expect(markup).toContain(':::')
  })
})

describe('serializeMarkup — escaping plain text', () => {
  it.each([
    { content: 'a *b* c', why: 'paired asterisks would become italic' },
    {
      content: 'snake_case_word',
      why: 'paired underscores would become italic',
    },
    { content: 'a ~~b~~ c', why: 'tildes would become strikethrough' },
    { content: 'use `code` here', why: 'backticks would become a code span' },
    { content: '[text](https://example.com/a)', why: 'brackets would link' },
    { content: '# not a heading', why: 'a leading hash would head the line' },
    { content: '> not a quote', why: 'a leading angle would quote the line' },
    { content: '::: not a spoiler', why: 'a leading colon run would open one' },
    { content: '``` not a fence', why: 'a leading backtick run would fence' },
    { content: 'a **b** and *c*', why: 'both mark widths' },
  ])('keeps $content literal ($why)', ({ content }) => {
    const { parsed } = roundTrip(content, [])
    expect(parsed.facets).toEqual([])
  })

  it.each([{ content: 'cc @alice.coves.social' }, { content: 'see !gaming' }])(
    'keeps $content identical when it has no mention facet',
    ({ content }) => {
      // A pending mention on the way back in is fine — the resolver decides
      // whether it becomes a facet. What must not change is the content.
      const parsed = parseMarkup(serializeMarkup(content, []))
      expect(parsed.content).toBe(content)
      expect(parsed.facets).toEqual([])
    },
  )
})

describe('serializeMarkup — malformed facets', () => {
  it.each([
    { name: 'a string entry', entry: 'nope' },
    { name: 'a number entry', entry: 42 },
    { name: 'a null entry', entry: null },
    { name: 'an empty object', entry: {} },
    {
      name: 'a facet with no features',
      entry: { index: { byteStart: 0, byteEnd: 4 } },
    },
    {
      name: 'offsets outside the content',
      entry: { index: { byteStart: -5, byteEnd: 9999 }, features: [bold] },
    },
    {
      name: 'a reversed range',
      entry: { index: { byteStart: 3, byteEnd: 1 }, features: [bold] },
    },
    {
      name: 'a non-numeric offset',
      entry: { index: { byteStart: 0, byteEnd: 'four' }, features: [bold] },
    },
  ])('ignores $name and returns the plain content', ({ entry }) => {
    // Records arrive from the network unvalidated. A bad facet must not make
    // the editor unopenable, and must not invent markup.
    expect(serializeMarkup('just words', [entry])).toBe('just words')
  })
})

describe('serializeMarkup — blank lines', () => {
  /*
   * The serializer is built from the reader tree, and the reader trims
   * newlines at block boundaries: it knows a heading is a heading, not how
   * many blank lines sat around it. Content is canonical text, though, so a
   * blank line the author typed is part of what they wrote. Losing one turns
   * opening an old comment in the editor into a silent rewrite of it.
   */

  it('keeps a blank line between a paragraph and a heading', () => {
    const content = 'para\n\nHeading\n\nmore'
    roundTrip(content, [facetOver(content, 'Heading', heading(1))])
  })

  it('keeps two blank lines between paragraphs', () => {
    // A mark in the second paragraph forces the tree walk; with no facets at
    // all the serializer never splits the content into blocks and the gap
    // survives by accident.
    const content = 'one\n\n\ntwo'
    roundTrip(content, [facetOver(content, 'two', bold)])
  })

  it('keeps the blank lines around a blockquote', () => {
    const content = 'intro\n\nquoted\n\ntail'
    roundTrip(content, [facetOver(content, 'quoted', blockquote(1))])
  })

  it('keeps a blank line before a code block', () => {
    const content = 'intro\n\nx = 1'
    roundTrip(content, [facetOver(content, 'x = 1', codeBlock('js'))])
  })

  it('keeps leading and trailing newlines', () => {
    roundTrip('\npara\n', [])
  })

  it('keeps a blank line inside a spoiler container', () => {
    // The spoiler sits between other blocks, so its own boundaries are block
    // boundaries too — the case where trimming bites.
    const content = 'intro\n\nhidden one\n\nhidden two\n\ntail'
    roundTrip(content, [
      facetOver(content, 'hidden one\n\nhidden two', spoiler('why')),
    ])
  })
})

/**
 * Content identity only. Used where the annotation is allowed to degrade to
 * plain text on the way back through the editor, but the author's characters
 * are not: losing a facet dulls a comment, losing a character rewrites it.
 */
function expectContentRoundTrip(content: string, facets: unknown[]) {
  const markup = serializeMarkup(content, facets)
  const parsed = parseMarkup(markup)
  expect(parsed.content).toBe(content)
  return { markup, parsed }
}

describe('serializeMarkup — urls containing parentheses', () => {
  const WIKI = 'https://en.wikipedia.org/wiki/Foo_(bar)'

  it('round-trips a titled link whose target ends in a paren', () => {
    const content = 'read the docs first'
    const { parsed } = roundTrip(content, [
      facetOver(content, 'docs', link(WIKI)),
    ])
    expect(parsed.facets).toEqual([facetOver(content, 'docs', link(WIKI))])
  })

  it('round-trips a bare link whose target ends in a paren', () => {
    const content = `see ${WIKI} now`
    const { parsed } = roundTrip(content, [
      facetOver(content, WIKI, link(WIKI)),
    ])
    expect(parsed.facets).toEqual([facetOver(content, WIKI, link(WIKI))])
  })
})

describe('serializeMarkup — features stacked on one range', () => {
  it('keeps both bold and link on a marked url', () => {
    const url = 'https://x.com/a'
    const content = `see ${url} now`
    const { parsed } = roundTrip(content, [
      facetOver(content, url, bold, link(url)),
    ])
    const features = parsed.facets[0].features.map((f) => f.$type)
    expect(features).toContain(`${NS}#bold`)
    expect(features).toContain(`${NS}#link`)
  })

  it('keeps bold over a mention and re-resolves the handle', () => {
    const text = '@alice.coves.social'
    const content = `cc ${text}`
    const { parsed } = expectContentRoundTrip(content, [
      facetOver(content, text, bold, mentionFeature('did:plc:alice')),
    ])

    // The mention becomes pending again; the bold survives as a facet.
    expect(parsed.mentions).toEqual([
      {
        kind: 'user',
        identifier: 'alice.coves.social',
        ...byteRange(content, text),
      },
    ])
    expect(parsed.facets).toEqual([facetOver(content, text, bold)])
  })
})

describe('serializeMarkup — annotations that may degrade', () => {
  it('keeps the content of a mid-paragraph spoiler on one line', () => {
    // A spoiler serializes as a container block, so a mid-paragraph one cannot
    // survive as a spoiler without inventing line breaks. Dropping the
    // annotation is accepted; adding a newline to the author's text is not.
    const content = 'a secret b'
    const { parsed } = expectContentRoundTrip(content, [
      facetOver(content, 'secret', spoiler('why')),
    ])
    expect(parsed.content).not.toContain('\n')
  })

  it('keeps the content of a code span containing a backtick', () => {
    const content = 'x a`b y'
    expectContentRoundTrip(content, [facetOver(content, 'a`b', code)])
  })

  it('keeps the content of a code span spanning a line break', () => {
    const content = 'x\ny'
    expectContentRoundTrip(content, [facetOver(content, content, code)])
  })

  it('keeps the content when a stored link uri ends in a full stop', () => {
    const text = 'https://example.com/a.'
    const content = `see ${text} now`
    expectContentRoundTrip(content, [facetOver(content, text, link(text))])
  })
})

describe('serializeMarkup — nested emphasis straight from the parser', () => {
  /*
   * The serializer has to survive whatever the parser produces, and nested
   * emphasis is the case where the two disagree most easily: an inner mark on a
   * sub-range of an outer one has to come back out as nested markers, not as
   * two flat runs that re-parse differently.
   */
  it.each([
    { source: '*a **b** c*', outer: 'italic' },
    { source: '**a *b* c**', outer: 'bold' },
    { source: '~~a **b** c~~', outer: 'strikethrough' },
  ])('round-trips the parse of $source ($outer outside)', ({ source }) => {
    const parsed = parseMarkup(source)
    expect(parsed.facets).toHaveLength(2)

    const { parsed: again } = roundTrip(parsed.content, parsed.facets)

    expect(again.facets).toEqual(parsed.facets)
  })
})
