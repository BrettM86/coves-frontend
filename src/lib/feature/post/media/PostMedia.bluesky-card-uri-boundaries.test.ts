import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { AtUri, CID, PostEmbed } from '$lib/api/coves/types'
import { mediaType } from '../helpers'
import PostMedia from './PostMedia.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const VALID_EMBED_URI =
  'at://did:plc:alice/app.bsky.feed.post/embed-fallback'
const SAFE_TEXT = 'Safe resolved text remains visible.'

const embed = (resolvedUri: string, handle = 'sky.example'): PostEmbed => ({
  $type: 'social.coves.embed.post#view',
  post: {
    uri: VALID_EMBED_URI as AtUri,
    cid: 'bafyreifallback' as CID,
  },
  resolved: {
    uri: resolvedUri,
    cid: 'bafyreiresolved',
    author: {
      did: 'did:plc:alice',
      handle,
      displayName: 'Sky Pilot',
    },
    text: SAFE_TEXT,
    createdAt: '2026-09-18T14:30:00Z',
    replyCount: 1,
    repostCount: 2,
    likeCount: 3,
    mediaCount: 0,
    hasMedia: false,
    unavailable: false,
  },
})

const markup = (resolvedUri: string, handle?: string): string => {
  const postEmbed = embed(resolvedUri, handle)
  return render(PostMedia, {
    props: {
      embed: postEmbed,
      type: mediaType(postEmbed),
      view: 'cozy' as const,
    },
  }).body
}

const originalPostHrefs = (html: string): string[] =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>/gi)]
    .map((match) => match[1])
    .filter((href) => href.includes('/post/'))

const expectSafeCardWithoutOriginal = (resolvedUri: string): void => {
  const html = markup(resolvedUri)
  expect(html).toContain(SAFE_TEXT)
  expect(originalPostHrefs(html)).toEqual([])
  expect(html).not.toContain('embed-fallback')
}

describe('Bluesky original URL rejects invalid record keys', () => {
  it.each([
    ['dot', '.'],
    ['dot-dot', '..'],
    ['whitespace', 'post key'],
    ['ASCII control', `post${String.fromCharCode(1)}key`],
    ['backslash', 'post\\key'],
    ['encoded slash', 'post%2Fkey'],
    ['encoded backslash', 'post%5Ckey'],
    ['double-encoded slash', 'post%252Fkey'],
    ['illegal percent', 'post%key'],
    ['overlong key', 'k'.repeat(513)],
  ])('keeps the card but omits the original link for a %s rkey', (_label, rkey) => {
    expectSafeCardWithoutOriginal(
      `at://did:plc:alice/app.bsky.feed.post/${rkey}`,
    )
  })
})

describe('Bluesky original URL rejects invalid actors', () => {
  it.each([
    ['whitespace', 'did:plc:ali ce'],
    ['ASCII control', `did:plc:ali${String.fromCharCode(1)}ce`],
    ['backslash', 'did:plc:ali\\ce'],
    ['single-label non-DID', 'alice'],
    ['leading handle hyphen', '-alice.example'],
    ['empty handle label', 'alice..example'],
    ['uppercase DID method', 'did:PLC:alice'],
    ['empty DID identifier', 'did:plc:'],
    ['encoded actor separator', 'did:plc:alice%2Fextra'],
  ])('keeps the card but omits the original link for %s', (_label, actor) => {
    expectSafeCardWithoutOriginal(
      `at://${actor}/app.bsky.feed.post/resolved-key`,
    )
  })
})

describe('Bluesky original URL requires the exact anchored collection', () => {
  it.each([
    'at://did:plc:alice/app.bsky.feed.post.extra/resolved-key',
    'at://did:plc:alice/prefix.app.bsky.feed.post/resolved-key',
    'at://did:plc:alice/app.bsky.feed.post/resolved-key/extra',
    'prefix:at://did:plc:alice/app.bsky.feed.post/resolved-key',
    'at://did:plc:alice/app.bsky.feed.post/resolved-key#fragment',
  ])('rejects %s', (resolvedUri) => {
    expectSafeCardWithoutOriginal(resolvedUri)
  })

  it.each([
    [
      'DID authority with owned handle substitution',
      'at://did:plc:alice/app.bsky.feed.post/resolved-key',
      'sky.example',
      'https://bsky.app/profile/sky.example/post/resolved-key',
    ],
    [
      'handle authority',
      'at://sky.example/app.bsky.feed.post/resolved-key',
      'sky.example',
      'https://bsky.app/profile/sky.example/post/resolved-key',
    ],
    [
      'DID authority without a usable handle',
      'at://did:plc:alice/app.bsky.feed.post/resolved-key',
      'handle.invalid',
      'https://bsky.app/profile/did%3Aplc%3Aalice/post/resolved-key',
    ],
  ])('accepts a valid %s', (_label, resolvedUri, handle, expectedHref) => {
    const html = markup(resolvedUri, handle)
    expect(html).toContain(SAFE_TEXT)
    expect(originalPostHrefs(html)).toEqual([expectedHref])
  })
})
