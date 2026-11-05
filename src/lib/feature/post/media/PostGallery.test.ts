import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { EmbedImage } from '$lib/api/coves/types'
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
      '(max-width: 767px) calc(100vw - 26px), (max-width: 1023px) calc(100vw - 306px), min(840px, calc(55.6vw - 50px))',
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
      '(max-width: 767px) calc((100vw - 26px) / 2), (max-width: 1023px) calc((100vw - 306px) / 2), min(420px, calc((55.6vw - 50px) / 2))',
    )
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

  it('shows a single image at its natural shape with no backdrop', () => {
    const document = feedDocument([square])
    const images = [...document.querySelectorAll('img')]

    expect(images).toHaveLength(1)
    expect(images[0].classList).toContain('max-h-[560px]')
    expect(images[0].getAttribute('style')).toBe(
      'aspect-ratio: 1 / 1; width: 560px',
    )
  })

  it('caps sizes at the width the image reserves', () => {
    const source = feedDocument([square]).querySelector('source')

    expect(source?.getAttribute('sizes')).toBe(
      '(max-width: 767px) min(calc(100vw - 26px), 560px), (max-width: 1023px) min(calc(100vw - 306px), 560px), min(840px, calc(55.6vw - 50px), 560px)',
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
    const image = feedDocument([square], true).querySelector('img')

    expect(image?.getAttribute('src')).toBe(PREVIEW)
    expect(image?.classList).toContain('blur-3xl')
    expect(image?.closest('picture')?.querySelector('source')).toBeNull()
  })

  it('keeps the grid for two or more images', () => {
    const document = feedDocument([square, square])

    expect(document.querySelector('.grid')).not.toBeNull()
    expect(document.querySelector('.max-h-\\[560px\\]')).toBeNull()
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
