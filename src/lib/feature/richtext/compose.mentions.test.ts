/**
 * Mention detection inside `parseMarkup`. Parsing cannot emit a `#mention`
 * facet — that needs a DID, which only the AppView can supply — so it records
 * a pending span instead and the resolver fills it in.
 *
 * Two things these tests pin hardest: the span INCLUDES the sigil (the reader
 * routes a community mention by the leading '!', so the facet range has to
 * cover it), and occurrences are NOT deduplicated here. Deduplication is the
 * resolver's job, because it is the thing making network calls.
 *
 * Every "this is not a mention" case carries a real mention alongside it, so
 * the assertion is "exactly one mention, from the valid form". A bare negative
 * would pass against a parser that never detects anything at all.
 */
import { describe, expect, it } from 'vitest'
import {
  isValidCommunityAddress,
  isValidCommunityName,
  isValidHandle,
} from '$lib/types/atproto'
import { parseMarkup } from './compose'
import { byteLength, byteRange, facetOver } from './test-helpers'

const NS = 'social.coves.richtext.facet'

const HANDLE = 'alice.coves.social'
const USER_TEXT = `@${HANDLE}`

/** A pending mention span, sigil included, measured over `content`. */
function mention(
  kind: 'user' | 'community',
  content: string,
  text: string,
): Record<string, unknown> {
  return { kind, identifier: text.slice(1), ...byteRange(content, text) }
}

/** A pending user mention at a known byte offset, for repeated handles. */
function userMentionAt(byteStart: number): Record<string, unknown> {
  return {
    kind: 'user',
    identifier: HANDLE,
    byteStart,
    byteEnd: byteStart + byteLength(USER_TEXT),
  }
}

describe('parseMarkup — user mentions', () => {
  it('records a pending user mention covering the @ sigil', () => {
    // The grammar and the branded types have to admit the same strings.
    expect(isValidHandle(HANDLE)).toBe(true)

    const parsed = parseMarkup(USER_TEXT)
    expect(parsed.content).toBe(USER_TEXT)
    expect(parsed.mentions).toEqual([mention('user', USER_TEXT, USER_TEXT)])
    // No facet: the DID is not known yet, and a mention facet without one is
    // invalid.
    expect(parsed.facets).toEqual([])
  })

  it('records a mention mid-sentence', () => {
    const content = `cc ${USER_TEXT} please`
    const parsed = parseMarkup(content)
    expect(parsed.content).toBe(content)
    expect(parsed.mentions).toEqual([mention('user', content, USER_TEXT)])
  })

  it('measures the span in UTF-8 bytes after multibyte text', () => {
    const content = `wörld 🌊 ${USER_TEXT}`
    const parsed = parseMarkup(content)
    expect(parsed.content).toBe(content)
    expect(parsed.mentions).toEqual([mention('user', content, USER_TEXT)])
  })

  it.each([['.'], [','], ['!'], ['?'], [';'], [':'], [')']])(
    'excludes a trailing %s from the handle',
    (punctuation) => {
      const content = `ask ${USER_TEXT}${punctuation} ok`
      const parsed = parseMarkup(content)
      expect(parsed.content).toBe(content)
      expect(parsed.mentions).toEqual([mention('user', content, USER_TEXT)])
    },
  )

  it('lists every occurrence rather than deduplicating', () => {
    const content = `${USER_TEXT} and ${USER_TEXT}`
    const parsed = parseMarkup(content)
    expect(parsed.mentions).toEqual([
      userMentionAt(0),
      userMentionAt(byteLength(`${USER_TEXT} and `)),
    ])
  })
})

describe('parseMarkup — community mentions', () => {
  it('records a name@origin address', () => {
    const text = '!gaming@coves.social'
    expect(isValidCommunityAddress(text.slice(1))).toBe(true)

    const parsed = parseMarkup(`see ${text} today`)
    expect(parsed.mentions).toEqual([
      mention('community', parsed.content, text),
    ])
    expect(parsed.facets).toEqual([])
  })

  it('records a bare community name', () => {
    expect(isValidCommunityName('gaming')).toBe(true)

    const parsed = parseMarkup('see !gaming today')
    expect(parsed.mentions).toEqual([
      mention('community', parsed.content, '!gaming'),
    ])
  })

  it('excludes trailing punctuation from a bare name', () => {
    const content = 'see !gaming, ok'
    const parsed = parseMarkup(content)
    expect(parsed.mentions).toEqual([mention('community', content, '!gaming')])
  })
})

