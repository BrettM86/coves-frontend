import { expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { AtUri, CID, PostEmbed } from '$lib/api/coves/types'
import { mediaType } from '../helpers'
import PostMedia from './PostMedia.svelte'
import { JSDOM } from 'jsdom'
import {
  mockDefaultTimezone,
  NativeDateTimeFormat,
} from './bluesky-time.fixture'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const POST_IMAGE =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/bafkreipost@jpeg'
const PREVIEW_IMAGE =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:bob/bafkreipreview@jpeg'

const embed: PostEmbed = {
  $type: 'social.coves.embed.post#view',
  post: {
    uri: 'at://did:plc:alice/app.bsky.feed.post/root123' as AtUri,
    cid: 'bafyreiroot123' as CID,
  },
  resolved: {
    uri: 'at://did:plc:alice/app.bsky.feed.post/root123',
    cid: 'bafyreiroot123',
    author: {
      did: 'did:plc:alice',
      handle: 'sky.example',
      displayName: 'Sky <Pilot>',
      avatar:
        'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/bafkreiavatar@jpeg',
    },
    text: 'Launching <b>flight</b> & watching the coast.',
    createdAt: '2026-09-18T14:30:00Z',
    replyCount: 12,
    repostCount: 34,
    likeCount: 56,
    mediaCount: 1,
    hasMedia: true,
    unavailable: false,
    images: [
      {
        thumb: POST_IMAGE,
        fullsize:
          'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/bafkreipost@jpeg',
        alt: 'Storm front over the ocean',
        aspectRatio: { width: 1600, height: 900 },
      },
    ],
    quotedPost: {
      uri: 'at://did:plc:bob/app.bsky.feed.post/quote456',
      cid: 'bafyreibquote456',
      author: {
        did: 'did:plc:bob',
        handle: 'weather.example',
        displayName: 'Weather Watch',
        avatar:
          'https://cdn.bsky.app/img/avatar/plain/did:plc:bob/bafkrequoteavatar@jpeg',
      },
      text: 'The front reaches shore tonight.',
      createdAt: '2026-09-18T13:15:00Z',
      replyCount: 2,
      repostCount: 3,
      likeCount: 5,
      mediaCount: 0,
      hasMedia: false,
      unavailable: false,
      embed: {
        uri: 'https://example.net/weather/front',
        title: 'Coastal storm outlook',
        description: 'Timing and impacts for the approaching front.',
        thumb: PREVIEW_IMAGE,
      },
    },
  },
}

it('renders a resolved Bluesky post as a rich read-only card through PostMedia', () => {
  const html = render(PostMedia, {
    props: { embed, type: mediaType(embed), view: 'cozy' as const },
  }).body

  expect(html).toMatch(/Sky &lt;Pilot(?:>|&gt;)/)
  expect(html).toContain('@sky.example')
  expect(html).toContain('href="https://bsky.app/profile/sky.example"')
  expect(html).toMatch(
    /Launching &lt;b(?:>|&gt;)flight&lt;\/b(?:>|&gt;) &amp; watching the coast\./,
  )
  expect(html).not.toContain('<b>flight</b>')

  expect(html).toContain(`src="${POST_IMAGE}"`)
  expect(html).toContain('alt="Storm front over the ocean"')

  expect(html).toContain('Weather Watch')
  expect(html).toContain('@weather.example')
  expect(html).toContain('The front reaches shore tonight.')
  expect(html).toContain('href="https://example.net/weather/front"')
  expect(html).toContain(`src="${PREVIEW_IMAGE}"`)
  expect(html).toContain('example.net')
  expect(html).toContain('Coastal storm outlook')
  expect(html).toContain('Timing and impacts for the approaching front.')

  expect(html).toContain('2026-09-18T14:30:00Z')
  expect(html).toMatch(/aria-label="Replies: 12"/i)
  expect(html).toMatch(/aria-label="Reposts: 34"/i)
  expect(html).toMatch(/aria-label="Likes: 56"/i)
  expect(html).not.toContain('<button')

  expect(html).toContain(
    'href="https://bsky.app/profile/sky.example/post/root123"',
  )
  expect(html).toMatch(/View on Bluesky/i)
})

it.each(['America/Los_Angeles', 'Asia/Tokyo'])(
  'renders deterministic UTC timestamp text and accessible labels on the server in %s',
  (timeZone) => {
    mockDefaultTimezone(timeZone)
    const createdAt = '2026-09-20T00:05:00Z'
    const quotedCreatedAt = '2026-09-20T23:55:00Z'
    const resolved = embed.resolved as Record<string, unknown>
    const media: PostEmbed = {
      ...embed,
      resolved: {
        ...resolved,
        createdAt,
        quotedPost: {
          ...(resolved.quotedPost as Record<string, unknown>),
          createdAt: quotedCreatedAt,
        },
      },
    }
    const html = render(PostMedia, {
      props: { embed: media, type: mediaType(media), view: 'cozy' },
    }).body
    const dom = new JSDOM(html)
    try {
      expect(dom.window.document.querySelectorAll('time')).toHaveLength(2)
      for (const value of [createdAt, quotedCreatedAt]) {
        const time = dom.window.document.querySelector(
          `time[datetime="${value}"]`,
        )
        const label = new NativeDateTimeFormat('en', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(new Date(value))
        expect
          .soft(
            time?.querySelector(':scope > span[aria-hidden="true"]')
              ?.textContent?.trim(),
          )
          .toBe(
            new NativeDateTimeFormat('en', { timeZone: 'UTC' }).format(
              new Date(value),
            ),
          )
        expect.soft(time?.getAttribute('title')).toBe(label)
        expect.soft(time?.hasAttribute('aria-label')).toBe(false)
        expect.soft(time?.children).toHaveLength(2)
        const screenReaderLabel = time?.querySelector(':scope > span.sr-only')
        expect.soft(screenReaderLabel?.textContent?.trim()).toBe(label)
        expect
          .soft(screenReaderLabel?.getAttribute('aria-hidden'))
          .not.toBe('true')
      }
    } finally {
      dom.window.close()
    }
  },
)
