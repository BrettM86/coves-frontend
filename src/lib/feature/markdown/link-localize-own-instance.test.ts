import { describe, it, expect, vi } from 'vitest'
import { render } from 'svelte/server'
import Markdown from './Markdown.svelte'

// ---------------------------------------------------------------------------
// Acceptance: a markdown link to a user profile on our own Coves instance
// opens the in-app profile, and every other user link keeps its original
// href. "Own instance" is the origin of PUBLIC_INSTANCE_URL only — not the
// internal backend URL and not the community domain. Observed through the
// server-rendered Markdown component.
// ---------------------------------------------------------------------------

// The local-dev shape: the web origin, the internal backend and the community
// domain all differ, so each can be told apart.
vi.mock('$env/dynamic/public', () => ({
  env: {
    PUBLIC_INSTANCE_URL: 'http://127.0.0.1:8080',
    PUBLIC_INTERNAL_INSTANCE: 'http://127.0.0.1:8081',
    PUBLIC_INSTANCE_DOMAIN: 'coves.local',
  },
}))

/** Undo Svelte's attribute escaping so we compare the URL the browser sees. */
const decodeEntities = (value: string): string =>
  value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')

/** The href of every <a> element, in document order. */
const anchorHrefs = (html: string): string[] => {
  const anchor = /<a\b[^>]*?\shref="([^"]*)"/gi
  return [...html.matchAll(anchor)].map((match) =>
    decodeEntities(match[1] ?? ''),
  )
}

const renderMarkdown = (source: string): string =>
  render(Markdown, { props: { source } }).body

describe('markdown links to user profiles on our own instance', () => {
  it.each([
    {
      name: 'an own-instance /profile/<handle> link opens the in-app profile',
      source: '[a](http://127.0.0.1:8080/profile/mari.local.coves.dev)',
      expected: '/profile/mari.local.coves.dev',
    },
    {
      name: 'an own-instance /u/<did> link opens the in-app profile',
      source: '[a](http://127.0.0.1:8080/u/did:plc:abc123)',
      expected: '/profile/did:plc:abc123',
    },
    {
      name: 'a profile link on another Coves host keeps its original href',
      source: '[a](https://coves.social/profile/alice.bsky.social)',
      expected: 'https://coves.social/profile/alice.bsky.social',
    },
    {
      name: 'a dotted user name on another host keeps its original href',
      source: '[a](https://lemmy.world/u/alice.bsky.social)',
      expected: 'https://lemmy.world/u/alice.bsky.social',
    },
    {
      name: 'a profile link on the internal backend URL keeps its original href',
      source: '[a](http://127.0.0.1:8081/profile/alice.bsky.social)',
      expected: 'http://127.0.0.1:8081/profile/alice.bsky.social',
    },
    {
      name: 'a profile link on the community domain keeps its original href',
      source: '[a](https://coves.local/profile/alice.bsky.social)',
      expected: 'https://coves.local/profile/alice.bsky.social',
    },
  ])('$name', ({ source, expected }) => {
    expect(anchorHrefs(renderMarkdown(source))).toEqual([expected])
  })
})
