import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { AtUri, CID, PostEmbed, PostView } from '$lib/api/coves/types'
import { settings } from '$lib/app/state/settings.svelte'
import type { DID, Handle } from '$lib/types/atproto'
import Post from './Post.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const AVATAR = 'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/avatar@jpeg'
const POST_THUMB =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/post@jpeg'
const POST_FULL =
  'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/post@jpeg'
const PREVIEW_THUMB =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/preview@jpeg'
const TEXT_START = 'Compact Bluesky text starts here.'
const TEXT_END = 'COMPACT_TEXT_END_MUST_NOT_RENDER'

const blueskyEmbed = (): PostEmbed => ({
  $type: 'social.coves.embed.post#view',
  post: {
    uri: 'at://did:plc:alice/app.bsky.feed.post/root' as AtUri,
    cid: 'bafyreibluesky' as CID,
  },
  resolved: {
    uri: 'at://did:plc:alice/app.bsky.feed.post/root',
    cid: 'bafyreibluesky',
    author: {
      did: 'did:plc:alice',
      handle: 'sky.example',
      displayName: 'Sky Pilot',
      avatar: AVATAR,
    },
    text: `${TEXT_START} ${'Long selectable text. '.repeat(20)}${TEXT_END}`,
    createdAt: '2026-09-18T14:30:00Z',
    replyCount: 12,
    repostCount: 34,
    likeCount: 56,
    mediaCount: 1,
    hasMedia: true,
    unavailable: false,
    images: [
      {
        thumb: POST_THUMB,
        fullsize: POST_FULL,
        alt: 'Bluesky compact ocean view',
      },
    ],
    embed: {
      uri: 'https://news.example/story',
      title: 'FULL_PREVIEW_TITLE',
      description: 'FULL_PREVIEW_DESCRIPTION',
      thumb: PREVIEW_THUMB,
    },
    quotedPost: {
      uri: 'at://did:plc:bob/app.bsky.feed.post/quote',
      cid: 'bafyreiquote',
      author: {
        did: 'did:plc:bob',
        handle: 'weather.example',
        displayName: 'Weather Watch',
      },
      text: 'FULL_QUOTED_POST_TEXT',
      createdAt: '2026-09-18T13:00:00Z',
      replyCount: 1,
      repostCount: 2,
      likeCount: 3,
      mediaCount: 0,
      hasMedia: false,
      unavailable: false,
    },
  },
})

const fixture = (embed: PostEmbed = blueskyEmbed()): PostView =>
  ({
    uri: 'at://did:plc:author/social.coves.community.post/root' as AtUri,
    rkey: 'root',
    cid: 'bafyreicoves' as CID,
    indexedAt: '2026-09-18T15:00:00Z',
    createdAt: '2026-09-18T15:00:00Z',
    author: {
      did: 'did:plc:author' as DID,
      handle: 'author.example' as Handle,
    },
    community: { did: 'did:plc:community' as DID, name: 'Community' },
    record: {
      $type: 'social.coves.community.post',
      title: 'Coves wrapper title',
      author: 'did:plc:author',
      community: 'did:plc:community',
      createdAt: '2026-09-18T15:00:00Z',
    },
    embed,
  }) as PostView

const renderedPost = (
  view: 'cozy' | 'compact',
  expandBody = false,
): HTMLElement => {
  const html = render(Post, {
    props: { post: fixture(), view, expandBody, actions: false },
  }).body
  const target = new JSDOM(
    `<main>${html}</main>`,
  ).window.document.querySelector('main')
  if (!target) throw new Error('Missing rendered Post fixture')
  return target
}

afterEach(() => {
  settings.openLinksInNewTab = false
})

describe('Bluesky card through the real Post dispatcher', () => {
  it('renders only a Bluesky dialog trigger in compact view, with no inline card or remote images', () => {
    settings.openLinksInNewTab = true
    const target = renderedPost('compact')
    const button = target.querySelector<HTMLButtonElement>(
      'button[aria-label="Open Bluesky post"]',
    )

    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-haspopup')).toBe('dialog')
    expect(button?.querySelector('svg')).not.toBeNull()
    expect(target.querySelector('[aria-label="Bluesky post"]')).toBeNull()
    expect(target.querySelector('[role="dialog"]')).toBeNull()
    expect(target.querySelectorAll('img')).toHaveLength(0)
    for (const source of [AVATAR, POST_THUMB, POST_FULL, PREVIEW_THUMB]) {
      expect(target.innerHTML).not.toContain(source)
    }
    expect(target.textContent).not.toContain('Sky Pilot')
    expect(target.textContent).not.toContain('@sky.example')
    expect(target.textContent).not.toContain(TEXT_START)
    expect(target.textContent).not.toContain(TEXT_END)
    expect(target.textContent).not.toContain('FULL_QUOTED_POST_TEXT')
    expect(target.textContent).not.toContain('FULL_PREVIEW_TITLE')
    expect(target.querySelector('a[href^="https://bsky.app/"]')).toBeNull()
  })

  it.each([
    ['feed', false],
    ['detail', true],
  ] as const)(
    'keeps the full card in cozy %s rendering',
    (_context, expandBody) => {
      const target = renderedPost('cozy', expandBody)
      expect(target.textContent).toContain('Sky Pilot')
      expect(target.textContent).toContain(TEXT_END)
      expect(target.textContent).toContain('FULL_QUOTED_POST_TEXT')
      expect(target.textContent).toContain('FULL_PREVIEW_TITLE')
      expect(target.querySelector(`img[src="${POST_THUMB}"]`)).not.toBeNull()
      expect(
        target.querySelector('time[datetime="2026-09-18T14:30:00Z"]'),
      ).not.toBeNull()
      expect(target.querySelector('[aria-label="Replies: 12"]')).not.toBeNull()
    },
  )
})

describe('non-Bluesky Post media regression controls', () => {
  it('keeps generic external and native image compact thumbnails distinct', () => {
    const externalThumb = 'https://media.example/article-thumb.jpg'
    const external: PostEmbed = {
      $type: 'social.coves.embed.external#view',
      external: {
        uri: 'https://example.com/article',
        title: 'Generic article',
        thumb: externalThumb,
      },
    }
    const externalHtml = render(Post, {
      props: { post: fixture(external), view: 'compact', actions: false },
    }).body
    expect(externalHtml).toContain('href="https://example.com/article"')
    expect(externalHtml).toContain(`src="${externalThumb}"`)

    const native: PostEmbed = {
      $type: 'social.coves.embed.images#view',
      images: [
        {
          image: 'https://media.example/native.jpg',
          thumb: 'https://media.example/native-thumb.jpg',
          fullsize: 'https://media.example/native.jpg',
          alt: 'Generic native image',
        },
      ],
    }
    const nativeHtml = render(Post, {
      props: { post: fixture(native), view: 'compact', actions: false },
    }).body
    expect(nativeHtml).toContain('Generic native image')
    expect(nativeHtml).toContain('native-thumb.jpg')
    expect(nativeHtml).not.toContain('Generic article')
  })
})