describe('parseMarkup — non-mentions', () => {
  it.each([
    { fragment: '@not a handle', why: 'the first word is not a handle' },
    { fragment: '@alice', why: 'a handle needs at least one dot' },
    { fragment: 'mail a@b.com', why: 'the sigil is not at a word start' },
    { fragment: 'costs 50@', why: 'a bare sigil' },
    { fragment: 'wow! amazing', why: 'a bare community sigil' },
    { fragment: '!-bad', why: 'a community name cannot start with a hyphen' },
  ])(
    'records only the real mention next to $fragment ($why)',
    ({ fragment }) => {
      const content = `${fragment} ${USER_TEXT}`
      const parsed = parseMarkup(content)
      expect(parsed.content).toBe(content)
      expect(parsed.mentions).toEqual([mention('user', content, USER_TEXT)])
      expect(parsed.facets).toEqual([])
    },
  )

  it('ignores a mention inside a code span but not one beside it', () => {
    const parsed = parseMarkup(`\`${USER_TEXT}\` and ${USER_TEXT}`)
    const content = `${USER_TEXT} and ${USER_TEXT}`
    expect(parsed.content).toBe(content)
    expect(parsed.mentions).toEqual([
      userMentionAt(byteLength(`${USER_TEXT} and `)),
    ])
    // facetOver measures the first occurrence, which is the code span.
    expect(parsed.facets).toEqual([
      facetOver(content, USER_TEXT, { $type: `${NS}#code` }),
    ])
  })

  it('ignores a mention inside titled link text but not one beside it', () => {
    const parsed = parseMarkup(
      `[${USER_TEXT}](https://example.com/a) and ${USER_TEXT}`,
    )
    const content = `${USER_TEXT} and ${USER_TEXT}`
    expect(parsed.content).toBe(content)
    expect(parsed.mentions).toEqual([
      userMentionAt(byteLength(`${USER_TEXT} and `)),
    ])
    expect(parsed.facets).toEqual([
      facetOver(content, USER_TEXT, {
        $type: `${NS}#link`,
        uri: 'https://example.com/a',
      }),
    ])
  })

  it('ignores a mention inside a fenced code block but not one after it', () => {
    const parsed = parseMarkup(`\`\`\`\n${USER_TEXT}\n\`\`\`\ncc ${USER_TEXT}`)
    const content = `${USER_TEXT}\ncc ${USER_TEXT}`
    expect(parsed.content).toBe(content)
    expect(parsed.mentions).toEqual([
      userMentionAt(byteLength(`${USER_TEXT}\ncc `)),
    ])
    expect(parsed.facets).toEqual([
      facetOver(content, USER_TEXT, { $type: `${NS}#codeBlock` }),
    ])
  })
})

describe('parseMarkup — mentions inside blocks', () => {
  it('detects a mention inside a heading', () => {
    const parsed = parseMarkup(`## hi ${USER_TEXT}`)
    expect(parsed.content).toBe(`hi ${USER_TEXT}`)
    expect(parsed.mentions).toEqual([
      mention('user', parsed.content, USER_TEXT),
    ])
    expect(parsed.facets).toEqual([
      facetOver(parsed.content, parsed.content, {
        $type: `${NS}#heading`,
        level: 2,
      }),
    ])
  })

  it('detects a mention inside a blockquote', () => {
    const parsed = parseMarkup(`> hi ${USER_TEXT}`)
    expect(parsed.content).toBe(`hi ${USER_TEXT}`)
    expect(parsed.mentions).toEqual([
      mention('user', parsed.content, USER_TEXT),
    ])
    expect(parsed.facets).toEqual([
      facetOver(parsed.content, parsed.content, {
        $type: `${NS}#blockquote`,
        level: 1,
      }),
    ])
  })

  it('detects a mention inside a spoiler container', () => {
    const parsed = parseMarkup(`::: spoiler why\ncc ${USER_TEXT}\n:::`)
    expect(parsed.content).toBe(`cc ${USER_TEXT}`)
    expect(parsed.mentions).toEqual([
      mention('user', parsed.content, USER_TEXT),
    ])
    expect(parsed.facets).toEqual([
      facetOver(parsed.content, parsed.content, {
        $type: `${NS}#spoiler`,
        reason: 'why',
      }),
    ])
  })
})
