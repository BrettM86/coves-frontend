import { describe, it, expect } from 'vitest'
import { Marked } from 'marked'
import {
  localizeLink,
  isSafeHref,
  CONTENT_REGEXES,
  linkify,
  subSupscriptExtension,
} from './plugins'

// ---------------------------------------------------------------------------
// localizeLink() - user links
// ---------------------------------------------------------------------------

describe('localizeLink - user links', () => {
  it('rewrites user link with @ to /profile/ path (no instance appended)', () => {
    const result = localizeLink('https://lemmy.world/u/alice@instance.com')
    expect(result).toBe('/profile/alice@instance.com')
  })

  it('rewrites user link without @ to /profile/ path with instance appended', () => {
    const result = localizeLink('https://lemmy.world/u/alice')
    expect(result).toBe('/profile/alice@lemmy.world')
  })

  it('handles user link with dots in username', () => {
    const result = localizeLink('https://example.com/u/user.name')
    expect(result).toBe('/profile/user.name@example.com')
  })

  it('handles user link with underscores in username', () => {
    const result = localizeLink('https://example.com/u/my_user')
    expect(result).toBe('/profile/my_user@example.com')
  })
})

// ---------------------------------------------------------------------------
// localizeLink() - mailto links stay untouched (real email links must work)
// ---------------------------------------------------------------------------

