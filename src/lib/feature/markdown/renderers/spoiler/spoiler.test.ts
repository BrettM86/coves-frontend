import { describe, it, expect } from 'vitest'
import { Marked, type Token } from 'marked'
import containerExtension from './spoiler'

// ---------------------------------------------------------------------------
// Characterization tests for the ::: container extension.
//
// These pin what the extension actually does. They were written as the net
// for the JS -> TS port and remain the regression net for it. Where behavior
// contradicts the JSDoc on spoiler.ts the test follows the CODE, and says so:
// any correction is a separate, deliberate change.
// ---------------------------------------------------------------------------

/** What the extension hands to the tokensExtractor callback. */
interface ContainerParams {
  type: string
  content: string
  raw: string
  options: Record<string, string | true>
  lexer: unknown
}

/** Minimal stand-in for marked's Lexer, for direct tokenizer calls. */
interface LexerLike {
  blockTokens(src: string, tokens: unknown[]): unknown
}

interface ContainerToken {
  type: string
  raw: string
  options?: Record<string, string | true>
  tokens?: Token[]
}

/**
 * Records every tokensExtractor invocation and returns a token shaped the way
 * Markdown.svelte's real extractor does.
 */
const recordingExtension = (
  withTokens = true,
): {
  calls: ContainerParams[]
  extension: ReturnType<typeof containerExtension>
} => {
  const calls: ContainerParams[] = []
  const extension = containerExtension((params: ContainerParams) => {
    calls.push(params)
    const token: ContainerToken = {
      type: 'spoiler',
      raw: params.raw,
      options: params.options,
    }
    if (withTokens) token.tokens = []
    return token
  })
  return { calls, extension }
}

/** A fresh marked instance per call, so the global singleton is never mutated. */
const lex = (
  src: string,
  extension: ReturnType<typeof containerExtension>,
): ContainerToken[] => {
  const marked = new Marked()
  marked.use({ extensions: [extension] })
  return marked.lexer(src) as unknown as ContainerToken[]
}

/** Invoke the tokenizer directly, with a stub lexer as `this`. */
const callTokenizer = (
  extension: ReturnType<typeof containerExtension>,
  src: string,
): unknown => {
  const lexer: LexerLike = { blockTokens: () => [] }
  const tokenizer = extension.tokenizer as unknown as (
    this: { lexer: LexerLike },
    src: string,
  ) => unknown
  return tokenizer.call({ lexer }, src)
}

const callStart = (
  extension: ReturnType<typeof containerExtension>,
  src: string,
): number | undefined => {
  const start = extension.start as unknown as (
    src: string,
  ) => number | undefined
  return start(src)
}

// ---------------------------------------------------------------------------
// containerExtension() - extension shape
// ---------------------------------------------------------------------------

describe('containerExtension - extension shape', () => {
  it('registers as a block-level extension named "container"', () => {
    const { extension } = recordingExtension()
    expect(extension.name).toBe('container')
    expect(extension.level).toBe('block')
  })
})

// ---------------------------------------------------------------------------
// containerExtension() - start() offsets
// ---------------------------------------------------------------------------

