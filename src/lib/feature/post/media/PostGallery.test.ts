import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { EmbedImage } from '$lib/api/coves/types'
import { settings } from '$lib/app/state/settings.svelte'
import PostGallery from './PostGallery.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const PREVIEW =
  'https://img.coves.test/img/content_preview/plain/did:plc:a/bafy1'
const FULL = 'https://img.coves.test/img/content_full/plain/did:plc:a/bafy1'

const lake: EmbedImage = { thumb: PREVIEW, fullsize: FULL, alt: 'A lake' }

function renderGallery(
  props: { priority?: boolean; blur?: boolean } = {},
): Document {
  const { body } = render(PostGallery, { props: { images: [lake], ...props } })
  return new JSDOM(body).window.document
}

/** The backdrop and foreground `<img>` of the single tile, in that order. */
function images(priority?: boolean): HTMLImageElement[] {
  return [...renderGallery({ priority }).querySelectorAll('img')]
}

function sourceSets(picture: Element | null): string[] {
  return [...(picture?.querySelectorAll('source') ?? [])].map(
    (source) =>
      `${source.getAttribute('media')} ${source.getAttribute('srcset')}`,
  )
}

describe('PostGallery with one image', () => {
  it('fetches a feed image lazily by default', () => {
    const rendered = images()
    expect(rendered).toHaveLength(2)
    for (const img of rendered) {
      expect(img.getAttribute('loading')).toBe('lazy')
      expect(img.getAttribute('decoding')).toBe('async')
    }
  })

  it('fetches the likely largest paint eagerly and first', () => {
    const [backdrop, image] = images(true)

    expect(backdrop.getAttribute('loading')).toBe('eager')
    expect(image.getAttribute('loading')).toBe('eager')
    expect(image.getAttribute('fetchpriority')).toBe('high')
  })

  it('offers the backdrop exactly what it offers the image, so one file serves both', () => {
    const [backdrop, image] = images()

    const backdropSources = sourceSets(backdrop.closest('picture'))
    expect(backdropSources).toHaveLength(1)
    expect(backdropSources).toEqual(sourceSets(image.closest('picture')))
  })

  it('lets the screen density pick the file on every viewport', () => {
    const [, image] = images()
    const sources = [
      ...(image.closest('picture')?.querySelectorAll('source') ?? []),
    ]

    // A `(max-width: 800px)` source used to force the 800px preview on
    // phones, stretched on 3x screens. One source without a media query
    // also covers zoomed viewports such as 800.5px.
    expect(sources).toHaveLength(1)
    expect(sources[0].hasAttribute('media')).toBe(false)
    expect(sources[0].getAttribute('srcset')).toBe(
      `${PREVIEW} 800w, ${FULL} 1600w`,
    )
  })

  it('describes a single image as the width of the post column', () => {
    const [, image] = images()
    const source = image.closest('picture')?.querySelector('source')

    expect(source?.getAttribute('sizes')).toBe(
      '(max-width: 767px) calc(100vw - 26px), (max-width: 1023px) calc(100vw - 306px), min(calc(50vw - 50px), 750px)',
    )
  })

  it('keeps the image URL off a blurred foreground image', () => {
    const image = renderGallery({ blur: true }).querySelector(
      'img[alt="A lake"]',
    )

    expect(image).not.toBeNull()
    expect(image?.getAttribute('src') ?? '').toBe('')
    expect(image?.getAttribute('srcset') ?? '').toBe('')
    expect(
      [...(image?.classList ?? [])].some((name) => name.startsWith('blur')),
    ).toBe(true)
  })
})

