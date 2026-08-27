import { describe, it, expect } from 'vitest'
import { render } from 'svelte/server'
import {
  EMBED_FRAME_ORIGINS,
  YOUTUBE_EMBED_HOSTS,
} from '$lib/app/util/embed-hosts'
import PostIframe from './PostIframe.svelte'
import type { IframeType } from '../helpers'

// ---------------------------------------------------------------------------
// PostIframe is the app's only <iframe> sink, and its `url` prop is untrusted:
// it arrives from a markdown href (MdImage) or from an embed URI written
// straight to a PDS (PostMedia), neither of which the AppView is guaranteed to
// have validated. Three properties are pinned here:
//
//   1. The frame's origin is ours to choose, never the author's — it always
//      comes from the fixed YOUTUBE_EMBED_HOSTS table, which is also what the
//      server's CSP frame-src allows.
//   2. The sandbox withholds the capabilities that would let a compromised
//      player act as the page: top-level navigation, form submission, modal
//      dialogs, downloads.
//   3. Rejecting a URL emits no iframe element at all. An `<iframe src="">`
//      loads about:blank, which inherits this page's origin and makes
//      `allow-scripts allow-same-origin` a non-sandbox.
//
// svelte/server's render() is lazy — a throw inside the template surfaces only
// when `.body` is read — so every assertion here goes through renderIframe().
// ---------------------------------------------------------------------------

interface Options {
  readonly type?: IframeType
  readonly opened?: boolean
  readonly autoplay?: boolean
}

/** Renders with the embed opened, which is what both call sites do on SSR. */
const renderIframe = (url: string, options: Options = {}): string =>
  render(PostIframe, {
    props: {
      url,
      type: options.type ?? 'youtube',
      opened: options.opened ?? true,
      autoplay: options.autoplay ?? false,
    },
  }).body

const iframeAttribute = (html: string, name: string): string | undefined => {
  const tag = /<iframe\b[^>]*>/i.exec(html)?.[0]
  if (!tag) return undefined
  const attribute = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)
  return attribute?.[1]
}

const countIframes = (html: string): number =>
  [...html.matchAll(/<iframe(?=[\s/>])/gi)].length

