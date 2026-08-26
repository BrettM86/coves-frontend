import { describe, it, expect } from 'vitest'
import { render } from 'svelte/server'
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
  // isImage() is a substring regex, so the ".png" in the fragment matches.
  // This reached an <img src> before the isSafeHref guard landed.
  'data:text/html;base64,PHN2Zz48L3N2Zz4=#.png',
  // Same trick against isVideo(); this reached <video><source src>.
  'data:text/html;base64,PHN2Zz48L3N2Zz4=#.mp4',
  // Before the guard these fell through to PostIframe's 'embed' branch, where
  // urlToEmbed() returned '' — contained by accident rather than by intent,
  // which is why they are pinned here explicitly.
  'vbscript:msgbox(1)',
  'data:text/html;base64,PHN2Zz48L3N2Zz4=',
  'file:///etc/passwd',
  'blob:https://x.test/abc',
  // Passed directly as a prop, so preprocess() never sees it.
  'javascript:alert(1)',
]

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
