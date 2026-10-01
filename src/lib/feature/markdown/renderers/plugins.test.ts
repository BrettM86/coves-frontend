import { describe, it, expect, vi } from 'vitest'
import { Marked } from 'marked'
import {
  localizeLink,
  isSafeHref,
  CONTENT_REGEXES,
  linkify,
  subSupscriptExtension,
} from './plugins'
import { match as matchCommunityParam } from '../../../../params/handle'
import { match as matchActorParam } from '../../../../params/actor'

// Pin public env: single-argument localizeLink calls default to the origin of
// PUBLIC_INSTANCE_URL, so an ambient value would make these tests depend on it.
vi.mock('$env/dynamic/public', () => ({ env: {} }))

// ---------------------------------------------------------------------------
// localizeLink() - user links are left unlocalized
//
// `/profile/[handle=actor]` accepts only a DID or a DNS handle
// (src/params/actor.ts). A Lemmy user's `name@instance` is neither, so a
// localized path would 404; the link keeps its external href instead. A dotted
// name is not mapped either: a remote Lemmy user name must never open an
// unrelated atproto account that happens to own that handle.
// ---------------------------------------------------------------------------

describe('localizeLink - user links', () => {
  it('leaves a user link with @ unlocalized (name@instance is not a routable profile identifier)', () => {
    const result = localizeLink('https://lemmy.world/u/alice@instance.com')
    expect(result).toBeUndefined()
  })

  it('leaves a user link without @ unlocalized (name@instance is not a routable profile identifier)', () => {
    const result = localizeLink('https://lemmy.world/u/alice')
    expect(result).toBeUndefined()
  })

  it('leaves a user link with dots in the username unlocalized (not a routable profile identifier)', () => {
    const result = localizeLink('https://example.com/u/user.name')
    expect(result).toBeUndefined()
  })

  it('leaves a user link with underscores in the username unlocalized (not a routable profile identifier)', () => {
    const result = localizeLink('https://example.com/u/my_user')
    expect(result).toBeUndefined()
  })

  it('leaves a user link with hyphens in the username unlocalized (not a routable profile identifier)', () => {
    const result = localizeLink('https://lemmy.world/u/my-user')
    expect(result).toBeUndefined()
  })

  it('leaves a user link with @ and hyphens in username and instance unlocalized (not a routable profile identifier)', () => {
    const result = localizeLink(
      'https://lemmy.world/u/my-user@other-instance.org',
    )
    expect(result).toBeUndefined()
  })

  it('does not map a dotted Lemmy user name to an atproto profile of the same handle', () => {
    const result = localizeLink('https://lemmy.world/u/alice.example.com')
    expect(result).toBeUndefined()
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

  it('handles community link with hyphens in name', () => {
    const result = localizeLink('https://lemmy.world/c/my-community')
    expect(result).toBe('/c/my-community@lemmy.world')
  })

  it('handles community link with @ and hyphens in name and instance', () => {
    const result = localizeLink(
      'https://lemmy.world/c/my-community@other-instance.org',
    )
    expect(result).toBe('/c/my-community@other-instance.org')
  })

  it('leaves a hyphenated legacy DNS-handle community link unlocalized (handle@instance does not route)', () => {
    const result = localizeLink(
      'https://coves.social/c/retro-gaming.coves.social',
    )
    expect(result).toBeUndefined()
  })

  it('leaves a community link with an underscore in its name unlocalized (not a valid community name)', () => {
    const result = localizeLink('https://lemmy.world/c/my_community')
    expect(result).toBeUndefined()
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
// localizeLink() - own-instance profile links
//
// The second argument is the configured instance origin (scheme://host[:port])
// or null when none is configured. A `/profile/<id>` or `/u/<id>` link whose
// origin is exactly that origin opens the in-app profile. Anything else — a
// different or lookalike host, another scheme or port, or a path that is not
// exactly one identifier segment — keeps its external href.
// ---------------------------------------------------------------------------

const OWN_ORIGIN = 'https://coves.example'

/** Links that must stay external when the origin is OWN_ORIGIN. */
const OWN_INSTANCE_EXTERNAL_LINKS = [
  // another host
  'https://lemmy.world/u/alice.bsky.social',
  'https://lemmy.world/profile/alice.bsky.social',
  // lookalike hosts
  'https://coves.example.evil.com/profile/alice.bsky.social',
  'https://evilcoves.example/profile/alice.bsky.social',
  'https://www.coves.example/profile/alice.bsky.social',
  'https://coves.example@evil.com/profile/alice.bsky.social',
  // scheme and port mismatch
  'http://coves.example/profile/alice.bsky.social',
  'https://coves.example:8443/profile/alice.bsky.social',
  // path prefix is case-sensitive
  'https://coves.example/PROFILE/alice.bsky.social',
  'https://coves.example/U/alice.bsky.social',
  // path is not exactly one identifier segment
  'https://coves.example/profile/alice.bsky.social/',
  'https://coves.example/u/alice.bsky.social/',
  'https://coves.example/profile/alice.bsky.social/posts',
  'https://coves.example/profile/alice.bsky.social?tab=x',
  'https://coves.example/profile/alice.bsky.social?',
  'https://coves.example/profile/alice.bsky.social#frag',
  'https://coves.example/profile/alice.bsky.social#',
  'https://coves.example/u/../profile/alice.bsky.social',
  'https://coves.example\\profile\\alice.bsky.social',
  'https://coves.example/profile\\alice.bsky.social',
  // other path prefixes
  'https://coves.example/user/alice.bsky.social',
  'https://coves.example/profiles/alice.bsky.social',
  // own-instance URL embedded in another URL's path or query
  'https://web.archive.org/web/2026/https://coves.example/profile/alice.bsky.social',
  'https://evil.test/?next=https://coves.example/profile/alice.bsky.social',
]

/** DID profile links on OWN_ORIGIN and the in-app path each opens. */
const OWN_INSTANCE_DID_LINKS = [
  {
    link: 'https://coves.example/profile/did:plc:abc123',
    expected: '/profile/did:plc:abc123',
  },
  {
    link: 'https://coves.example/u/did:web:example.com',
    expected: '/profile/did:web:example.com',
  },
  {
    link: 'https://coves.example/profile/did:plc:abc_123',
    expected: '/profile/did:plc:abc_123',
  },
]

/**
 * Profile ids that stay external even on OWN_ORIGIN: neither a DID nor a DNS
 * handle, or one the actor route would decode into something else.
 */
const UNROUTABLE_PROFILE_IDS = [
  'DID:PLC:ABC',
  'did:plc:',
  'did::abc',
  'did:plc:abc@lemmy.world',
  'alice.bsky.social:8080',
  'alice',
  'alice@lemmy.world',
  'alice_b.bsky.social',
  '.alice.bsky.social',
  'alice.bsky.social.',
  '-alice.bsky.social',
  // The actor route decodes %2F to '/', so this path would 404.
  'did:web:foo%2Fbar',
  // %2E decodes to '.', a routable handle, but the id class excludes '%'.
  'alice%2Ebsky.social',
]

/** Every printable ASCII punctuation character, `!` through `~`. */
const ASCII_PUNCTUATION = Array.from({ length: 0x7e - 0x21 + 1 }, (_, offset) =>
  String.fromCharCode(0x21 + offset),
).filter((char) => !/[a-zA-Z0-9]/.test(char))

/**
 * One raw (unencoded) punctuation character inside a handle's first label.
 * Only '-' and '.' belong in a handle.
 */
const HANDLE_PUNCTUATION_SWEEP = ASCII_PUNCTUATION.map((char) => {
  const id = 'ali' + char + 'ce.bsky.social'
  return {
    char,
    link: 'https://coves.example/profile/' + id,
    expected: char === '-' || char === '.' ? '/profile/' + id : undefined,
  }
})

/**
 * One raw (unencoded) punctuation character inside a DID's method-specific
 * identifier. Only '.', '-', '_' and ':' localize.
 */
const DID_PUNCTUATION_SWEEP = ASCII_PUNCTUATION.map((char) => {
  const id = 'did:plc:ab' + char + 'cd'
  return {
    char,
    link: 'https://coves.example/profile/' + id,
    expected: ['.', '-', '_', ':'].includes(char)
      ? '/profile/' + id
      : undefined,
  }
})

describe('localizeLink - own-instance profile links', () => {
  it.each([
    {
      name: 'a /profile/<handle> link',
      link: 'https://coves.example/profile/alice.bsky.social',
    },
    {
      name: 'a /u/<handle> link',
      link: 'https://coves.example/u/alice.bsky.social',
    },
    {
      name: 'a mixed-case host',
      link: 'https://COVES.Example/profile/alice.bsky.social',
    },
    {
      name: 'an explicit default https port',
      link: 'https://coves.example:443/profile/alice.bsky.social',
    },
  ])('localizes $name on the configured origin', ({ link }) => {
    expect(localizeLink(link, OWN_ORIGIN)).toBe('/profile/alice.bsky.social')
  })

  it('localizes a hyphenated handle on the configured origin', () => {
    expect(
      localizeLink(
        'https://coves.example/profile/my-name.bsky.social',
        OWN_ORIGIN,
      ),
    ).toBe('/profile/my-name.bsky.social')
  })

  it('localizes a link on a local-dev origin with a port', () => {
    expect(
      localizeLink(
        'http://127.0.0.1:8080/profile/alice.bsky.social',
        'http://127.0.0.1:8080',
      ),
    ).toBe('/profile/alice.bsky.social')
  })

  it('leaves a link on the local-dev host but another port external', () => {
    expect(
      localizeLink(
        'http://127.0.0.1:9999/profile/alice.bsky.social',
        'http://127.0.0.1:8080',
      ),
    ).toBeUndefined()
  })

  it('localizes a link with an explicit default http port on an origin without one', () => {
    expect(
      localizeLink(
        'http://localhost:80/u/alice.bsky.social',
        'http://localhost',
      ),
    ).toBe('/profile/alice.bsky.social')
  })

  it.each(OWN_INSTANCE_EXTERNAL_LINKS)('leaves %s external', (link) => {
    expect(localizeLink(link, OWN_ORIGIN)).toBeUndefined()
  })

  it('leaves a link with an out-of-range port external without throwing', () => {
    const link = 'https://coves.example:99999/profile/alice.bsky.social'
    expect(() => localizeLink(link, OWN_ORIGIN)).not.toThrow()
    expect(localizeLink(link, OWN_ORIGIN)).toBeUndefined()
  })

  it('leaves a profile link external when no instance origin is configured', () => {
    expect(
      localizeLink('https://coves.example/profile/alice.bsky.social', null),
    ).toBeUndefined()
  })

  it.each([
    {
      link: 'https://coves.example/c/gaming',
      expected: '/c/gaming@coves.example',
    },
    {
      link: 'https://lemmy.world/c/my-community',
      expected: '/c/my-community@lemmy.world',
    },
  ])(
    'localizes community link $link the same as without an origin',
    ({ link, expected }) => {
      expect(localizeLink(link, OWN_ORIGIN)).toBe(expected)
    },
  )

  it.each(OWN_INSTANCE_DID_LINKS)(
    'localizes a DID link to $expected on the configured origin',
    ({ link, expected }) => {
      expect(localizeLink(link, OWN_ORIGIN)).toBe(expected)
    },
  )

  it.each(UNROUTABLE_PROFILE_IDS)(
    'leaves a profile link with id %s external',
    (id) => {
      expect(
        localizeLink('https://coves.example/profile/' + id, OWN_ORIGIN),
      ).toBeUndefined()
    },
  )

  it('leaves a link with an out-of-range port external without throwing when no origin is configured', () => {
    const link = 'https://coves.example:99999/profile/alice.bsky.social'
    expect(() => localizeLink(link, null)).not.toThrow()
    expect(localizeLink(link, null)).toBeUndefined()
  })

  it.each(HANDLE_PUNCTUATION_SWEEP)(
    'handle with $char in its first label gives $expected',
    ({ link, expected }) => {
      expect(localizeLink(link, OWN_ORIGIN)).toBe(expected)
    },
  )

  it.each(DID_PUNCTUATION_SWEEP)(
    'DID with $char in its identifier gives $expected',
    ({ link, expected }) => {
      expect(localizeLink(link, OWN_ORIGIN)).toBe(expected)
    },
  )
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
    // The pathname genuinely ends in ".png", so isImage() classifies it as an
    // image wherever media is still rendered from a URL (post embeds); the
    // scheme check here is what stops it.
    expect(isSafeHref('data:text/html;charset=utf-8,x.png')).toBe(false)
  })

  it('rejects a data: URL disguised with a video extension', () => {
    expect(isSafeHref('data:text/html;charset=utf-8,x.mp4')).toBe(false)
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

  it('user regex matches a hyphenated username', () => {
    expect(CONTENT_REGEXES.user.test('https://lemmy.world/u/my-user')).toBe(
      true,
    )
  })

  it('community regex matches a hyphenated community name', () => {
    expect(
      CONTENT_REGEXES.community.test('https://lemmy.world/c/my-community'),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// CONTENT_REGEXES / localizeLink() - the name segment rejects stray punctuation
//
// REGRESSION. The name segment was once written `[a-zA-Z0-9.-_]`, where `.-_`
// is a character range (0x2E..0x5F), not three literals. Besides dropping the
// hyphen, that range admitted `/ : ; < = > ? [ \ ] ^`, none of which belong in
// a user or community name. A doubled slash let another host ride along in the
// path: https://evil.test/c//attacker.example/pwn localized to the junk path
// /c//attacker.example/pwn@evil.test. `@`, `.`, `_` and `-` are legitimate
// name characters and are covered by the tests above.
// ---------------------------------------------------------------------------

type ContentKind = keyof typeof CONTENT_REGEXES

const STRAY_PUNCTUATION = [
  '/',
  ':',
  ';',
  '<',
  '=',
  '>',
  '?',
  '[',
  '\\',
  ']',
  '^',
] as const

const namesWithStrayPunctuation: {
  kind: ContentKind
  character: string
  link: string
}[] = STRAY_PUNCTUATION.flatMap((character) => [
  {
    kind: 'community' as const,
    character,
    link: `https://lemmy.world/c/tech${character}x`,
  },
  {
    kind: 'user' as const,
    character,
    link: `https://lemmy.world/u/alice${character}x`,
  },
])

describe('CONTENT_REGEXES - name segment rejects stray punctuation', () => {
  it('does not localize a community link whose name smuggles another host', () => {
    const link = 'https://evil.test/c//attacker.example/pwn'
    expect(localizeLink(link)).toBeUndefined()
    expect(CONTENT_REGEXES.community.test(link)).toBe(false)
  })

  it('does not localize a user link whose name smuggles another host', () => {
    const link = 'https://evil.test/u//attacker.example/pwn'
    expect(localizeLink(link)).toBeUndefined()
    expect(CONTENT_REGEXES.user.test(link)).toBe(false)
  })

  it.each(namesWithStrayPunctuation)(
    'rejects "$character" in a $kind name ($link)',
    ({ kind, link }) => {
      expect(localizeLink(link)).toBeUndefined()
      expect(CONTENT_REGEXES[kind].test(link)).toBe(false)
    },
  )
})

// ---------------------------------------------------------------------------
// localizeLink() - every localized path lands on a route that accepts it
//
// MdLink swaps the external href for whatever localizeLink returns, so a path
// the route's param matcher rejects is a dead link that replaced a working
// one. `/c/[handle]` uses src/params/handle.ts and `/profile/[handle=actor]`
// uses src/params/actor.ts. The corpus is every link the localizeLink tests in
// this file use, plus an unhyphenated legacy DNS-handle community link.
// ---------------------------------------------------------------------------

const LOCALIZE_LINK_CORPUS = [
  // user links
  'https://lemmy.world/u/alice@instance.com',
  'https://lemmy.world/u/alice',
  'https://example.com/u/user.name',
  'https://example.com/u/my_user',
  'https://lemmy.world/u/my-user',
  'https://lemmy.world/u/my-user@other-instance.org',
  'https://lemmy.world/u/alice.example.com',
  // community links
  'https://lemmy.world/c/technology',
  'https://lemmy.world/c/tech@other.instance',
  'https://lemmy.world/c/my-community',
  'https://lemmy.world/c/my-community@other-instance.org',
  'https://lemmy.world/c/my_community',
  'https://coves.social/c/retro-gaming.coves.social',
  'https://coves.social/c/gaming.coves.social',
  // mailto and non-matching links
  'mailto:alice@coves.social',
  'mailto:first.last@example.org',
  'https://example.com/some/page',
  '',
  'not a url',
  'https://lemmy.world/settings',
  'https://lemmy.world/post/12345',
  'https://lemmy.world/comment/6789',
  // names with stray punctuation
  'https://evil.test/c//attacker.example/pwn',
  'https://evil.test/u//attacker.example/pwn',
  ...namesWithStrayPunctuation.map(({ link }) => link),
]

/** Whether the route a localized path lands on accepts its identifier segment. */
const isRoutablePath = (path: string): boolean => {
  if (path.startsWith('/c/')) {
    return matchCommunityParam(path.slice('/c/'.length))
  }
  if (path.startsWith('/profile/')) {
    return matchActorParam(path.slice('/profile/'.length))
  }
  return false
}

describe('localizeLink - every localized path is routable', () => {
  it('never returns a path its route param matcher rejects', () => {
    const unroutable = LOCALIZE_LINK_CORPUS.map((link) => ({
      link,
      path: localizeLink(link),
    })).filter(({ path }) => path !== undefined && !isRoutablePath(path))
    expect(unroutable).toEqual([])
  })

  it('localizes at least one community link, so the invariant is not vacuous', () => {
    const paths = LOCALIZE_LINK_CORPUS.map((link) => localizeLink(link))
    expect(paths.some((path) => path?.startsWith('/c/'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// localizeLink() - every localized own-instance path is routable
//
// The same invariant with the instance origin passed. The corpus is every
// own-instance case above: handles, DIDs, both punctuation sweeps, and the
// links and ids that stay external.
// ---------------------------------------------------------------------------

const OWN_INSTANCE_CORPUS: { link: string; origin: string | null }[] = [
  {
    link: 'https://coves.example/profile/alice.bsky.social',
    origin: OWN_ORIGIN,
  },
  { link: 'https://coves.example/u/alice.bsky.social', origin: OWN_ORIGIN },
  {
    link: 'https://COVES.Example/profile/alice.bsky.social',
    origin: OWN_ORIGIN,
  },
  {
    link: 'https://coves.example:443/profile/alice.bsky.social',
    origin: OWN_ORIGIN,
  },
  {
    link: 'https://coves.example/profile/my-name.bsky.social',
    origin: OWN_ORIGIN,
  },
  {
    link: 'http://127.0.0.1:8080/profile/alice.bsky.social',
    origin: 'http://127.0.0.1:8080',
  },
  {
    link: 'http://127.0.0.1:9999/profile/alice.bsky.social',
    origin: 'http://127.0.0.1:8080',
  },
  {
    link: 'http://localhost:80/u/alice.bsky.social',
    origin: 'http://localhost',
  },
  {
    link: 'https://coves.example:99999/profile/alice.bsky.social',
    origin: OWN_ORIGIN,
  },
  {
    link: 'https://coves.example:99999/profile/alice.bsky.social',
    origin: null,
  },
  { link: 'https://coves.example/profile/alice.bsky.social', origin: null },
  ...OWN_INSTANCE_DID_LINKS.map(({ link }) => ({ link, origin: OWN_ORIGIN })),
  ...OWN_INSTANCE_EXTERNAL_LINKS.map((link) => ({ link, origin: OWN_ORIGIN })),
  ...UNROUTABLE_PROFILE_IDS.map((id) => ({
    link: 'https://coves.example/profile/' + id,
    origin: OWN_ORIGIN,
  })),
  ...HANDLE_PUNCTUATION_SWEEP.map(({ link }) => ({ link, origin: OWN_ORIGIN })),
  ...DID_PUNCTUATION_SWEEP.map(({ link }) => ({ link, origin: OWN_ORIGIN })),
]

/** isRoutablePath, where a segment the matcher cannot decode does not route. */
const routesWithoutThrowing = (path: string): boolean => {
  try {
    return isRoutablePath(path)
  } catch {
    return false
  }
}

const ownInstancePaths = (): (string | undefined)[] =>
  OWN_INSTANCE_CORPUS.map(({ link, origin }) => localizeLink(link, origin))

describe('localizeLink - every localized own-instance path is routable', () => {
  it('never returns a path its route param matcher rejects', () => {
    const unroutable = OWN_INSTANCE_CORPUS.map(({ link, origin }) => ({
      link,
      origin,
      path: localizeLink(link, origin),
    })).filter(({ path }) => path !== undefined && !routesWithoutThrowing(path))
    expect(unroutable).toEqual([])
  })

  it('localizes at least one handle link, so the invariant is not vacuous', () => {
    const handlePaths = ownInstancePaths().filter(
      (path) =>
        path?.startsWith('/profile/') && !path.startsWith('/profile/did:'),
    )
    expect(handlePaths).not.toEqual([])
  })

  it('localizes at least one DID link, so the invariant is not vacuous', () => {
    const didPaths = ownInstancePaths().filter((path) =>
      path?.startsWith('/profile/did:'),
    )
    expect(didPaths).not.toEqual([])
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

const subSup = subSupscriptExtension((params: SubSupParams): SubSupToken => ({
  type: params.type,
  raw: params.raw,
  text: params.content,
}))

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