const VIDEO_ID = 'dQw4w9WgXcQ'
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`

// ---------------------------------------------------------------------------
// 1. Frame origin
// ---------------------------------------------------------------------------

describe('PostIframe - embed origin', () => {
  const YOUTUBE_URLS: readonly string[] = [
    WATCH_URL,
    `https://youtu.be/${VIDEO_ID}`,
    `https://m.youtube.com/watch?v=${VIDEO_ID}`,
    `https://youtube.com/shorts/${VIDEO_ID}`,
    `https://www.youtube.com/embed/${VIDEO_ID}`,
  ]

  it.each(YOUTUBE_URLS)('frames only an allowlisted origin for %j', (url) => {
    const src = iframeAttribute(renderIframe(url), 'src')
    expect(src).toBeDefined()
    expect(EMBED_FRAME_ORIGINS).toContain(new URL(src ?? '').origin)
  })

  it('uses the configured frontend host and the parsed video ID', () => {
    const src = new URL(iframeAttribute(renderIframe(WATCH_URL), 'src') ?? '')
    // 'youtube' is the default frontend in defaultSettings.embeds.
    expect(src.hostname).toBe(YOUTUBE_EMBED_HOSTS.youtube)
    expect(src.pathname).toBe(`/embed/${VIDEO_ID}`)
  })

  it('does not carry the author-supplied host into the frame src', () => {
    // The regex accepts a `www.`/`m.` prefix only, so a lookalike host is not a
    // YouTube link at all and must not produce an embed.
    const html = renderIframe(`https://evil.test/watch?v=${VIDEO_ID}`)
    expect(countIframes(html)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Sandbox
// ---------------------------------------------------------------------------

describe('PostIframe - sandbox', () => {
  /**
   * Capabilities that would let a compromised or hostile player act on the
   * user's behalf in the top-level Coves document. `allow-scripts` and
   * `allow-same-origin` together are normally an escape hatch, but they are
   * safe here precisely because the assertions above pin `src` to a fixed
   * cross-origin host — so what matters is that these stay withheld.
   */
  const FORBIDDEN_TOKENS: readonly string[] = [
    'allow-top-navigation',
    'allow-top-navigation-by-user-activation',
    'allow-top-navigation-to-custom-protocols',
    'allow-modals',
    'allow-forms',
    'allow-downloads',
    'allow-pointer-lock',
    'allow-storage-access-by-user-activation',
  ]

  it('applies a sandbox to the embed frame', () => {
    expect(iframeAttribute(renderIframe(WATCH_URL), 'sandbox')).toBeDefined()
  })

  it.each(FORBIDDEN_TOKENS)('withholds %s', (token: string) => {
    const sandbox = iframeAttribute(renderIframe(WATCH_URL), 'sandbox') ?? ''
    expect(sandbox.split(/\s+/)).not.toContain(token)
  })

  it('grants only the tokens the player actually needs', () => {
    const sandbox = iframeAttribute(renderIframe(WATCH_URL), 'sandbox') ?? ''
    expect(sandbox.split(/\s+/).filter(Boolean).sort()).toEqual([
      'allow-popups',
      'allow-popups-to-escape-sandbox',
      'allow-presentation',
      'allow-same-origin',
      'allow-scripts',
    ])
  })
})

// ---------------------------------------------------------------------------
// 3. Rejected URLs emit no frame
// ---------------------------------------------------------------------------

describe('PostIframe - rejected URLs', () => {
  it('emits no iframe for type "none"', () => {
    const html = renderIframe('https://example.com/page', { type: 'none' })
    expect(countIframes(html)).toBe(0)
    expect(html).not.toContain('src=""')
  })

  /**
   * These reach the youtube branch because isYoutubeLink's regex makes the
   * scheme optional (`youtu.be/xxxxxxxxxxx`) or because a caller classified
   * them upstream. urlToEmbed must be total: it runs inside a $derived that
   * the template reads during SSR, so throwing here is a 500 on the whole
   * page, not a broken embed.
   */
  const UNEMBEDDABLE: readonly string[] = [
    'youtu.be/aaaaaaaaaaa',
    'www.youtube.com/watch?v=aaaaaaaaaaa',
    'not a url',
    '',
    '/relative/path',
    'javascript:alert(1)',
    'data:text/html,x',
    'mailto:a@b.test',
    'https://www.youtube.com/watch?v=tooshort',
  ]

  it.each(UNEMBEDDABLE)('renders %j without throwing', (url: string) => {
    expect(() => renderIframe(url)).not.toThrow()
  })

  it.each(UNEMBEDDABLE)('emits no iframe for %j', (url: string) => {
    expect(countIframes(renderIframe(url))).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 4. Direct video files
// ---------------------------------------------------------------------------

describe('PostIframe - video files', () => {
  it('renders a <video> with a <source src>, not an iframe', () => {
    const url = 'https://cdn.test/clip.mp4'
    const html = renderIframe(url, { type: 'video' })

    expect(countIframes(html)).toBe(0)
    expect(html).toContain('<video')
    expect(/<source\b[^>]*\bsrc="([^"]*)"/i.exec(html)?.[1]).toBe(url)
  })
})

// ---------------------------------------------------------------------------
// 5. Click-to-view preview
// ---------------------------------------------------------------------------

describe('PostIframe - unopened preview', () => {
  it('emits no iframe before the user opens the embed', () => {
    const html = renderIframe(WATCH_URL, { opened: false })
    expect(countIframes(html)).toBe(0)
    expect(html).toContain('<button')
  })

  it('shows the hostname of an unparseable URL without throwing', () => {
    expect(() =>
      renderIframe('youtu.be/aaaaaaaaaaa', { opened: false }),
    ).not.toThrow()
  })
})
