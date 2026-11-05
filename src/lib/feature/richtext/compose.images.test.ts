/**
 * `#image` placements in `parseMarkup`: a recognised `![covered](image:N)`
 * token compiles to its covered text plus a facet with the single `#image`
 * feature, `index: N-1`. Everything else stays literal text.
 *
 * Every "stays literal" case carries a recognised placement alongside it, so
 * the assertion is "exactly one #image facet, from the valid token". A bare
 * negative would pass against a parser that never recognises anything.
 */
import { describe, expect, it } from 'vitest'
import { parseMarkup, trimRichText } from './compose'
import { composeRichText, type MentionResolver } from './mentions'

const NS = 'social.coves.richtext.facet'

const image = (index: number) => ({ $type: `${NS}#image`, index })

function facet(
  byteStart: number,
  byteEnd: number,
  ...features: Record<string, unknown>[]
) {
  return { index: { byteStart, byteEnd }, features }
}

function imageFacets(source: string, imageCount: number) {
  return parseMarkup(source, { imageCount }).facets.filter((candidate) =>
    candidate.features.some((feature) => feature.$type === `${NS}#image`),
  )
}

describe('parseMarkup — recognised placements', () => {
  it('replaces the token with its covered text and emits one #image facet', () => {
    const parsed = parseMarkup('![A cat](image:2)', { imageCount: 3 })
    expect(parsed.content).toBe('A cat')
    expect(parsed.facets).toEqual([facet(0, 5, image(1))])
  })

  it('compiles a token mid-paragraph', () => {
    const parsed = parseMarkup('before ![x](image:1) after', { imageCount: 1 })
    expect(parsed.content).toBe('before x after')
    expect(parsed.facets).toEqual([facet(7, 8, image(0))])
  })

  it.each([
    ['a quote', '> ![x](image:1)', { $type: `${NS}#blockquote`, level: 1 }],
    ['a heading', '# ![x](image:1)', { $type: `${NS}#heading`, level: 1 }],
    [
      'a spoiler block',
      '::: spoiler why\n![x](image:1)\n:::',
      { $type: `${NS}#spoiler`, reason: 'why' },
    ],
  ])(
    'compiles a token inside %s, beside the container facet',
    (_name, source, container) => {
      const parsed = parseMarkup(source, { imageCount: 1 })
      expect(parsed.content).toBe('x')
      expect(parsed.facets).toHaveLength(2)
      expect(parsed.facets).toEqual(
        expect.arrayContaining([facet(0, 1, container), facet(0, 1, image(0))]),
      )
    },
  )
})

describe('parseMarkup — tokens that stay literal', () => {
  it.each([
    [
      'N above imageCount',
      '![ok](image:1)\n![x](image:4)',
      3,
      'ok\n![x](image:4)',
      [facet(0, 2, image(0))],
    ],
    [
      'N of zero',
      '![ok](image:1)\n![x](image:0)',
      3,
      'ok\n![x](image:0)',
      [facet(0, 2, image(0))],
    ],
    [
      'a repeated N (the first occurrence compiles)',
      '![x](image:2) ![y](image:2)',
      3,
      'x ![y](image:2)',
      [facet(0, 1, image(1))],
    ],
    [
      'empty bracket text',
      '![ok](image:1)\n![](image:2)',
      2,
      'ok\n![](image:2)',
      [facet(0, 2, image(0))],
    ],
    [
      'a code span',
      '![ok](image:1)\n`![x](image:2)`',
      2,
      'ok\n![x](image:2)',
      [facet(0, 2, image(0)), facet(3, 16, { $type: `${NS}#code` })],
    ],
    [
      'a code block',
      '![ok](image:1)\n```\n![x](image:2)\n```',
      2,
      'ok\n![x](image:2)',
      [facet(0, 2, image(0)), facet(3, 16, { $type: `${NS}#codeBlock` })],
    ],
  ])(
    'keeps a token literal for %s',
    (_name, source, imageCount, content, facets) => {
      const parsed = parseMarkup(source, { imageCount })
      expect(parsed.content).toBe(content)
      expect(parsed.facets).toEqual(facets)
    },
  )

  it('keeps a token inside link text literal', () => {
    const source = '![ok](image:1)\n[![x](image:2)](https://a.example)'
    expect(parseMarkup(source, { imageCount: 2 }).content).toContain(
      '![x](image:2)',
    )
    expect(imageFacets(source, 2)).toEqual([facet(0, 2, image(0))])
  })
})

describe('parseMarkup — behaviour without placements (guard)', () => {
  it.each([
    ['imageCount 0', { imageCount: 0 }],
    ['no options', undefined],
  ])('keeps a token literal with %s', (_name, options) => {
    expect(parseMarkup('![x](image:1)', options)).toEqual({
      content: '![x](image:1)',
      facets: [],
      mentions: [],
    })
  })

  it('never turns an external image URL into a placement', () => {
    expect(
      parseMarkup('![alt](https://a.example/p.png)', { imageCount: 1 }),
    ).toEqual({
      content: '!alt',
      facets: [
        facet(1, 4, { $type: `${NS}#link`, uri: 'https://a.example/p.png' }),
      ],
      mentions: [],
    })
  })
})

describe('parseMarkup — covered text is plain', () => {
  const source = '![**bold** @alice.test https://x.example](image:1)'
  const covered = '**bold** @alice.test https://x.example'

  it('applies no formatting, link or mention detection to covered text', () => {
    const parsed = parseMarkup(source, { imageCount: 1 })
    expect(parsed.content).toBe(covered)
    expect(parsed.facets).toEqual([facet(0, 38, image(0))])
    expect(parsed.mentions).toEqual([])
  })

  it('asks the resolver for nothing inside covered text', async () => {
    const lookups: string[] = []
    const resolver: MentionResolver = {
      resolveHandle: async ({ handle }) => {
        lookups.push(handle)
        return { did: 'did:plc:alice' }
      },
      getCommunity: async ({ community }) => {
        lookups.push(community)
        return { did: 'did:plc:community' }
      },
    }
    const composed = await composeRichText(source, resolver, { imageCount: 1 })
    expect(lookups).toEqual([])
    expect(composed).toEqual({
      content: covered,
      facets: [facet(0, 38, image(0))],
    })
  })
})

describe('parseMarkup — placements are never merged into other facets', () => {
  it.each([
    ['a bold token', '**![x](image:1)**', 'x', 1],
    [
      'a bold token with bold markers inside',
      '**![a **b** c](image:1)**',
      'a **b** c',
      9,
    ],
  ])(
    'keeps the #image feature in its own facet for %s',
    (_name, source, content, byteEnd) => {
      const parsed = parseMarkup(source, { imageCount: 1 })
      expect(parsed.content).toBe(content)
      expect(parsed.facets).toHaveLength(2)
      expect(parsed.facets).toEqual(
        expect.arrayContaining([
          facet(0, byteEnd, { $type: `${NS}#bold` }),
          facet(0, byteEnd, image(0)),
        ]),
      )
    },
  )
})

describe('trimRichText — placements', () => {
  it('shifts a placement range with the trimmed content', () => {
    const trimmed = trimRichText(
      parseMarkup('  \n![A cat](image:1)\n  ', { imageCount: 1 }),
    )
    expect(trimmed.content).toBe('A cat')
    expect(trimmed.facets).toEqual([facet(0, 5, image(0))])
  })
})
