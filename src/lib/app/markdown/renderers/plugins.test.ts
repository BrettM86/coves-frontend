import { describe, it, expect } from 'vitest'
import { localizeLink, CONTENT_REGEXES } from './plugins'

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
