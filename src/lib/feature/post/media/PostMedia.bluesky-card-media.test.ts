import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { AtUri, CID, PostEmbed } from '$lib/api/coves/types'
import { mediaType } from '../helpers'
import PostMedia from './PostMedia.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const PARENT_THUMB =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/parent@jpeg'
const PARENT_FULL =
  'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/parent@jpeg'
const QUOTE_THUMB =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:bob/quote@jpeg'
const QUOTE_FULL =
  'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:bob/quote@jpeg'
const PREVIEW_THUMB =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/preview@jpeg'

const resolvedPost = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  uri: 'at://did:plc:alice/app.bsky.feed.post/root',
  cid: 'bafyreiroot',
  author: {
    did: 'did:plc:alice',
    handle: 'sky.example',
    displayName: 'Sky Pilot',
  },
  text: 'Parent media positive control.',
  createdAt: '2026-09-18T14:30:00Z',
  replyCount: 1,
  repostCount: 2,
  likeCount: 3,
  mediaCount: 0,
  hasMedia: false,
  unavailable: false,
  ...overrides,
})

const embed = (resolved: unknown): PostEmbed => ({
  $type: 'social.coves.embed.post#view',
  post: {
    uri: 'at://did:plc:alice/app.bsky.feed.post/root' as AtUri,
    cid: 'bafyreiroot' as CID,
  },
  resolved,
})

const card = (resolved: unknown): HTMLDivElement => {
  const postEmbed = embed(resolved)
  const html = render(PostMedia, {
    props: {
      embed: postEmbed,
      type: mediaType(postEmbed),
      view: 'cozy' as const,
    },
  }).body
  const document = new JSDOM(`<div id="card">${html}</div>`).window.document
  const target = document.querySelector<HTMLDivElement>('#card')
  if (!target) throw new Error('Missing rendered card fixture')
  return target
}

const hasAspect = (
  image: HTMLImageElement,
  width: number,
  height: number,
): boolean => {
  if (
    image.getAttribute('width') === String(width) &&
    image.getAttribute('height') === String(height)
  ) {
    return true
  }
  const styled = image.closest<HTMLElement>('[style*="aspect-ratio"]')
  return Boolean(
    styled?.style.aspectRatio.replaceAll(' ', '') === `${width}/${height}`,
  )
}