describe('PostGallery tile size', () => {
  const body = (images: EmbedImage[], fitHeight?: boolean): string =>
    render(PostGallery, { props: { images, fitHeight } }).body

  it('narrows a single image to its shape when asked', () => {
    expect(body([lake], true)).toContain('min(100%, calc(60vh * 4 / 3))')
  })

  it('keeps a single image at full width by default', () => {
    expect(body([lake])).not.toContain('calc(60vh')
  })

  it('describes a grid tile as half the post column', () => {
    const source = new JSDOM(body([lake, lake])).window.document.querySelector(
      'source',
    )

    expect(source?.getAttribute('sizes')).toBe(
      '(max-width: 767px) calc((100vw - 26px) / 2), (max-width: 1023px) calc((100vw - 306px) / 2), min(calc((50vw - 50px) / 2), 375px)',
    )
  })

  it('describes the uncapped 60% column when the width limit is off', () => {
    settings.newWidth = false
    try {
      const document = new JSDOM(body([lake])).window.document
      const grid = new JSDOM(body([lake, lake])).window.document

      expect(document.querySelector('source')?.getAttribute('sizes')).toBe(
        '(max-width: 767px) calc(100vw - 26px), (max-width: 1023px) calc(100vw - 306px), calc(54vw - 50px)',
      )
      expect(grid.querySelector('source')?.getAttribute('sizes')).toBe(
        '(max-width: 767px) calc((100vw - 26px) / 2), (max-width: 1023px) calc((100vw - 306px) / 2), calc((54vw - 50px) / 2)',
      )
    } finally {
      settings.newWidth = true
    }
  })

  // A gallery fits one screen: every grid tile is the same 4:3 crop of its
  // image, however tall the image is. The lightbox shows it whole.
  it('crops every grid tile to 4:3, whatever the image shape', () => {
    const tall: EmbedImage = {
      ...lake,
      aspectRatio: { width: 334, height: 456 },
    }
    const document = new JSDOM(body([tall, lake])).window.document
    const tiles = [...document.querySelectorAll('.grid > *')]

    expect(tiles).toHaveLength(2)
    for (const tile of tiles) {
      expect(tile.getAttribute('style')).toContain('aspect-ratio: 4 / 3')
      expect(tile.getAttribute('style')).not.toContain('334')
      const foreground = [...tile.querySelectorAll('img')].at(-1)
      expect(foreground?.classList.contains('object-cover')).toBe(true)
    }
  })

  it('keeps grid tiles at column width', () => {
    expect(body([lake, lake], true)).not.toContain('calc(60vh')
  })

  it('does not scale an image on hover or press', () => {
    expect(body([lake])).not.toMatch(/group-(hover|active):scale/)
  })
})

