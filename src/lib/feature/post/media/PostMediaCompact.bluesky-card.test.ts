import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { AtUri, CID, PostEmbed } from '$lib/api/coves/types'
import { mediaType } from '../helpers'
import PostMediaCompact from './PostMediaCompact.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const IMAGE_THUMB =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/compact@jpeg'
const IMAGE_FULL =
  'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/compact@jpeg'
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
  text: 'Compact media classification.',
  createdAt: '2026-09-18T14:30:00Z',
  replyCount: 1,
  repostCount: 2,
  likeCount: 3,
  mediaCount: 0,
  hasMedia: false,
  unavailable: false,
  ...overrides,
})

const blueskyEmbed = (resolved: unknown): PostEmbed => ({
  $type: 'social.coves.embed.post#view',
  post: {
    uri: 'at://did:plc:alice/app.bsky.feed.post/root' as AtUri,
    cid: 'bafyreiroot' as CID,
  },
  resolved,
})

const tile = (embed: PostEmbed): HTMLElement => {
  const html = render(PostMediaCompact, {
    props: { embed, type: mediaType(embed), view: 'compact' as const },
  }).body
  const target = new JSDOM(
    `<main>${html}</main>`,
  ).window.document.querySelector('main')
  if (!target) throw new Error('Missing compact media fixture')
  return target
}

describe('PostMediaCompact Bluesky dialog tile', () => {
  it.each([
    ['text only', {}],
    [
      'images',
      {
        hasMedia: true,
        mediaCount: 1,
        images: [{ thumb: IMAGE_THUMB, fullsize: IMAGE_FULL, alt: 'Ocean' }],
      },
    ],
    [
      'an external preview with thumbnail',
      {
        embed: {
          uri: 'https://news.example/story',
          title: 'Preview story',
          thumb: PREVIEW_THUMB,
        },
      },
    ],
    [
      'an external link without a thumbnail',
      { embed: { uri: 'https://news.example/story', title: 'Story' } },
    ],
    ['unknown or video media', { hasMedia: true, mediaCount: 1 }],
    ['unavailable', { unavailable: true }],
  ])('uses the same native dialog button for %s', (_label, overrides) => {
    const target = tile(
      blueskyEmbed(
        resolvedPost({
          ...overrides,
          author: {
            did: 'did:plc:alice',
            handle: 'sky.example',
            displayName: 'Sky Pilot',
            avatar:
              'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/avatar@jpeg',
          },
        }),
      ),
    )
    const button = target.querySelector<HTMLButtonElement>(
      'button[aria-label="Open Bluesky post"]',
    )
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-haspopup')).toBe('dialog')
    expect(button?.tabIndex).toBe(0)
    expect(button?.disabled).toBe(false)
    expect(button?.querySelector('svg[aria-hidden="true"] path')).not.toBeNull()
    expect(button?.textContent?.trim()).toBe('')
    expect(target.querySelectorAll('button')).toHaveLength(1)
    expect(target.querySelector('img')).toBeNull()
    expect(target.querySelector('a')).toBeNull()
    expect(target.querySelector('[aria-label="Bluesky post"]')).toBeNull()
    expect(target.querySelector('[role="dialog"]')).toBeNull()
    expect(target.innerHTML).not.toContain('cdn.bsky.app')
    expect(target.textContent).not.toContain('Sky Pilot')
    expect(target.textContent).not.toContain('Compact media classification.')
  })
})

describe('PostMediaCompact generic regression controls', () => {
  it('keeps an external preview non-interactive and a native image image-like', () => {
    const external: PostEmbed = {
      $type: 'social.coves.embed.external#view',
      external: {
        uri: 'https://example.com/article',
        title: 'Article',
        thumb: 'https://media.example/external.jpg',
      },
    }
    const externalTarget = tile(external)
    expect(externalTarget.querySelector('img')?.getAttribute('src')).toBe(
      'https://media.example/external.jpg',
    )
    expect(externalTarget.querySelector('[role="button"]')).toBeNull()

    const native: PostEmbed = {
      $type: 'social.coves.embed.images#view',
      images: [
        {
          image: 'https://media.example/native.jpg',
          thumb: 'https://media.example/native-thumb.jpg',
          fullsize: 'https://media.example/native.jpg',
          alt: 'Native image control',
        },
      ],
    }
    const nativeTarget = tile(native)
    expect(
      nativeTarget.querySelector('img[alt="Native image control"]'),
    ).not.toBeNull()
    expect(nativeTarget.querySelector('[role="button"]')).not.toBeNull()
  })
})
