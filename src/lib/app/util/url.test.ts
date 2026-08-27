import { describe, it, expect } from 'vitest'
import {
  canParseUrl,
  isImage,
  isVideo,
  isSafeHref,
  isWebUrl,
  parseWebUrl,
} from './url'

describe('isImage', () => {
  it('returns false for undefined', () => {
    expect(isImage(undefined)).toBe(false)
  })

  it('returns true for .jpg URL', () => {
    expect(isImage('https://example.com/photo.jpg')).toBe(true)
  })

  it('returns true for .png URL (case-insensitive)', () => {
    expect(isImage('https://example.com/PHOTO.PNG')).toBe(true)
  })

  it('returns false for .mp4 URL', () => {
    expect(isImage('https://example.com/video.mp4')).toBe(false)
  })

  it('returns false for URL without image extension', () => {
    expect(isImage('https://example.com/page')).toBe(false)
  })

  it('ignores an image extension in the query string', () => {
    expect(isImage('https://example.com/page?file=x.png')).toBe(false)
  })

  it('ignores an image extension in the fragment', () => {
    expect(isImage('https://example.com/page#.png')).toBe(false)
  })

  it('ignores an image extension in a non-final path segment', () => {
    expect(isImage('https://example.com/a.png/page')).toBe(false)
  })

  it('matches an uppercase extension', () => {
    expect(isImage('https://example.com/photo.JPG')).toBe(true)
  })

  it('still matches when a query string follows the extension', () => {
    expect(isImage('https://example.com/photo.png?v=1')).toBe(true)
    expect(isImage('https://example.com/photo.png#top')).toBe(true)
  })

  it('matches a site-relative image path', () => {
    expect(isImage('/uploads/photo.webp')).toBe(true)
  })

  it('returns false for a data: URL that only mentions .png in its fragment', () => {
    expect(isImage('data:text/html;base64,PHN2Zz4=#.png')).toBe(false)
  })

  it('returns false for unparseable input', () => {
    expect(isImage('http://')).toBe(false)
    expect(isImage('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isImage()/isVideo() classify, they do not validate
//
// These are not decorative. markdown/security.test.ts and
// markdown/renderers/MdImage.test.ts both build hostile corpora out of
// data:/javascript:/blob: URLs that must reach the <img>/<video> branch in
// order to prove isSafeHref is what stops them. If these predicates ever
// started rejecting non-web schemes, those corpora would go vacuous — passing
// while asserting nothing. Pin the property here, where it is a deliberate
// contract rather than an incidental one.
// ---------------------------------------------------------------------------

describe('isImage/isVideo - classifier, not a safety gate', () => {
  const CLASSIFIES_AS_IMAGE = [
    [
      'data: HTML document ending in .png',
      'data:text/html;charset=utf-8,x.png',
    ],
    ['javascript: with a .png tail', 'javascript:alert(1)//x.png'],
    ['blob: ending in .png', 'blob:https://x.test/abc.png'],
    ['file: ending in .png', 'file:///etc/passwd.png'],
    ['vbscript: ending in .png', 'vbscript:msgbox(1).png'],
  ] as const

  it.each(CLASSIFIES_AS_IMAGE)(
    'classifies %s as an image even though isSafeHref rejects it',
    (_label, input) => {
      expect(isImage(input)).toBe(true)
      expect(isSafeHref(input)).toBe(false)
      expect(isWebUrl(input)).toBe(false)
    },
  )

  it('classifies a data: URL ending in .mp4 as a video', () => {
    expect(isVideo('data:text/html;charset=utf-8,x.mp4')).toBe(true)
    expect(isSafeHref('data:text/html;charset=utf-8,x.mp4')).toBe(false)
  })

  it('classifies input that is not a URL at all, via the placeholder base', () => {
    expect(isImage('not a url.png')).toBe(true)
    expect(isVideo('not a url.mp4')).toBe(true)
    // isSafeHref does not save this one: with no scheme it resolves relative
    // and comes out https:. Relative media paths are legitimate, which is why
    // a caller that needs a real remote source must reach for isWebUrl.
    expect(isSafeHref('not a url.png')).toBe(true)
    expect(isWebUrl('not a url.png')).toBe(false)
  })

  it('classifies a mailto: address ending in .png as an image', () => {
    expect(isImage('mailto:x.png')).toBe(true)
    // mailto: is allowlisted for markdown *links*, so a caller picking a media
    // element must gate on isWebUrl rather than isSafeHref alone.
    expect(isSafeHref('mailto:x.png')).toBe(true)
    expect(isWebUrl('mailto:x.png')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isVideo()
// ---------------------------------------------------------------------------

describe('isVideo', () => {
  it('returns false for undefined', () => {
    expect(isVideo(undefined)).toBe(false)
  })

  it('returns true for .mp4 URL', () => {
    expect(isVideo('https://example.com/clip.mp4')).toBe(true)
  })

  it('returns true for .webm URL', () => {
    expect(isVideo('https://example.com/clip.webm')).toBe(true)
  })

  it('returns false for .jpg URL', () => {
    expect(isVideo('https://example.com/photo.jpg')).toBe(false)
  })

  it('ignores a video extension in the query string or fragment', () => {
    expect(isVideo('https://example.com/page?file=x.mp4')).toBe(false)
    expect(isVideo('https://example.com/page#.mp4')).toBe(false)
  })

  it('matches an uppercase extension', () => {
    expect(isVideo('https://example.com/CLIP.MP4')).toBe(true)
  })

  it('still matches when a query string follows the extension', () => {
    expect(isVideo('https://example.com/clip.mp4?v=1')).toBe(true)
  })

  it('returns false for unparseable input', () => {
    expect(isVideo('http://')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// canParseUrl()
// ---------------------------------------------------------------------------

describe('canParseUrl', () => {
  it('returns true for valid URL', () => {
    expect(canParseUrl('https://example.com')).toBe(true)
  })

  it('returns false for invalid URL', () => {
    expect(canParseUrl('not a url')).toBe(false)
  })
})

// isSafeHref's obfuscation-bypass cases are covered in
// markdown/renderers/plugins.test.ts, which imports it via the renderer
// module. This file covers the stricter web-only policy used by post sinks.

const REJECTED = [
  ['javascript:', 'javascript:alert(1)'],
  ['javascript: with embedded tab', 'java\tscript:alert(1)'],
  ['javascript: with embedded newline', 'java\nscript:alert(1)'],
  ['mixed-case javascript:', 'JaVaScRiPt:alert(1)'],
  ['javascript: behind a NUL byte', '\x00javascript:alert(1)'],
  ['javascript: behind leading whitespace', '   javascript:alert(1)'],
  ['data:', 'data:text/html,x'],
  ['data: disguised as an image', 'data:text/html;base64,PHN2Zz4=#.png'],
  ['vbscript:', 'vbscript:x'],
  ['file:', 'file:///etc/passwd'],
  ['blob:', 'blob:https://x.test/abc'],
  ['ftp:', 'ftp://example.com/x'],
  ['intent:', 'intent://x#Intent;scheme=http;end'],
  ['mailto: (not a web link)', 'mailto:a@b.c'],
  ['relative path (not absolute)', '/c/technology'],
  ['protocol-relative (not absolute)', '//example.com'],
  ['fragment only', '#section'],
  ['unparseable', 'not a url'],
  ['empty', ''],
] as const

describe('parseWebUrl / isWebUrl', () => {
  it.each(REJECTED)('rejects %s', (_label, input) => {
    expect(parseWebUrl(input)).toBeNull()
    expect(isWebUrl(input)).toBe(false)
  })

  it('accepts https:', () => {
    expect(parseWebUrl('https://example.com/a?b=1')?.hostname).toBe(
      'example.com',
    )
    expect(isWebUrl('https://example.com')).toBe(true)
  })

  it('accepts http:', () => {
    expect(isWebUrl('http://example.com')).toBe(true)
  })

  it('accepts uppercase scheme (parser lowercases it)', () => {
    expect(isWebUrl('HTTPS://example.com')).toBe(true)
  })

  it('accepts surrounding whitespace (parser trims it)', () => {
    expect(isWebUrl('  https://example.com  ')).toBe(true)
  })
})

describe('isSafeHref', () => {
  it('accepts web, mailto and relative links', () => {
    expect(isSafeHref('https://example.com')).toBe(true)
    expect(isSafeHref('mailto:a@b.c')).toBe(true)
    expect(isSafeHref('/c/technology')).toBe(true)
  })

  it('rejects executable and inline-content schemes', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false)
    expect(isSafeHref('data:text/html,x')).toBe(false)
  })
})
