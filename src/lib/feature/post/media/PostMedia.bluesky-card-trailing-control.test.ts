import { expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { AtUri, CID, PostEmbed } from '$lib/api/coves/types'
import { mediaType } from '../helpers'
import PostMedia from './PostMedia.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const VALID_EMBED_URI =
  'at://did:plc:alice/app.bsky.feed.post/valid-fallback'
const SAFE_TEXT = 'The success card remains visible.'
const LF = String.fromCharCode(10)
const CR = String.fromCharCode(13)

const markup = (resolvedUri: string): string => {
  const embed: PostEmbed = {
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
        handle: 'sky.example',
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
  }

  return render(PostMedia, {
    props: { embed, type: mediaType(embed), view: 'cozy' as const },
  }).body
}

const originalPostHrefs = (html: string): string[] =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>/gi)]
    .map((match) => match[1])
    .filter((href) => href.includes('/post/'))

it.each([
  [
    'LF after the actor',
    `at://did:plc:alice${LF}/app.bsky.feed.post/resolved-key`,
  ],
  [
    'CR after the actor',
    `at://did:plc:alice${CR}/app.bsky.feed.post/resolved-key`,
  ],
  [
    'LF after the rkey',
    `at://did:plc:alice/app.bsky.feed.post/resolved-key${LF}`,
  ],
  [
    'CR after the rkey',
    `at://did:plc:alice/app.bsky.feed.post/resolved-key${CR}`,
  ],
])('keeps safe text but emits no original href for a trailing %s', (_label, uri) => {
  const html = markup(uri)
  expect(html).toContain(SAFE_TEXT)
  expect(originalPostHrefs(html)).toEqual([])
  expect(html).not.toContain('valid-fallback')
})
