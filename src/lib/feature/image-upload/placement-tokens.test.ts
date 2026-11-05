/**
 * Placement tokens in the composer text: inserting one for a strip tile, and
 * keeping the recognised ones in step when the strip loses or reorders an
 * image. Recognition is parseMarkup's, so token-shaped text that parseMarkup
 * would leave literal is never touched.
 */
import { describe, expect, it } from 'vitest'
import { parseMarkup } from '$lib/feature/richtext/compose'
import {
  insertPlacementToken,
  removePlacementToken,
  reorderPlacementTokens,
} from './placement-tokens'

describe('insertPlacementToken', () => {
  it('collapses whitespace runs in the alt text and trims it', () => {
    expect(insertPlacementToken('', 0, '  a\n\nb  ', 1)).toEqual({
      text: '![a b](image:1)',
      caret: 15,
    })
  })

  it.each([
    [
      'mid-line',
      'hello world',
      5,
      { text: 'hello\n![x](image:2)\n world', caret: 19 },
    ],
    ['at the start', 'abc', 0, { text: '![x](image:2)\nabc', caret: 13 }],
    [
      'right after a newline at the end',
      'abc\n',
      4,
      { text: 'abc\n![x](image:2)', caret: 17 },
    ],
    [
      'right before a newline',
      'abc\ndef',
      3,
      { text: 'abc\n![x](image:2)\ndef', caret: 17 },
    ],
    ['at the end', 'abc', 3, { text: 'abc\n![x](image:2)', caret: 17 }],
  ])(
    'puts the token on its own line when the caret is %s',
    (_name, text, caret, expected) => {
      expect(insertPlacementToken(text, caret, 'x', 2)).toEqual(expected)
    },
  )

  it('cuts the alt text to 100 graphemes', () => {
    const inserted = insertPlacementToken('', 0, '👍🏽'.repeat(101), 1)
    expect(inserted.text).toBe(`![${'👍🏽'.repeat(100)}](image:1)`)
  })

  it.each([
    ['empty', ''],
    ['whitespace-only', ' \n '],
  ])('writes [image] for %s alt text', (_name, alt) => {
    expect(insertPlacementToken('', 0, alt, 3).text).toBe('![[image]](image:3)')
  })

  it('writes alt text with brackets so the token compiles back to it', () => {
    const inserted = insertPlacementToken('', 0, 'a [b] c', 1)
    const parsed = parseMarkup(inserted.text, { imageCount: 1 })
    expect(parsed.content).toBe('a [b] c')
    expect(parsed.facets).toEqual([
      {
        index: { byteStart: 0, byteEnd: 7 },
        features: [{ $type: 'social.coves.richtext.facet#image', index: 0 }],
      },
    ])
  })
})

describe('removePlacementToken', () => {
  it('deletes the removed token and renumbers the tokens above it', () => {
    expect(
      removePlacementToken('![a](image:1)\n![b](image:2)\n![c](image:3)', 2, 3),
    ).toBe('![a](image:1)\n\n![c](image:2)')
  })
})

describe('reorderPlacementTokens', () => {
  it('renumbers tokens to their new strip positions', () => {
    expect(
      reorderPlacementTokens(
        '![a](image:1)\n![b](image:2)\n![c](image:3)',
        [3, 2, 1],
      ),
    ).toBe('![a](image:3)\n![b](image:2)\n![c](image:1)')
  })
})

describe('unrecognised token-shaped text', () => {
  // A repeated N, a code span, a fenced code block and link text: parseMarkup
  // leaves all four literal, so the strip actions must too.
  const literalTail =
    '![dup](image:2)\n' +
    '`![x](image:2)`\n' +
    '```\n![x](image:2)\n```\n' +
    '[![x](image:2)](https://a.example)'
  const text = `![a](image:1)\n![b](image:2)\n${literalTail}`

  it('is left untouched by remove', () => {
    expect(removePlacementToken(text, 1, 2)).toBe(
      `\n![b](image:1)\n${literalTail}`,
    )
  })

  it('is left untouched by reorder', () => {
    expect(reorderPlacementTokens(text, [2, 1])).toBe(
      `![a](image:2)\n![b](image:1)\n${literalTail}`,
    )
  })
})

describe('tokens inside block and inline constructs', () => {
  // The token's range is recognised inside a heading, a quote, a quoted
  // heading, emphasis and a spoiler; each rewrite must touch exactly the
  // token's own characters, not text shifted by the construct's markers.
  const contexts: [string, (token: string) => string][] = [
    ['a heading', (token) => `# h ${token}`],
    ['a quote', (token) => `> q ${token}`],
    ['a quoted heading', (token) => `> # ${token}`],
    ['emphasis', (token) => `a **${token}** b`],
    ['a spoiler', (token) => `::: spoiler why\nsee ${token} here\n:::`],
  ]

  it.each(contexts)(
    'renumbers the token in %s when an earlier image is removed',
    (_label, wrap) => {
      expect(removePlacementToken(wrap('![x](image:2)'), 1, 2)).toBe(
        wrap('![x](image:1)'),
      )
    },
  )

  it.each(contexts)(
    'deletes the token in %s when its image is removed',
    (_label, wrap) => {
      expect(removePlacementToken(wrap('![x](image:2)'), 2, 2)).toBe(wrap(''))
    },
  )

  it.each(contexts)(
    'renumbers the token in %s when the strip is reordered',
    (_label, wrap) => {
      expect(reorderPlacementTokens(wrap('![x](image:2)'), [2, 1])).toBe(
        wrap('![x](image:1)'),
      )
    },
  )
})
