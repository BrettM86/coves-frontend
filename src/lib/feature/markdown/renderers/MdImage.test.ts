import { describe, it, expect } from 'vitest'
import { render } from 'svelte/server'
import { isImage, isVideo } from '$lib/app/util/url'
import MdImage from './MdImage.svelte'

// ---------------------------------------------------------------------------
// MdImage receives an untrusted href straight from markdown. It must defend
// itself the way MdLink.svelte:12 does — refusing to emit a URL-bearing sink
// for a non-allowlisted scheme — rather than relying on preprocess() in the
// Markdown.svelte module block, which only guards the document path and only
// strips javascript:.
// ---------------------------------------------------------------------------

const SAFE_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'mailto:',
])

/** Base used only to resolve relative URLs; never a real origin. */
const RESOLUTION_BASE = 'https://base.invalid'

const decodeEntities = (value: string): string =>
  value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')

/** Every href= / src= attribute value in an emitted HTML string. */
const extractUrlAttributes = (html: string): string[] => {
  const attribute = /\b(?:href|src|srcset|formaction|data)\s*=\s*"([^"]*)"/gi
  return [...html.matchAll(attribute)].map((match) =>
    decodeEntities(match[1] ?? ''),
  )
}

const hasSafeScheme = (value: string): boolean => {
  try {
    return SAFE_PROTOCOLS.has(new URL(value, RESOLUTION_BASE).protocol)
  } catch {
    return false
  }
}

/**
 * Elements that load or navigate to a URL. For an unsafe href the component
 * must emit none of them — an `<iframe src="">` is still an emitted iframe,
 * and leaving the URL for PostIframe's urlToEmbed() to blank would put the
 * guard somewhere other than the component that owns the untrusted input.
 * The wrapping <div> chrome is deliberately out of scope.
 */
const findSinkElements = (html: string): string[] => {
  const sink = /<(img|video|source|iframe|embed|object)(?=[\s/>])/gi
  return [...html.matchAll(sink)].map((match) => match[1]?.toLowerCase() ?? '')
}

const renderImage = (href: string): string =>
  render(MdImage, { props: { href, text: 'alt' } }).body

// ---------------------------------------------------------------------------
// Hostile hrefs - none may reach a sink
// ---------------------------------------------------------------------------

const HOSTILE_HREFS: readonly string[] = [
  // A data: HTML document whose pathname genuinely ends in ".png", so
  // isImage() classifies it as an image. Without the isSafeHref guard this
  // reaches <img src>.
  'data:text/html;charset=utf-8,x.png',
  // Same shape against isVideo(); without the guard this reaches
  // <video><source src>.
  'data:text/html;charset=utf-8,x.mp4',
  // Before the guard these fell through to PostIframe's 'embed' branch, where
  // urlToEmbed() returned '' — contained by accident rather than by intent,
  // which is why they are pinned here explicitly.
  'vbscript:msgbox(1)',
  'data:text/html;base64,PHN2Zz48L3N2Zz4=',
  'file:///etc/passwd',
  'blob:https://x.test/abc',
  // Passed directly as a prop, so preprocess() never sees it.
  'javascript:alert(1)',
  // The same non-web schemes wearing an image extension. An opaque scheme puts
  // its whole body in `pathname`, so all four classify as images (pinned in
  // app/util/url.test.ts) and take the <img src> branch — isSafeHref is the
  // only thing between them and the sink, which the plain forms above never
  // exercise because they fell through to the harmless 'embed' branch instead.
  'javascript:alert(1)//x.png',
  'blob:https://x.test/abc.png',
  'file:///etc/passwd.png',
  'vbscript:msgbox(1).png',
]

/**
 * Positive control for the corpus above. Every entry is chosen because it
 * reaches a media branch; if isImage/isVideo stopped classifying these, the
 * hostile assertions would still pass while proving nothing. See the matching
 * block in app/util/url.test.ts.
 */
describe('MdImage - hostile corpus preconditions', () => {
  const REACHING_IMG: readonly string[] = [
    'data:text/html;charset=utf-8,x.png',
    'javascript:alert(1)//x.png',
    'blob:https://x.test/abc.png',
    'file:///etc/passwd.png',
    'vbscript:msgbox(1).png',
  ]

  it.each(REACHING_IMG)('%j classifies as an image', (href: string) => {
    expect(isImage(href)).toBe(true)
    expect(HOSTILE_HREFS).toContain(href)
  })

  it('the .mp4 entry classifies as a video', () => {
    expect(isVideo('data:text/html;charset=utf-8,x.mp4')).toBe(true)
    expect(HOSTILE_HREFS).toContain('data:text/html;charset=utf-8,x.mp4')
  })
})

describe('MdImage - untrusted href schemes', () => {
  it.each(HOSTILE_HREFS)('emits no media sink for %j', (href: string) => {
    const body = renderImage(href)

    // Structural: refuse to render a sink at all, the way MdLink.svelte:12
    // refuses to render an <a>. Keeps a future swap of one sink for another
    // (img -> video -> iframe) from sliding through.
    expect(findSinkElements(body)).toEqual([])

    // Scheme: and nothing hostile in any URL attribute either.
    const violations = extractUrlAttributes(body).filter(
      (url) => !hasSafeScheme(url),
    )
    expect(violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Legitimate hrefs - must still render an image
// ---------------------------------------------------------------------------

const SAFE_HREFS: readonly string[] = [
  'https://ok.test/x.png',
  '/relative/img.png',
]

describe('MdImage - legitimate targets', () => {
  it.each(SAFE_HREFS)('still renders an <img src> for %j', (href: string) => {
    const body = renderImage(href)
    expect(body).toContain('<img')
    expect(body).toContain(`src="${href}"`)
  })
})

// ---------------------------------------------------------------------------
// Scheme-less hrefs — availability, not just XSS
//
// isSafeHref accepts relative hrefs (they resolve to the site origin), and
// isYoutubeLink's regex makes the scheme optional. `![a](youtu.be/xxxxxxxxxxx)`
// therefore used to be classified 'iframe' -> iframeType 'youtube' -> PostIframe,
// whose urlToEmbed() called `new URL()` on a string that is not a URL. Because
// MdImage passes opened={true}, the $derived was read unconditionally during
// render, so the throw escaped as a 500 on any page containing the post — a
// denial of service any author could trigger with eleven characters.
//
// These assertions must touch `.body`: svelte/server's render() is lazy, and a
// throw inside the template does not surface until the body is serialized.
// ---------------------------------------------------------------------------

const SCHEMELESS_HREFS: readonly string[] = [
  'youtu.be/aaaaaaaaaaa',
  'www.youtube.com/watch?v=aaaaaaaaaaa',
  'm.youtube.com/shorts/aaaaaaaaaaa',
  'youtube.com/embed/aaaaaaaaaaa',
]

describe('MdImage - scheme-less media hrefs', () => {
  it.each(SCHEMELESS_HREFS)('renders %j without throwing', (href: string) => {
    expect(() => renderImage(href)).not.toThrow()
  })

  it.each(SCHEMELESS_HREFS)('takes no iframe path for %j', (href: string) => {
    // A relative string cannot become an embed, so it must not reach
    // PostIframe at all. It degrades to the plain <img> fallback that any
    // other non-media relative path gets.
    expect(findSinkElements(renderImage(href))).toEqual(['img'])
  })
})
