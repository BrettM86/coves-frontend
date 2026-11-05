import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { PostEmbed } from '$lib/api/coves/types'
import PostMedia from './PostMedia.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const threeImages: PostEmbed = {
  $type: 'social.coves.embed.images#view',
  images: [
    {
      thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/one',
      fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/one',
      alt: 'First image',
    },
    {
      thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/two',
      fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/two',
      alt: 'Second image',
    },
    {
      thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/three',
      fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/three',
      alt: 'Third image',
    },
  ],
}

function renderMedia(priority?: boolean): Document {
  const { body } = render(PostMedia, {
    props: { embed: threeImages, type: 'image', view: 'cozy', priority },
  })
  return new JSDOM(body).window.document
}

/** Two-column per the plan: inline grid-template-columns or `grid-cols-2`. */
function isTwoColumn(element: Element): boolean {
  const style = (element.getAttribute('style') ?? '').replace(/\s+/g, ' ')
  return (
    element.classList.contains('grid-cols-2') ||
    style.includes('grid-template-columns: repeat(2, minmax(0, 1fr))')
  )
}

describe('PostMedia with an images#view embed', () => {
  it('renders every image as a tile in a two-column gallery', () => {
    const document = renderMedia()

    const tileImages = ['First image', 'Second image', 'Third image'].map(
      (alt) => document.querySelector(`img[alt="${alt}"]`),
    )
    expect(tileImages.map((img) => img?.getAttribute('alt'))).toEqual([
      'First image',
      'Second image',
      'Third image',
    ])

    const galleries = [...document.querySelectorAll('*')].filter(isTwoColumn)
    expect(galleries).toHaveLength(1)
    for (const img of tileImages) {
      expect(img && galleries[0].contains(img)).toBe(true)
    }
  })

  it('forwards priority so the first tile is fetched eagerly', () => {
    const first = renderMedia(true).querySelector('img[alt="First image"]')

    expect(first?.getAttribute('loading')).toBe('eager')
  })
})

describe('PostMedia with an external#view embed linking an image file', () => {
  it.each([
    {
      name: 'an https image link renders one tile showing that link',
      uri: 'https://pics.example.test/photos/harbour.jpg',
      expectedSources: ['https://pics.example.test/photos/harbour.jpg'],
    },
    {
      name: 'a javascript: link renders no tile and no src carrying it',
      uri: 'javascript:alert(1)//harbour.jpg',
      expectedSources: [],
    },
  ])('$name', ({ uri, expectedSources }) => {
    const embed: PostEmbed = {
      $type: 'social.coves.embed.external#view',
      external: { uri, title: 'Harbour at dusk' },
    }
    const { body } = render(PostMedia, {
      props: { embed, type: 'image', view: 'cozy' },
    })
    const document = new JSDOM(body).window.document

    const tiles = document.querySelectorAll('[style*="aspect-ratio"]')
    const foregroundSources = [
      ...document.querySelectorAll('picture.relative > img'),
    ].map((img) => img.getAttribute('src'))
    expect(tiles).toHaveLength(expectedSources.length)
    expect(foregroundSources).toEqual(expectedSources)
    expect(body).not.toContain('javascript:')
  })
})