describe('resolved Bluesky media', () => {
  it('renders parent and one-level quoted images with direct CDN URLs, alt text, and aspect ratios', () => {
    const target = card(
      resolvedPost({
        hasMedia: true,
        mediaCount: 1,
        images: [
          {
            thumb: PARENT_THUMB,
            fullsize: PARENT_FULL,
            alt: 'Parent ocean view',
            aspectRatio: { width: 1600, height: 900 },
          },
        ],
        quotedPost: resolvedPost({
          uri: 'at://did:plc:bob/app.bsky.feed.post/quote',
          cid: 'bafyrequote',
          author: {
            did: 'did:plc:bob',
            handle: 'weather.example',
            displayName: 'Weather Watch',
          },
          text: 'Quoted media positive control.',
          hasMedia: true,
          mediaCount: 1,
          images: [
            {
              thumb: QUOTE_THUMB,
              fullsize: QUOTE_FULL,
              alt: 'Quoted radar view',
              aspectRatio: { width: 4, height: 3 },
            },
          ],
        }),
      }),
    )

    const parent = target.querySelector<HTMLImageElement>(
      'img[alt="Parent ocean view"]',
    )
    const quote = target.querySelector<HTMLImageElement>(
      'img[alt="Quoted radar view"]',
    )
    expect(parent?.getAttribute('src')).toBe(PARENT_THUMB)
    expect(parent && hasAspect(parent, 1600, 900)).toBe(true)
    expect(quote?.getAttribute('src')).toBe(QUOTE_THUMB)
    expect(quote && hasAspect(quote, 4, 3)).toBe(true)
    expect(target.textContent).toContain('Quoted media positive control.')
  })

  it('renders a safe external preview with its direct thumbnail and visible metadata', () => {
    const target = card(
      resolvedPost({
        embed: {
          uri: 'https://news.example/weather/front',
          title: 'Coastal storm outlook',
          description: 'Timing and impacts for tonight.',
          thumb: PREVIEW_THUMB,
        },
      }),
    )

    const link = target.querySelector<HTMLAnchorElement>(
      'a[href="https://news.example/weather/front"]',
    )
    expect(link).not.toBeNull()
    expect(link?.textContent).toContain('news.example')
    expect(link?.textContent).toContain('Coastal storm outlook')
    expect(link?.textContent).toContain('Timing and impacts for tonight.')
    expect(link?.querySelector('img')?.getAttribute('src')).toBe(PREVIEW_THUMB)
    expect(link?.querySelector('a')).toBeNull()
  })

  it('keeps safe siblings while rejecting invalid CDN media and malformed runtime fields', () => {
    const safeAspectThumb =
      'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/aspect@jpeg'
    const target = card(
      resolvedPost({
        author: {
          did: 'did:plc:alice',
          handle: 'sky.example',
          displayName: 'Sky Pilot',
          avatar: 'https://evil.example/BAD_AVATAR',
        },
        hasMedia: true,
        mediaCount: 6,
        images: [
          {
            thumb: PARENT_THUMB,
            fullsize: PARENT_FULL,
            alt: 'Safe sibling image',
            aspectRatio: { width: 3, height: 2 },
          },
          {
            thumb: 'https://evil.example/BAD_HOST',
            fullsize: PARENT_FULL,
            alt: 'Bad host image',
          },
          {
            thumb: 'http://cdn.bsky.app/img/BAD_SCHEME',
            fullsize: PARENT_FULL,
            alt: 'Bad scheme image',
          },
          {
            thumb: 'https://cdn.bsky.app/not-img/BAD_PATH',
            fullsize: PARENT_FULL,
            alt: 'Bad path image',
          },
          {
            thumb:
              'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/malformed-alt@jpeg',
            fullsize:
              'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/malformed-alt@jpeg',
            alt: { text: 'MALFORMED_ALT_VALUE' },
          },
          {
            thumb: safeAspectThumb,
            fullsize:
              'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/aspect@jpeg',
            alt: 'Graceful malformed aspect',
            aspectRatio: { width: -1, height: 'MALFORMED_HEIGHT' },
          },
        ],
      }),
    )

    expect(
      target.querySelector('img[alt="Safe sibling image"]')?.getAttribute('src'),
    ).toBe(PARENT_THUMB)
    expect(target.innerHTML).not.toContain('BAD_AVATAR')
    expect(target.innerHTML).not.toContain('BAD_HOST')
    expect(target.innerHTML).not.toContain('BAD_SCHEME')
    expect(target.innerHTML).not.toContain('BAD_PATH')
    expect(target.innerHTML).not.toContain('MALFORMED_ALT_VALUE')

    const malformedAspect = target.querySelector<HTMLImageElement>(
      'img[alt="Graceful malformed aspect"]',
    )
    expect(malformedAspect?.getAttribute('src')).toBe(safeAspectThumb)
    expect(malformedAspect?.getAttribute('width')).not.toBe('-1')
    expect(target.innerHTML).not.toContain('MALFORMED_HEIGHT')
  })

  it('retains safe preview content when its thumbnail is invalid and suppresses an invalid preview URI', () => {
    const invalidThumbnail = card(
      resolvedPost({
        embed: {
          uri: 'https://news.example/safe-story',
          title: 'Safe story without an image',
          description: 'The link remains useful.',
          thumb: 'https://evil.example/BAD_PREVIEW_THUMB',
        },
      }),
    )
    expect(invalidThumbnail.textContent).toContain('Safe story without an image')
    expect(
      invalidThumbnail.querySelector(
        'a[href="https://news.example/safe-story"]',
      ),
    ).not.toBeNull()
    expect(invalidThumbnail.innerHTML).not.toContain('BAD_PREVIEW_THUMB')

    const invalidUri = card(
      resolvedPost({
        text: 'Parent survives an invalid preview.',
        embed: {
          uri: 'javascript:alert("BAD_PREVIEW_URI")',
          title: 'BAD_PREVIEW_TITLE',
          description: 'BAD_PREVIEW_DESCRIPTION',
          thumb: PREVIEW_THUMB,
        },
      }),
    )
    expect(invalidUri.textContent).toContain('Parent survives an invalid preview.')
    expect(invalidUri.innerHTML).not.toContain('BAD_PREVIEW_URI')
    expect(invalidUri.innerHTML).not.toContain('BAD_PREVIEW_TITLE')
    expect(invalidUri.innerHTML).not.toContain('BAD_PREVIEW_DESCRIPTION')
    expect(invalidUri.innerHTML).not.toContain(PREVIEW_THUMB)
  })
})