describe('PostGallery in a feed card', () => {
  const feedDocument = (images: EmbedImage[], blur = false): Document =>
    new JSDOM(render(PostGallery, { props: { images, feed: true, blur } }).body)
      .window.document
  const square = { ...lake, aspectRatio: { width: 1, height: 1 } }

  it('shows an image of unknown shape at its natural size until it loads', () => {
    const document = feedDocument([lake])
    const images = [...document.querySelectorAll('img')]

    expect(images).toHaveLength(1)
    expect(images[0].classList).toContain('max-h-[560px]')
    expect(document.querySelector('[data-feed-frame]')).toBeNull()
  })

  it('caps sizes at the width the image reserves', () => {
    const source = feedDocument([square]).querySelector('source')

    expect(source?.getAttribute('sizes')).toBe(
      '(max-width: 767px) min(calc(100vw - 26px), 560px), (max-width: 1023px) min(calc(100vw - 306px), 560px), min(calc(50vw - 50px), 750px, 560px)',
    )
  })

  it('keeps the ALT badge outside the expand control', () => {
    const document = feedDocument([square])
    const badge = [...document.querySelectorAll('button')].find(
      (button) =>
        button.textContent?.trim() !== '' && !button.querySelector('img'),
    )

    expect(badge).toBeDefined()
    expect(badge?.closest('[aria-label="A lake"]')).toBeNull()
  })

  it('blurs the preview and keeps the full size off a concealed image', () => {
    const image = [...feedDocument([square], true).querySelectorAll('img')].at(
      -1,
    )

    expect(image?.getAttribute('src')).toBe(PREVIEW)
    expect(image?.classList).toContain('blur-3xl')
    expect(image?.closest('picture')?.querySelector('source')).toBeNull()
  })

  it('keeps the grid for two or more images', () => {
    const document = feedDocument([square, square])

    expect(document.querySelector('.grid')).not.toBeNull()
    expect(document.querySelector('.max-h-\\[560px\\]')).toBeNull()
  })

  // Every feed image of known shape spans the column, Reddit-style, over a
  // blurred copy of itself; very tall ones are cropped from the top.
  const frame = (document: Document): Element | null =>
    document.querySelector('[data-feed-frame]')

  it('frames a portrait image across the column over a blurred copy of itself', () => {
    const portrait = { ...lake, aspectRatio: { width: 3, height: 4 } }
    const document = feedDocument([portrait])
    const box = frame(document)
    const images = [...(box?.querySelectorAll('img') ?? [])]

    expect(box?.getAttribute('data-feed-frame')).toBe('fit')
    expect(box?.getAttribute('style')).toBe(
      'aspect-ratio: 3 / 4; max-height: 560px',
    )
    expect(images).toHaveLength(2)
    expect(images[0].getAttribute('aria-hidden')).toBe('true')
    expect(images[0].classList).toContain('blur-2xl')
    expect(images[1].classList).toContain('object-contain')
    expect(images[1].getAttribute('alt')).toBe('A lake')
  })

  it('crops a very tall image from the top at 560px, never wider than its file', () => {
    const comic = { ...lake, aspectRatio: { width: 438, height: 1097 } }
    const document = feedDocument([comic])
    const box = frame(document)
    const foreground = [...(box?.querySelectorAll('img') ?? [])].at(-1)

    expect(box?.getAttribute('data-feed-frame')).toBe('tall')
    expect(box?.getAttribute('style')).toBe('height: 560px')
    expect(foreground?.getAttribute('style')).toBe('width: min(100%, 438px)')
    expect(box?.querySelector('[data-tall-fade]')).not.toBeNull()
    expect(document.querySelector('source')?.getAttribute('sizes')).toBe(
      '(max-width: 767px) min(calc(100vw - 26px), 438px), (max-width: 1023px) min(calc(100vw - 306px), 438px), min(calc(50vw - 50px), 750px, 438px)',
    )
  })

  it('caps a portrait image at its width at 560px of height', () => {
    const portrait = { ...lake, aspectRatio: { width: 3, height: 4 } }
    const source = feedDocument([portrait]).querySelector('source')

    expect(source?.getAttribute('sizes')).toBe(
      '(max-width: 767px) min(calc(100vw - 26px), 420px), (max-width: 1023px) min(calc(100vw - 306px), 420px), min(calc(50vw - 50px), 750px, 420px)',
    )
  })

  it('spans a tall image of unknown pixel width across the frame', () => {
    // A 1:3 ratio is a shape, not a pixel size: 1px would be a sliver.
    const ratioOnly = { ...lake, aspectRatio: { width: 1, height: 3 } }
    const box = frame(feedDocument([ratioOnly]))
    const foreground = [...(box?.querySelectorAll('img') ?? [])].at(-1)

    expect(box?.getAttribute('data-feed-frame')).toBe('tall')
    expect(foreground?.getAttribute('style')).toBe('width: 100%')
  })

  it('frames square and landscape images the same way', () => {
    const landscape = { ...lake, aspectRatio: { width: 4, height: 3 } }

    expect(frame(feedDocument([landscape]))?.getAttribute('style')).toBe(
      'aspect-ratio: 4 / 3; max-height: 560px',
    )
    expect(frame(feedDocument([square]))?.getAttribute('style')).toBe(
      'aspect-ratio: 1 / 1; max-height: 560px',
    )
  })

  it('writes no style from a ratio that is not two numbers', () => {
    const hostile = {
      ...lake,
      aspectRatio: { width: '1; position:fixed; inset:0', height: 1 },
    } as unknown as EmbedImage
    const html = render(PostGallery, { props: { images: [hostile] } }).body

    expect(html).not.toContain('position:fixed')
  })
})
