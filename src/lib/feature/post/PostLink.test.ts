import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import PostLink from './PostLink.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

// ---------------------------------------------------------------------------
// PostLink's `thumbnail_url` is an `<img src>` sink fed by untrusted embed
// content. The helper that usually supplies it is not the only caller, and a
// prop is not a gate: whatever a caller hands over is what reaches the browser.
// So the component decides for itself, and a rejected thumbnail means the card
// renders with no image at all rather than an `<img src="">` placeholder that
// still occupies the slot and still fires a request in some engines.
//
// svelte/server's render() is lazy, so every assertion goes through markup().
// ---------------------------------------------------------------------------

const UNSAFE_MEDIA_URLS: readonly string[] = [
  'file:///etc/passwd',
  'javascript:alert(1)',
  'data:text/html,x.png',
  '//example.com/x.png',
  '/x.png',
  'relative/x.png',
  'https://',
]

const SAFE_MEDIA_URLS: readonly string[] = [
  'https://cdn.example.com/x.png',
  'http://cdn.example.com/x.png',
]

const ARTICLE_URL = 'https://example.com/article'

interface Options {
  readonly thumbnail_url?: string
  readonly embed_title?: string
  readonly view?: 'cozy' | 'compact'
}

const markup = (options: Options = {}): string =>
  render(PostLink, {
    props: {
      url: ARTICLE_URL,
      embed_title: options.embed_title ?? 'Article',
      thumbnail_url: options.thumbnail_url,
      view: options.view ?? 'cozy',
    },
  }).body

const imageTags = (html: string): string[] =>
  [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0])

describe('PostLink - thumbnail_url', () => {
  it.each(UNSAFE_MEDIA_URLS)('emits no image for %j', (thumbnail_url) => {
    expect(imageTags(markup({ thumbnail_url }))).toEqual([])
  })

  it.each(SAFE_MEDIA_URLS)('renders %j unchanged', (thumbnail_url) => {
    const images = imageTags(markup({ thumbnail_url }))
    expect(images).toHaveLength(1)
    expect(images[0]).toContain(`src="${thumbnail_url}"`)
  })

  it('still renders the card title when the thumbnail is rejected', () => {
    const html = markup({ thumbnail_url: 'file:///etc/passwd' })
    expect(html).toContain('Article')
    expect(html).toContain(`href="${ARTICLE_URL}"`)
  })

  it('emits no image when no thumbnail is supplied', () => {
    expect(imageTags(markup())).toEqual([])
  })
})

describe('PostLink - compact view', () => {
  it.each([...UNSAFE_MEDIA_URLS, ...SAFE_MEDIA_URLS])(
    'renders no image at all for %j',
    (thumbnail_url) => {
      expect(imageTags(markup({ thumbnail_url, view: 'compact' }))).toEqual([])
    },
  )
})

describe('PostLink - rejected link target', () => {
  it.each(['javascript:alert(1)', 'file:///etc/passwd', '/relative'])(
    'renders %j as inert text with no image',
    (url) => {
      const html = render(PostLink, {
        props: {
          url,
          embed_title: 'Article',
          thumbnail_url: SAFE_MEDIA_URLS[0],
          view: 'cozy' as const,
        },
      }).body
      expect(imageTags(html)).toEqual([])
      expect(html).not.toContain(`href="${url}"`)
    },
  )
})

describe('PostLink - untitled card with a rejected thumbnail', () => {
  // With neither a title nor a usable thumbnail there is no card left to draw,
  // so the cozy branch falls through to the same compact link the feed uses
  // elsewhere. The link itself is unaffected: only the image was rejected.
  it('falls back to the compact link', () => {
    // Rendered directly: markup() supplies a default title, and its absence is
    // the whole point of this case.
    const html = render(PostLink, {
      props: {
        url: ARTICLE_URL,
        embed_title: undefined,
        thumbnail_url: 'file:///etc/passwd',
        view: 'cozy' as const,
      },
    }).body

    expect(imageTags(html)).toEqual([])
    expect(html).toContain('post-link-compact')
    expect(html).toContain(`href="${ARTICLE_URL}"`)
  })
})