describe('containerExtension - start()', () => {
  it('returns 0 when the source opens with a container', () => {
    const { extension } = recordingExtension()
    expect(callStart(extension, ':::spoiler t\nx\n:::')).toBe(0)
  })

  it('returns 0 for a container opened with ":::" plus a space', () => {
    const { extension } = recordingExtension()
    expect(callStart(extension, '::: spoiler t\n')).toBe(0)
  })

  it('returns the offset of a container later in the source', () => {
    const { extension } = recordingExtension()
    expect(callStart(extension, 'x\n:::a')).toBe(2)
  })

  it('matches ":::" anywhere in a line, not only at its start', () => {
    const { extension } = recordingExtension()
    expect(callStart(extension, 'aaa:::b')).toBe(3)
  })

  it('returns undefined when there is no container marker', () => {
    const { extension } = recordingExtension()
    expect(callStart(extension, 'no container here')).toBeUndefined()
  })

  it('returns undefined for a bare ":::" with nothing after it', () => {
    // The start rule is /:::[^:\n]/ — it requires a following non-newline,
    // non-colon character, so a lone closing fence is not a start hint.
    const { extension } = recordingExtension()
    expect(callStart(extension, ':::\n')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// containerExtension() - tokenizer() rejection
// ---------------------------------------------------------------------------

describe('containerExtension - tokenizer() rejection', () => {
  it('declines input that does not open with ":::"', () => {
    const { extension, calls } = recordingExtension()
    expect(callTokenizer(extension, 'plain paragraph text\n')).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('declines an unterminated container', () => {
    const { extension, calls } = recordingExtension()
    expect(
      callTokenizer(extension, '::: spoiler Oops\nno close here\n'),
    ).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('leaves an unterminated container as an ordinary paragraph', () => {
    const { extension } = recordingExtension()
    const tokens = lex('::: spoiler Oops\nno close here\n', extension)
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('paragraph')
  })
})

// ---------------------------------------------------------------------------
// containerExtension() - tokensExtractor callback contract
// ---------------------------------------------------------------------------

describe('containerExtension - tokensExtractor contract', () => {
  it('passes type, content, raw, options and lexer to the extractor', () => {
    const { extension, calls } = recordingExtension()
    lex('::: spoiler Title\ninner **bold**\n:::\n', extension)

    expect(calls).toHaveLength(1)
    const params = calls[0]
    expect(params?.type).toBe('spoiler')
    expect(params?.content).toBe('inner **bold**')
    expect(params?.raw).toBe('::: spoiler Title\ninner **bold**\n:::')
    expect(params?.options).toEqual({ Title: true })
    expect(params?.lexer).toBeDefined()
  })

  it('lowercases the container type', () => {
    const { extension, calls } = recordingExtension()
    lex('::: SPOILER Foo\nX\n:::\n', extension)
    expect(calls[0]?.type).toBe('spoiler')
  })

  it('populates result.tokens with nested block tokens when present', () => {
    const { extension } = recordingExtension(true)
    const tokens = lex('::: spoiler Title\ninner **bold**\n:::\n', extension)

    const nested = tokens[0]?.tokens as { type: string }[] | undefined
    expect(nested).toBeDefined()
    expect(nested?.[0]?.type).toBe('paragraph')
  })

  it('leaves the token alone when the extractor returns no tokens array', () => {
    const { extension } = recordingExtension(false)
    const tokens = lex('::: spoiler Title\ninner **bold**\n:::\n', extension)
    expect(tokens[0]?.tokens).toBeUndefined()
  })

  it('excludes the trailing newline from raw but keeps it on the token', () => {
    const { extension, calls } = recordingExtension()
    const tokens = lex('::: spoiler T\nX\n:::\n', extension)
    expect(calls[0]?.raw).toBe('::: spoiler T\nX\n:::')
    expect(tokens[0]?.raw).toBe('::: spoiler T\nX\n:::\n')
  })
})

// ---------------------------------------------------------------------------
// findRawContainer() - nesting and termination
// ---------------------------------------------------------------------------

describe('containerExtension - nesting', () => {
  it('closes at the matching fence when the inner container has no space', () => {
    // findRawContainer counts an opening fence only when /:::[^:\n\s]/ matches,
    // i.e. ":::spoiler" with no space. Here nesting is tracked correctly and
    // the outer container swallows the whole inner one.
    const { extension, calls } = recordingExtension()
    const src =
      ':::spoiler Outer\nbefore\n:::spoiler Inner\ndeep\n:::\nafter\n:::\n'
    const tokens = lex(src, extension)

    expect(tokens).toHaveLength(1)
    expect(calls[0]?.content).toBe('before\n:::spoiler Inner\ndeep\n:::\nafter')
    expect(calls[0]?.raw).toBe(
      ':::spoiler Outer\nbefore\n:::spoiler Inner\ndeep\n:::\nafter\n:::',
    )
    expect(calls[0]?.options).toEqual({ Outer: true })
  })

  it('parses the inner container as its own container token', () => {
    const { extension, calls } = recordingExtension()
    lex(
      ':::spoiler Outer\nbefore\n:::spoiler Inner\ndeep\n:::\nafter\n:::\n',
      extension,
    )
    expect(calls).toHaveLength(2)
    expect(calls[1]?.content).toBe('deep')
    expect(calls[1]?.options).toEqual({ Inner: true })
  })

  it('does NOT count an inner fence written as "::: name" as an opener', () => {
    // Characterizes a real asymmetry: "::: spoiler Inner" (with a space) fails
    // the /:::[^:\n\s]/ opener test, so `open` is never incremented and the
    // outer container terminates at the INNER closing fence. Content after it
    // spills out of the container.
    const { extension, calls } = recordingExtension()
    const src =
      ':::spoiler Outer\nbefore\n::: spoiler Inner\ndeep\n:::\nafter\n:::\n'
    const tokens = lex(src, extension)

    expect(calls[0]?.content).toBe('before\n::: spoiler Inner\ndeep')
    expect(tokens).toHaveLength(2)
    expect(tokens[1]?.type).toBe('paragraph')
    expect(tokens[1]?.raw).toBe('after\n:::\n')
  })
})

// ---------------------------------------------------------------------------
// parseOptions() - option string forms
//
// NOTE: the name pattern is /[a-z0-9]+/i, which does NOT include "-". Hyphenated
// option names are therefore split into several options, contradicting the
// JSDoc example on spoiler.ts. These tests pin the CODE's behavior.
// ---------------------------------------------------------------------------

describe('containerExtension - parseOptions', () => {
  const optionsFor = (header: string): Record<string, string | true> => {
    const { extension, calls } = recordingExtension()
    lex(`${header}\nX\n:::\n`, extension)
    return calls[0]?.options ?? {}
  }

  it('returns an empty object when there are no options', () => {
    expect(optionsFor(':::container')).toEqual({})
  })

  it('returns an empty object for a whitespace-only option string', () => {
    expect(optionsFor(':::container ')).toEqual({})
  })

  it('maps a bare name to true', () => {
    expect(optionsFor(':::container flag')).toEqual({ flag: true })
  })

  it('maps name="value" to the quoted value', () => {
    expect(optionsFor(':::container a="1"')).toEqual({ a: '1' })
  })

  it('parses multiple quoted options', () => {
    expect(optionsFor(':::container a="1" b="2"')).toEqual({ a: '1', b: '2' })
  })

  it('parses several bare names as separate true flags', () => {
    expect(optionsFor(':::container one two')).toEqual({
      one: true,
      two: true,
    })
  })

  it('splits a hyphenated bare name into two options (contradicts the JSDoc)', () => {
    expect(optionsFor(':::container boolean-option')).toEqual({
      boolean: true,
      option: true,
    })
  })

  it('mangles a hyphenated name="value" option (contradicts the JSDoc)', () => {
    // Documented as { 'option-2': 'option-2' }. Actually: "option" is taken as
    // a bare flag, then "2" picks up the quoted value.
    expect(optionsFor(':::container option-2="option-2"')).toEqual({
      option: true,
      '2': 'option-2',
    })
  })
})