describe('localizeLink - mailto links', () => {
  it('leaves plain mailto links untouched', () => {
    expect(localizeLink('mailto:alice@coves.social')).toBeUndefined()
  })

  it('leaves mailto links with dots and hyphens untouched', () => {
    expect(localizeLink('mailto:first.last@example.org')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// localizeLink() - community links
// ---------------------------------------------------------------------------

describe('localizeLink - community links', () => {
  it('rewrites community link without @ to /c/ path with instance appended', () => {
    const result = localizeLink('https://lemmy.world/c/technology')
    expect(result).toBe('/c/technology@lemmy.world')
  })

  it('rewrites community link with @ to /c/ path (no instance appended)', () => {
    const result = localizeLink('https://lemmy.world/c/tech@other.instance')
    expect(result).toBe('/c/tech@other.instance')
  })
})

// ---------------------------------------------------------------------------
// localizeLink() - non-matching links
// ---------------------------------------------------------------------------

describe('localizeLink - non-matching links', () => {
  it('returns undefined for a generic URL', () => {
    const result = localizeLink('https://example.com/some/page')
    expect(result).toBeUndefined()
  })

  it('returns undefined for an empty string', () => {
    const result = localizeLink('')
    expect(result).toBeUndefined()
  })

  it('returns undefined for a plain text string', () => {
    const result = localizeLink('not a url')
    expect(result).toBeUndefined()
  })

  it('returns undefined for a URL with unsupported path', () => {
    const result = localizeLink('https://lemmy.world/settings')
    expect(result).toBeUndefined()
  })

  it('returns undefined for an external post link (legacy route removed)', () => {
    const result = localizeLink('https://lemmy.world/post/12345')
    expect(result).toBeUndefined()
  })

  it('returns undefined for an external comment link (legacy route removed)', () => {
    const result = localizeLink('https://lemmy.world/comment/6789')
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// isSafeHref() - protocol allowlist for untrusted markdown link targets
//
// This is where scheme obfuscation is tested. Markdown will not tokenize a
// destination containing a raw tab, newline or NUL, so those variants cannot be
// exercised end-to-end through the document — ../security.test.ts documents
// that split and covers the schemes that do survive tokenization. Here the URL
// parser's normalization is the thing under test, and these strings are exactly
// what a regex blocklist would miss.
// ---------------------------------------------------------------------------

describe('isSafeHref', () => {
  it('rejects javascript: URLs', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false)
  })

  it('rejects javascript: with an embedded tab (parser strips it)', () => {
    // The exact bypass this defends against: the URL parser normalizes
    // "java\tscript:" back to "javascript:", which regex blocklists miss.
    expect(isSafeHref('java\tscript:alert(1)')).toBe(false)
  })

  it('rejects javascript: with an embedded newline (parser strips it)', () => {
    expect(isSafeHref('java\nscript:alert(1)')).toBe(false)
  })

  it('rejects mixed-case javascript: URLs', () => {
    expect(isSafeHref('JaVaScRiPt:alert(1)')).toBe(false)
  })

  it('rejects fully uppercase JAVASCRIPT: URLs', () => {
    expect(isSafeHref('JAVASCRIPT:alert(1)')).toBe(false)
  })

  it('rejects javascript: behind a NUL byte (parser strips it)', () => {
    expect(isSafeHref('\x00javascript:alert(1)')).toBe(false)
  })

  it('rejects javascript: behind leading whitespace', () => {
    expect(isSafeHref('   javascript:alert(1)')).toBe(false)
  })

  it('rejects file: URLs', () => {
    expect(isSafeHref('file:///etc/passwd')).toBe(false)
  })

  it('rejects blob: URLs', () => {
    expect(isSafeHref('blob:https://x.test/abc')).toBe(false)
  })

  it('rejects a data: URL disguised with an image extension', () => {
    // isImage() substring-matches the ".png" in the fragment, which is what
    // routed this to <img src> before MdImage consulted isSafeHref.
    expect(isSafeHref('data:text/html;base64,PHN2Zz48L3N2Zz4=#.png')).toBe(
      false,
    )
  })

  it('rejects a data: URL disguised with a video extension', () => {
    expect(isSafeHref('data:text/html;base64,PHN2Zz48L3N2Zz4=#.mp4')).toBe(
      false,
    )
  })

  it('rejects data: URLs', () => {
    expect(isSafeHref('data:text/html,x')).toBe(false)
  })

  it('rejects vbscript: URLs', () => {
    expect(isSafeHref('vbscript:x')).toBe(false)
  })

  it('accepts https: URLs', () => {
    expect(isSafeHref('https://example.com')).toBe(true)
  })

  it('accepts http: URLs', () => {
    expect(isSafeHref('http://example.com')).toBe(true)
  })

  it('accepts mailto: URLs', () => {
    expect(isSafeHref('mailto:a@b.c')).toBe(true)
  })

  it('accepts relative paths (resolved against the base)', () => {
    expect(isSafeHref('/c/technology')).toBe(true)
  })

  it('accepts fragment-only links', () => {
    expect(isSafeHref('#section')).toBe(true)
  })

  it('accepts query-only links', () => {
    expect(isSafeHref('?query=1')).toBe(true)
  })

  it('accepts protocol-relative URLs (intentional: resolves to https:)', () => {
    // "//evil.example" resolves against the https: base, so its protocol is
    // https: — an ordinary external link, safe to render as an anchor.
    expect(isSafeHref('//evil.example')).toBe(true)
  })

  it('rejects the empty string', () => {
    expect(isSafeHref('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// CONTENT_REGEXES - verify exported patterns
// ---------------------------------------------------------------------------

describe('CONTENT_REGEXES', () => {
  it('exports user regex', () => {
    expect(CONTENT_REGEXES.user).toBeInstanceOf(RegExp)
    expect(CONTENT_REGEXES.user.test('https://lemmy.world/u/alice')).toBe(true)
  })

  it('exports community regex', () => {
    expect(CONTENT_REGEXES.community).toBeInstanceOf(RegExp)
    expect(CONTENT_REGEXES.community.test('https://lemmy.world/c/tech')).toBe(
      true,
    )
  })
})

// ---------------------------------------------------------------------------
// linkify - characterization
//
// Pins observed behavior. Written as the net for the JS -> TS port and kept as
// the regression net for it. Every case builds its own Marked instance, so
// applying the extension never mutates the global marked singleton that
// Markdown.svelte configures. gfm defaults to true to match
// Markdown.svelte's marked.setOptions({ gfm: true, breaks: false }).
// ---------------------------------------------------------------------------

interface InlineToken {
  type: string
  raw: string
  href?: string
  text?: string
}

const inlineTokens = (src: string, gfm = true): InlineToken[] => {
  const marked = new Marked()
  marked.setOptions({ gfm, breaks: false })
  marked.use(linkify)
  const blocks = marked.lexer(src) as unknown as {
    tokens?: InlineToken[]
  }[]
  return blocks[0]?.tokens ?? []
}

/** Flattened [type, href-or-raw] pairs, the shape these assertions read best in. */
const shapeOf = (src: string, gfm = true): [string, string][] =>
  inlineTokens(src, gfm).map((token) => [token.type, token.href ?? token.raw])

describe('linkify - community and user mentions', () => {
  it('rewrites !community@instance to a /c/ link', () => {
    expect(shapeOf('!tech@lemmy.world')).toEqual([
      ['link', '/c/tech@lemmy.world'],
    ])
  })

  it('rewrites @user@instance to a /profile/ link', () => {
    expect(shapeOf('@alice@lemmy.world')).toEqual([
      ['link', '/profile/alice@lemmy.world'],
    ])
  })

  it('rewrites a mention in the middle of a sentence', () => {
    expect(shapeOf('see !tech@lemmy.world here')).toEqual([
      ['text', 'see '],
      ['link', '/c/tech@lemmy.world'],
      ['text', ' here'],
    ])
  })

  it('keeps the original mention as the link text', () => {
    const [link] = inlineTokens('!tech@lemmy.world')
    expect(link?.text).toBe('!tech@lemmy.world')
  })
})

// ---------------------------------------------------------------------------
// linkify - the "@@mention is invalid" guard
//
// The guard fires, and it misfires. linkify-it calls validate() while
// pre-scanning longer slices, so `pos` is frequently greater than 1. `tail` is
// text.slice(pos), so tail[pos - 2] can point PAST the end of the mention, and
// the '@' handler compares whatever is there against '!' (a copy-paste from
// the '!' handler). A literal '!' at that offset makes validate() return false
// and the mention silently degrades to marked's GFM mailto: autolink — see the
// position regression section below.
//
// Meanwhile the doubled prefixes the guard was written to reject are not
// rejected at all. These two tests pin that observable behavior.
// ---------------------------------------------------------------------------

describe('linkify - doubled prefixes are not rejected', () => {
  it('still links the inner mention of !!community@instance', () => {
    expect(shapeOf('!!tech@lemmy.world')).toEqual([
      ['text', '!'],
      ['link', '/c/tech@lemmy.world'],
    ])
  })

  it('still links the inner mention of @@user@instance', () => {
    expect(shapeOf('@@alice@lemmy.world')).toEqual([
      ['text', '@'],
      ['link', '/profile/alice@lemmy.world'],
    ])
  })
})

// ---------------------------------------------------------------------------
// linkify - a mention's target must not depend on where it sits in the line
//
// REGRESSION. A user mention has to resolve to /profile/ no matter how much
// text precedes it or whether punctuation follows. Today it does not: when the
// preceding text is exactly (mention body length + 2) characters and a '!'
// follows the mention, the misfiring guard above rejects it and marked's GFM
// autolinker turns it into a mailto: link instead. To an author this looks like
// a mention that works in one sentence and breaks in the next.
// ---------------------------------------------------------------------------

interface Mention {
  readonly body: string
  readonly href: string
}

const MENTIONS: readonly Mention[] = [
  { body: 'alice@lemmy.world', href: '/profile/alice@lemmy.world' },
  { body: 'bob@x.test', href: '/profile/bob@x.test' },
  { body: 'carol@a.b.test', href: '/profile/carol@a.b.test' },
]

const COMMUNITIES: readonly Mention[] = [
  { body: 'tech@lemmy.world', href: '/c/tech@lemmy.world' },
  { body: 'ask@x.test', href: '/c/ask@x.test' },
]

const linkHrefs = (src: string): string[] =>
  inlineTokens(src)
    .filter((token) => token.type === 'link')
    .map((token) => token.href ?? '')

/** Filler of exactly `length` characters, ending on a word boundary. */
const prefixOf = (length: number): string =>
  length === 0 ? '' : `${'x'.repeat(length - 1)} `

describe('linkify - mention position must not change the target', () => {
  const offsets = [0, 1, 2, 5, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 25]

  for (const { body, href } of MENTIONS) {
    it.each(offsets)(
      `resolves @${body} followed by "!" after a %i-character prefix`,
      (length: number) => {
        const src = `${prefixOf(length)}@${body}!`
        expect(linkHrefs(src)).toContain(href)
      },
    )

    it.each(offsets)(
      `resolves @${body} with no trailing punctuation after a %i-character prefix`,
      (length: number) => {
        expect(linkHrefs(`${prefixOf(length)}@${body}`)).toContain(href)
      },
    )
  }

  // The '!' community handler carries the same mis-indexed comparison, so it is
  // held to the same contract. It has no observed breakage today — a sweep of
  // prefix lengths 0-30 found none — which is exactly why it needs pinning: a
  // fix aimed at the '@' handler must not push the bug over here.
  for (const { body, href } of COMMUNITIES) {
    it.each(offsets)(
      `resolves !${body} followed by "!" after a %i-character prefix`,
      (length: number) => {
        expect(linkHrefs(`${prefixOf(length)}!${body}!`)).toContain(href)
      },
    )

    it.each(offsets)(
      `resolves !${body} with no trailing punctuation after a %i-character prefix`,
      (length: number) => {
        expect(linkHrefs(`${prefixOf(length)}!${body}`)).toContain(href)
      },
    )
  }

  // The three strings that surfaced this, kept verbatim: only the length of the
  // leading text differs between the broken and working cases.
  it('resolves a mention in ordinary prose ending with "!"', () => {
    expect(linkHrefs('thanks thanks abcd @alice@lemmy.world!')).toContain(
      '/profile/alice@lemmy.world',
    )
  })

  it('resolves the same prose without the trailing "!"', () => {
    expect(linkHrefs('thanks thanks abcd @alice@lemmy.world')).toContain(
      '/profile/alice@lemmy.world',
    )
  })

  it('resolves the same prose one character longer', () => {
    expect(linkHrefs('thanks thanks abcde @alice@lemmy.world!')).toContain(
      '/profile/alice@lemmy.world',
    )
  })

  it('never degrades a mention to a mailto: link', () => {
    const degraded: string[] = []
    for (const { body } of MENTIONS) {
      for (const length of offsets) {
        for (const suffix of ['!', '! and more', '', '.']) {
          const src = `${prefixOf(length)}@${body}${suffix}`
          if (linkHrefs(src).some((href) => href.startsWith('mailto:'))) {
            degraded.push(JSON.stringify(src))
          }
        }
      }
    }
    expect(degraded).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// linkify - the c/ and u/ prefix stripping in normalize()
//
// normalize() strips a leading "c/" or "u/", but validate() runs first and its
// pattern (/^([a-z0-9_.-]+)@.../) has no "/", so "!c/tech@..." never validates
// as a community. The stripping branches are unreachable in practice; what
// actually happens is that the bare email tail is autolinked instead.
// ---------------------------------------------------------------------------

describe('linkify - c/ and u/ prefixes are not matched', () => {
  it('does not produce a /c/ link for !c/community@instance', () => {
    expect(shapeOf('!c/tech@lemmy.world')).toEqual([
      ['text', '!c/'],
      ['link', 'mailto:tech@lemmy.world'],
    ])
  })

  it('does not produce a /profile/ link for @u/user@instance', () => {
    expect(shapeOf('@u/alice@lemmy.world')).toEqual([
      ['text', '@u/'],
      ['link', 'mailto:alice@lemmy.world'],
    ])
  })
})

// ---------------------------------------------------------------------------
// linkify - fuzzyEmail and plain URLs
// ---------------------------------------------------------------------------

describe('linkify - fuzzyEmail', () => {
  it('declines to autolink a bare email (fuzzyEmail: false)', () => {
    // With gfm off, linkify is the only autolinker in play, and it leaves the
    // address alone — which is what fuzzyEmail: false buys.
    expect(shapeOf('alice@example.com', false)).toEqual([
      ['text', 'alice@example.com'],
    ])
  })

  it("is overridden by marked's own GFM autolinker under gfm: true", () => {
    // Markdown.svelte sets gfm: true, so bare emails DO become mailto: links
    // in the real app. fuzzyEmail: false does not prevent that.
    expect(shapeOf('alice@example.com', true)).toEqual([
      ['link', 'mailto:alice@example.com'],
    ])
  })

  it('still autolinks bare http(s) URLs', () => {
    expect(shapeOf('visit https://ok.test/x now', false)).toEqual([
      ['text', 'visit '],
      ['link', 'https://ok.test/x'],
      ['text', ' now'],
    ])
  })
})

// ---------------------------------------------------------------------------
// subSupscriptExtension - characterization
// ---------------------------------------------------------------------------

interface SubSupParams {
  type: string
  content: string
  raw: string
  lexer: unknown
}

interface SubSupToken {
  type: string
  raw: string
  text: string
}

interface LexerLike {
  blockTokens(src: string, tokens: unknown[]): unknown
}

const subSup = subSupscriptExtension(
  (params: SubSupParams): SubSupToken => ({
    type: params.type,
    raw: params.raw,
    text: params.content,
  }),
)

const tokenize = (src: string): SubSupToken | undefined => {
  const lexer: LexerLike = { blockTokens: () => [] }
  const tokenizer = subSup.tokenizer as unknown as (
    this: { lexer: LexerLike },
    src: string,
  ) => SubSupToken | undefined
  return tokenizer.call({ lexer }, src)
}

const startOf = (src: string): number | undefined => {
  const start = subSup.start as unknown as (src: string) => number | undefined
  return start(src)
}

describe('subSupscriptExtension - extension shape', () => {
  it('registers as an inline extension named "subscriptSuperscript"', () => {
    expect(subSup.name).toBe('subscriptSuperscript')
    expect(subSup.level).toBe('inline')
  })
})

describe('subSupscriptExtension - start()', () => {
  it('returns the offset of the first ~ or ^', () => {
    expect(startOf('~sub~')).toBe(0)
    expect(startOf('x~y~')).toBe(1)
  })

  it('returns undefined when neither delimiter appears', () => {
    expect(startOf('plain text')).toBeUndefined()
  })
})

describe('subSupscriptExtension - subscript', () => {
  it('tokenizes ~sub~ into a subscript carrying the inner content', () => {
    expect(tokenize('~sub~')).toEqual({
      type: 'subscript',
      raw: '~sub~',
      text: 'sub',
    })
  })

  it('accepts single-character content', () => {
    expect(tokenize('~a~')).toEqual({
      type: 'subscript',
      raw: '~a~',
      text: 'a',
    })
  })

  it('accepts internal whitespace', () => {
    expect(tokenize('~a b~')).toEqual({
      type: 'subscript',
      raw: '~a b~',
      text: 'a b',
    })
  })

  it('consumes only up to the first closing delimiter', () => {
    expect(tokenize('~a~b~')).toEqual({
      type: 'subscript',
      raw: '~a~',
      text: 'a',
    })
  })

  it('rejects leading whitespace inside the delimiters', () => {
    expect(tokenize('~ x~')).toBeUndefined()
  })

  it('rejects trailing whitespace inside the delimiters', () => {
    expect(tokenize('~x ~')).toBeUndefined()
  })

  it('rejects empty content', () => {
    expect(tokenize('~~')).toBeUndefined()
  })
})

describe('subSupscriptExtension - superscript', () => {
  it('tokenizes ^sup^ into a superscript carrying the inner content', () => {
    expect(tokenize('^sup^')).toEqual({
      type: 'superscript',
      raw: '^sup^',
      text: 'sup',
    })
  })

  it('accepts single-character content', () => {
    expect(tokenize('^a^')).toEqual({
      type: 'superscript',
      raw: '^a^',
      text: 'a',
    })
  })

  it('rejects leading whitespace inside the delimiters', () => {
    expect(tokenize('^ x^')).toBeUndefined()
  })

  it('rejects trailing whitespace inside the delimiters', () => {
    expect(tokenize('^x ^')).toBeUndefined()
  })

  it('rejects empty content', () => {
    expect(tokenize('^^')).toBeUndefined()
  })
})

describe('subSupscriptExtension - non-matching input', () => {
  it('returns undefined for text with no delimiters', () => {
    expect(tokenize('plain text')).toBeUndefined()
  })

  it('returns undefined when the delimiter is not at position 0', () => {
    // Both rules are anchored with ^, so the extension never consumes from the
    // middle of the source — marked advances via start() instead.
    expect(tokenize('x~y~')).toBeUndefined()
  })

  it('returns undefined for an unclosed delimiter', () => {
    expect(tokenize('~unclosed')).toBeUndefined()
  })
})
