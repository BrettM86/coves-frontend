import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type {
  AtUri,
  CID,
  ImageEmbed,
  ImagesWithAttachmentView,
} from '$lib/api/coves/types'
import PostMedia from './PostMedia.svelte'
import { galleryEmbed, mediaType } from '../helpers'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

/** Node.DOCUMENT_POSITION_FOLLOWING; the node test environment has no Node global. */
const DOCUMENT_POSITION_FOLLOWING = 4

const images: ImageEmbed = {
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
  ],
}

const withExternal: ImagesWithAttachmentView = {
  $type: 'social.coves.embed.imagesWithAttachment#view',
  images,
  attachment: {
    $type: 'social.coves.embed.external#viewExternal',
    uri: 'https://news.example.test/harbour-story',
    title: 'Harbour story',
    description: 'A story about the harbour',
    thumb: 'https://news.example.test/media/harbour-card.jpg',
    domain: 'news.example.test',
  },
}

const withPost = (uri: string): ImagesWithAttachmentView => ({
  $type: 'social.coves.embed.imagesWithAttachment#view',
  images,
  attachment: {
    $type: 'social.coves.embed.post#view',
    post: { uri: uri as AtUri, cid: 'bafyquoted' as CID },
  },
})

function renderCozy(embed: ImagesWithAttachmentView): Document {
  const { body } = render(PostMedia, {
    props: { embed, type: 'image', view: 'cozy' },
  })
  return new JSDOM(body).window.document
}

describe('PostMedia cozy: imagesWithAttachment with an external attachment', () => {
  it('renders both images as gallery tiles', () => {
    const document = renderCozy(withExternal)

    const first = document.querySelector('img[alt="First image"]')
    const second = document.querySelector('img[alt="Second image"]')
    expect(first?.getAttribute('src')).toBe(
      'https://img.coves.test/img/content_full/plain/did:plc:a/one',
    )
    expect(second?.getAttribute('src')).toBe(
      'https://img.coves.test/img/content_full/plain/did:plc:a/two',
    )
  })

  it("renders the link card with the attachment's URL, title and thumbnail below the gallery", () => {
    const document = renderCozy(withExternal)

    const card = document.querySelector(
      'a[href="https://news.example.test/harbour-story"]',
    )
    expect(card).not.toBeNull()
    expect(card?.textContent).toContain('Harbour story')
    expect(card?.querySelector('img')?.getAttribute('src')).toBe(
      'https://news.example.test/media/harbour-card.jpg',
    )

    const lastGalleryImage = document.querySelector('img[alt="Second image"]')
    expect(lastGalleryImage).not.toBeNull()
    if (!card || !lastGalleryImage) return
    expect(
      lastGalleryImage.compareDocumentPosition(card) &
        DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(card.contains(lastGalleryImage)).toBe(false)
  })
})

describe('PostMedia cozy: imagesWithAttachment with a strongRef post attachment', () => {
  it.each([
    {
      name: 'a Coves post',
      uri: 'at://did:plc:quoted/social.coves.community.post/quoted1',
    },
    {
      name: 'a Bluesky post',
      uri: 'at://did:plc:bskyauthor/app.bsky.feed.post/3kquoted',
    },
  ])(
    'quoting $name renders the images and no quote card, link card or error',
    ({ uri }) => {
      const document = renderCozy(withPost(uri))

      expect(
        document.querySelector('img[alt="First image"]')?.getAttribute('src'),
      ).toBe('https://img.coves.test/img/content_full/plain/did:plc:a/one')
      expect(
        document.querySelector('img[alt="Second image"]')?.getAttribute('src'),
      ).toBe('https://img.coves.test/img/content_full/plain/did:plc:a/two')

      const hrefs = [...document.querySelectorAll('a')].map((a) =>
        a.getAttribute('href'),
      )
      expect(hrefs).toEqual([])
      expect(
        document.querySelector('.post-link, .post-link-compact'),
      ).toBeNull()
      expect(document.body.innerHTML).not.toContain('at://')
      expect(document.body.textContent).not.toMatch(
        /unavailable|error|bluesky/i,
      )
    },
  )
})

describe('PostMedia cozy: imagesWithAttachment with every image placed', () => {
  const youtube = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  const withYoutube: ImagesWithAttachmentView = {
    ...withExternal,
    attachment: {
      $type: 'social.coves.embed.external#viewExternal',
      uri: youtube,
      title: 'Harbour video',
      thumb: 'https://news.example.test/media/harbour-video.jpg',
      domain: 'www.youtube.com',
    },
  }

  it('renders a YouTube attachment as the link card, not an iframe player', () => {
    const embed = galleryEmbed(withYoutube, [])
    const { body } = render(PostMedia, {
      props: { embed, type: mediaType(embed), view: 'cozy' },
    })
    const document = new JSDOM(body).window.document

    const card = document.querySelector(`a[href="${youtube}"]`)
    expect(card).not.toBeNull()
    expect(card?.closest('.post-link, .post-link-compact')).not.toBeNull()
    expect(card?.textContent).toContain('Harbour video')
    expect(card?.querySelector('img')?.getAttribute('src')).toBe(
      'https://news.example.test/media/harbour-video.jpg',
    )
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.querySelector('img[alt="First image"]')).toBeNull()
  })
})
