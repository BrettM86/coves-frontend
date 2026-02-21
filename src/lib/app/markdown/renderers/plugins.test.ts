import { describe, it, expect } from 'vitest'
import { photonify, CONTENT_REGEXES } from './plugins'

// ---------------------------------------------------------------------------
// photonify() - user links
// ---------------------------------------------------------------------------

describe('photonify - user links', () => {
  it('rewrites user link with @ to /profile/ path (no instance appended)', () => {
    const result = photonify('https://lemmy.world/u/alice@instance.com')
    expect(result).toBe('/profile/alice@instance.com')
  })

  it('rewrites user link without @ to /profile/ path with instance appended', () => {
    const result = photonify('https://lemmy.world/u/alice')
    expect(result).toBe('/profile/alice@lemmy.world')
  })

  it('handles user link with dots in username', () => {
    const result = photonify('https://example.com/u/user.name')
    expect(result).toBe('/profile/user.name@example.com')
  })

  it('handles user link with underscores in username', () => {
    const result = photonify('https://example.com/u/my_user')
    expect(result).toBe('/profile/my_user@example.com')
  })
})

// ---------------------------------------------------------------------------
// photonify() - implicit user links (mailto)
// ---------------------------------------------------------------------------

describe('photonify - implicit user links (mailto)', () => {
  it('rewrites mailto link to /profile/ path', () => {
    const result = photonify('mailto:alice@coves.social')
    expect(result).toBe('/profile/alice@coves.social')
  })

  it('rewrites mailto link with subdomain instance', () => {
    const result = photonify('mailto:bob@lemmy.world')
    expect(result).toBe('/profile/bob@lemmy.world')
  })

  it('handles username with dots and hyphens', () => {
    const result = photonify('mailto:first.last@example.org')
    expect(result).toBe('/profile/first.last@example.org')
  })
})

// ---------------------------------------------------------------------------
// photonify() - community links
// ---------------------------------------------------------------------------

describe('photonify - community links', () => {
  it('rewrites community link without @ to /c/ path with instance appended', () => {
    const result = photonify('https://lemmy.world/c/technology')
    expect(result).toBe('/c/technology@lemmy.world')
  })

  it('rewrites community link with @ to /c/ path (no instance appended)', () => {
    const result = photonify('https://lemmy.world/c/tech@other.instance')
    expect(result).toBe('/c/tech@other.instance')
  })
})

// ---------------------------------------------------------------------------
// photonify() - post links
// ---------------------------------------------------------------------------

describe('photonify - post links', () => {
  it('rewrites post link to /post/{instance}/{id} path', () => {
    const result = photonify('https://lemmy.world/post/12345')
    expect(result).toBe('/post/lemmy.world/12345')
  })
})

// ---------------------------------------------------------------------------
// photonify() - comment links
// ---------------------------------------------------------------------------

describe('photonify - comment links', () => {
  it('rewrites comment link to /comment/{instance}/{id} path', () => {
    const result = photonify('https://lemmy.world/comment/6789')
    expect(result).toBe('/comment/lemmy.world/6789')
  })
})

// ---------------------------------------------------------------------------
// photonify() - non-matching links
// ---------------------------------------------------------------------------

describe('photonify - non-matching links', () => {
  it('returns undefined for a generic URL', () => {
    const result = photonify('https://example.com/some/page')
    expect(result).toBeUndefined()
  })

  it('returns undefined for an empty string', () => {
    const result = photonify('')
    expect(result).toBeUndefined()
  })

  it('returns undefined for a plain text string', () => {
    const result = photonify('not a url')
    expect(result).toBeUndefined()
  })

  it('returns undefined for a URL with unsupported path', () => {
    const result = photonify('https://lemmy.world/settings')
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// CONTENT_REGEXES - verify exported patterns
// ---------------------------------------------------------------------------

describe('CONTENT_REGEXES', () => {
  it('exports post regex', () => {
    expect(CONTENT_REGEXES.post).toBeInstanceOf(RegExp)
    expect(CONTENT_REGEXES.post.test('https://lemmy.world/post/123')).toBe(true)
  })

  it('exports comment regex', () => {
    expect(CONTENT_REGEXES.comment).toBeInstanceOf(RegExp)
    expect(
      CONTENT_REGEXES.comment.test('https://lemmy.world/comment/456'),
    ).toBe(true)
  })

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

  it('exports implicitUser regex', () => {
    expect(CONTENT_REGEXES.implicitUser).toBeInstanceOf(RegExp)
    expect(CONTENT_REGEXES.implicitUser.test('mailto:alice@coves.social')).toBe(
      true,
    )
  })
})