describe('legacy and quoted media boundaries', () => {
  it.each([
    ['legacy unknown media', 2],
    ['a resolved video without an image view', 1],
  ])('describes %s without claiming it contains images', (_label, mediaCount) => {
    const target = card(
      resolvedPost({
        text: 'Neutral media indicator positive control.',
        hasMedia: true,
        mediaCount,
      }),
    )

    expect(target.textContent).toContain('Neutral media indicator positive control.')
    expect(target.textContent).toContain(`Media: ${mediaCount}`)
    expect(target.textContent).not.toMatch(
      new RegExp(`${mediaCount}\\s+images?`, 'i'),
    )
  })

  it('renders an unavailable quoted fallback without leaking supplied identity or media', () => {
    const target = card(
      resolvedPost({
        quotedPost: {
          ...resolvedPost(),
          unavailable: true,
          message: 'The quoted Bluesky post is unavailable.',
          author: {
            did: 'did:plc:blocked',
            handle: 'BLOCKED_QUOTE_HANDLE',
            displayName: 'BLOCKED_QUOTE_AUTHOR',
            avatar:
              'https://cdn.bsky.app/img/avatar/plain/did:plc:blocked/BLOCKED_QUOTE_AVATAR',
          },
          text: 'BLOCKED_QUOTE_TEXT',
          images: [
            {
              thumb:
                'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:blocked/BLOCKED_QUOTE_MEDIA',
              fullsize:
                'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:blocked/BLOCKED_QUOTE_MEDIA',
              alt: 'BLOCKED_QUOTE_ALT',
            },
          ],
        },
      }),
    )

    expect(target.textContent).toContain('Parent media positive control.')
    expect(target.textContent).toContain(
      'The quoted Bluesky post is unavailable.',
    )
    expect(target.innerHTML).not.toContain('BLOCKED_QUOTE_HANDLE')
    expect(target.innerHTML).not.toContain('BLOCKED_QUOTE_AUTHOR')
    expect(target.innerHTML).not.toContain('BLOCKED_QUOTE_AVATAR')
    expect(target.innerHTML).not.toContain('BLOCKED_QUOTE_TEXT')
    expect(target.innerHTML).not.toContain('BLOCKED_QUOTE_MEDIA')
    expect(target.innerHTML).not.toContain('BLOCKED_QUOTE_ALT')
  })

  it('renders one quoted level and caps deeper quote content and media', () => {
    const target = card(
      resolvedPost({
        quotedPost: resolvedPost({
          uri: 'at://did:plc:bob/app.bsky.feed.post/quote',
          text: 'FIRST_LEVEL_QUOTE',
          images: [
            {
              thumb: QUOTE_THUMB,
              fullsize: QUOTE_FULL,
              alt: 'FIRST_LEVEL_IMAGE',
            },
          ],
          quotedPost: resolvedPost({
            uri: 'at://did:plc:carol/app.bsky.feed.post/deep',
            text: 'SECOND_LEVEL_QUOTE_MUST_NOT_RENDER',
            images: [
              {
                thumb:
                  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:carol/SECOND_LEVEL_MEDIA',
                fullsize:
                  'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:carol/SECOND_LEVEL_MEDIA',
                alt: 'SECOND_LEVEL_ALT',
              },
            ],
          }),
        }),
      }),
    )

    expect(target.textContent).toContain('FIRST_LEVEL_QUOTE')
    expect(target.querySelector('img[alt="FIRST_LEVEL_IMAGE"]')).not.toBeNull()
    expect(target.innerHTML).not.toContain('SECOND_LEVEL_QUOTE_MUST_NOT_RENDER')
    expect(target.innerHTML).not.toContain('SECOND_LEVEL_MEDIA')
    expect(target.innerHTML).not.toContain('SECOND_LEVEL_ALT')
  })
})
