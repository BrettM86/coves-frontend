import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { EmbedImage, PostEmbed } from '$lib/api/coves/types'
import PostMediaCompact from './PostMediaCompact.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const image = (name: string): EmbedImage => ({
  thumb: `https://img.coves.test/img/content_preview/plain/did:plc:a/${name}`,
  fullsize: `https://img.coves.test/img/content_full/plain/did:plc:a/${name}`,
  alt: `Image ${name}`,
})

const threeImages: PostEmbed = {
  $type: 'social.coves.embed.images#view',
  images: [image('one'), image('two'), image('three')],
}

const threeImagesWithAttachment: PostEmbed = {
  $type: 'social.coves.embed.imagesWithAttachment#view',
  images: {
    $type: 'social.coves.embed.images#view',
    images: [image('one'), image('two'), image('three')],
  },
  attachment: {
    $type: 'social.coves.embed.external#viewExternal',
    uri: 'https://news.example.test/harbour-story',
    title: 'Harbour story',
    thumb: 'https://news.example.test/media/harbour-card.jpg',
  },
}

const twoImages: PostEmbed = {
  $type: 'social.coves.embed.images#view',
  images: [image('one'), image('two')],
}

const oneImage: PostEmbed = {
  $type: 'social.coves.embed.images#view',
  images: [image('one')],
}

function renderCompact(embed: PostEmbed): Document {
  const { body } = render(PostMediaCompact, {
    props: { embed, type: 'image', view: 'compact' },
  })
  return new JSDOM(body).window.document
}

/** Elements whose own text is only a number: the count badge candidates. */
function numericBadges(document: Document): string[] {
  return [...document.body.querySelectorAll('*')]
    .filter(
      (element) =>
        element.children.length === 0 &&
        /^\d+$/.test(element.textContent?.trim() ?? ''),
    )
    .map((element) => element.textContent?.trim() ?? '')
}

describe('PostMediaCompact image count badge', () => {
  it.each([
    { name: 'images#view with 2 images', embed: twoImages, expected: '2' },
    { name: 'images#view with 3 images', embed: threeImages, expected: '3' },
    {
      name: 'imagesWithAttachment with 3 images',
      embed: threeImagesWithAttachment,
      expected: '3',
    },
  ])(
    '$name shows the first image with a badge reading $expected',
    ({ embed, expected }) => {
      const document = renderCompact(embed)

      const sources = [...document.querySelectorAll('img')].map((img) =>
        img.getAttribute('src'),
      )
      expect(sources).toEqual([
        'https://img.coves.test/img/content_preview/plain/did:plc:a/one',
      ])
      expect(numericBadges(document)).toEqual([expected])
    },
  )

  it('shows no badge for a single image', () => {
    const document = renderCompact(oneImage)

    expect(document.querySelector('img')?.getAttribute('src')).toBe(
      'https://img.coves.test/img/content_preview/plain/did:plc:a/one',
    )
    expect(numericBadges(document)).toEqual([])
  })
})
