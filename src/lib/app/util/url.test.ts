import { describe, it, expect } from 'vitest'
import { canParseUrl, isImage, isVideo, isSafeHref, isWebUrl, parseWebUrl } from './url'

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
