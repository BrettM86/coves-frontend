import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { AtUri, CID, PostEmbed, PostView } from '$lib/api/coves/types'
import { type View, settings } from '$lib/app/state/settings.svelte'
import type { DID, Handle } from '$lib/types/atproto'
import Post from './Post.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const BLUESKY_TEXT = 'Shipping the new release today'

const blueskyEmbed = (text: string): PostEmbed => ({
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
    },
    text,
    createdAt: '2026-09-18T14:30:00Z',
    replyCount: 0,
    repostCount: 0,
    likeCount: 0,
    mediaCount: 0,
    hasMedia: false,
    unavailable: false,
  },
})

const linkEmbed = (title: string): PostEmbed => ({
  $type: 'social.coves.embed.external#view',
  external: { uri: 'https://example.com/article', title },
})

function fixture(title: string, embed: PostEmbed, labels?: unknown): PostView {
  return {
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
      title,
      labels,
      author: 'did:plc:author',
      community: 'did:plc:community',
      createdAt: '2026-09-18T15:00:00Z',
    },
    embed,
  }
}

function rendered(post: PostView, view: View): HTMLElement {
  const html = render(Post, { props: { post, view, actions: false } }).body
  const target = new JSDOM(
    `<main>${html}</main>`,
  ).window.document.querySelector('main')
  if (!target) throw new Error('Missing rendered Post fixture')
  return target
}

const heading = (target: HTMLElement): string | undefined =>
  target.querySelector('h3')?.textContent?.trim()

const cardText = (target: HTMLElement): string | undefined =>
  target.querySelector('[aria-label="Bluesky post"]')?.textContent ?? undefined

const previous = {
  deduplicateEmbed: settings.posts.deduplicateEmbed,
  nsfwBlur: settings.nsfwBlur,
  view: settings.view,
}

beforeEach(() => {
  settings.posts.deduplicateEmbed = true
  settings.nsfwBlur = true
  settings.view = 'cozy'
})

afterEach(() => {
  settings.posts.deduplicateEmbed = previous.deduplicateEmbed
  settings.nsfwBlur = previous.nsfwBlur
  settings.view = previous.view
})

describe('Bluesky post title deduplication', () => {
  it('hides the title heading when it repeats the Bluesky post text', () => {
    const target = rendered(
      fixture(BLUESKY_TEXT, blueskyEmbed(BLUESKY_TEXT)),
      'cozy',
    )
    expect(heading(target)).toBeUndefined()
    expect(cardText(target)).toContain(BLUESKY_TEXT)
  })

  it('shows the title heading when it differs from the Bluesky post text', () => {
    const target = rendered(
      fixture('A different headline', blueskyEmbed(BLUESKY_TEXT)),
      'cozy',
    )
    expect(heading(target)).toBe('A different headline')
    expect(cardText(target)).toContain(BLUESKY_TEXT)
  })

  it('keeps the duplicate title heading in compact view', () => {
    const target = rendered(
      fixture(BLUESKY_TEXT, blueskyEmbed(BLUESKY_TEXT)),
      'compact',
    )
    expect(heading(target)).toBe(BLUESKY_TEXT)
  })

  it('keeps the duplicate title heading when embed deduplication is off', () => {
    settings.posts.deduplicateEmbed = false
    const target = rendered(
      fixture(BLUESKY_TEXT, blueskyEmbed(BLUESKY_TEXT)),
      'cozy',
    )
    expect(heading(target)).toBe(BLUESKY_TEXT)
  })

  it('keeps the duplicate title heading while the NSFW post is concealed', () => {
    const target = rendered(
      fixture(BLUESKY_TEXT, blueskyEmbed(BLUESKY_TEXT), {
        values: [{ val: 'nsfw' }],
      }),
      'cozy',
    )
    expect(heading(target)).toBe(BLUESKY_TEXT)
    expect(cardText(target)).toBeUndefined()
  })
})

describe('link card title deduplication', () => {
  it('hides the title heading when the link title equals it exactly', () => {
    const target = rendered(
      fixture('Example Article', linkEmbed('Example Article')),
      'cozy',
    )
    expect(heading(target)).toBeUndefined()
  })

  it('shows the title heading when the link title differs only in whitespace', () => {
    const target = rendered(
      fixture('Example Article', linkEmbed('Example  Article ')),
      'cozy',
    )
    expect(heading(target)).toBe('Example Article')
  })
})
