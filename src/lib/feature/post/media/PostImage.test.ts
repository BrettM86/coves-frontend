import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { PostEmbed } from '$lib/api/coves/types'
import PostImage from './PostImage.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const PREVIEW =
  'https://img.coves.test/img/content_preview/plain/did:plc:a/bafy1'
const FULL = 'https://img.coves.test/img/content_full/plain/did:plc:a/bafy1'

const embed = {
  $type: 'social.coves.embed.images#view',
  images: [{ thumb: PREVIEW, fullsize: FULL, alt: 'A lake' }],
} as unknown as PostEmbed

function images(priority?: boolean): HTMLImageElement[] {
  const { body } = render(PostImage, { props: { embed, priority } })
  return [...new JSDOM(body).window.document.querySelectorAll('img')]
}

function sourceSets(picture: Element | null): string[] {
  return [...(picture?.querySelectorAll('source') ?? [])].map(
    (source) =>
      `${source.getAttribute('media')} ${source.getAttribute('srcset')}`,
  )
}

describe('PostImage', () => {
  it('fetches a feed image lazily by default', () => {
    for (const img of images()) {
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
    expect(backdropSources).toHaveLength(2)
    expect(backdropSources).toEqual(sourceSets(image.closest('picture')))
  })

  it('has a source for every viewport width', () => {
    const [, image] = images()
    const sources = [
      ...(image.closest('picture')?.querySelectorAll('source') ?? []),
    ]

    // A zoomed viewport can be 800.5px wide. With `(max-width: 800px)` and
    // `(min-width: 801px)` no source matches, and the <img> falls back to
    // downloading the full size.
    expect(sources.at(-1)?.hasAttribute('media')).toBe(false)
  })

  it('leaves the full size to screens dense enough to need it', () => {
    const [, image] = images()
    const wide = image.closest('picture')?.querySelector('source:not([media])')

    expect(wide?.getAttribute('srcset')).toBe(`${PREVIEW} 800w, ${FULL} 1600w`)
    expect(wide?.getAttribute('sizes')).toBe('800px')
  })
})
