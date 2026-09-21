import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { PostEmbed } from '$lib/api/coves/types'
import { mediaType } from '../helpers'
import PostMediaCompact from './PostMediaCompact.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const imageSource = (embed: PostEmbed): string | null => {
  const html = render(PostMediaCompact, {
    props: { embed, type: mediaType(embed), view: 'compact' as const },
  }).body
  const document = new JSDOM(`<main>${html}</main>`).window.document
  return document.querySelector('img')?.getAttribute('src') ?? null
}

describe('PostMediaCompact generic source selection', () => {
  it('uses an image-valued external URI instead of its distinct preview thumbnail', () => {
    const imageUri = 'https://example.com/photo.jpg'
    const embed: PostEmbed = {
      $type: 'social.coves.embed.external#view',
      external: {
        uri: imageUri,
        title: 'Direct image',
        thumb: 'https://example.com/link-preview.jpg',
      },
    }

    expect(imageSource(embed)).toBe(imageUri)
  })

  it('uses the thumbnail for an ordinary external article preview', () => {
    const thumbnail = 'https://example.com/article-preview.jpg'
    const embed: PostEmbed = {
      $type: 'social.coves.embed.external#view',
      external: {
        uri: 'https://example.com/article',
        title: 'Article',
        thumb: thumbnail,
      },
    }

    expect(imageSource(embed)).toBe(thumbnail)
  })

  it('uses the native image thumbnail rather than its full-size source', () => {
    const embed: PostEmbed = {
      $type: 'social.coves.embed.images#view',
      images: [
        {
          image: 'https://media.example/native-full.jpg',
          thumb: 'https://media.example/native-thumb.jpg',
          fullsize: 'https://media.example/native-full.jpg',
          alt: 'Native image',
        },
      ],
    }

    const source = imageSource(embed)
    expect(source).toContain('native-thumb.jpg')
    expect(source).not.toContain('native-full.jpg')
  })
})
