import { describe, it, expect, vi } from 'vitest'
import { render } from 'svelte/server'
import Markdown from './Markdown.svelte'

// Pin public env: single-argument localizeLink calls default to the origin of
// PUBLIC_INSTANCE_URL, so an ambient value would make these tests depend on it.
vi.mock('$env/dynamic/public', () => ({ env: {} }))

// ---------------------------------------------------------------------------
// Acceptance: a markdown link to a remote community page renders as the
// matching in-app route; a remote user link, or a link that only looks like a
// community link, keeps its original href. Own-instance profile links are
// covered in link-localize-own-instance.test.ts. Observed through the
// server-rendered Markdown component, so it covers the URL patterns,
// localizeLink and MdLink together.
// ---------------------------------------------------------------------------

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

describe('markdown links to user and community pages', () => {
  it.each([
    {
      name: 'a hyphenated community link localizes to its community route',
      source: '[c](https://lemmy.world/c/my-community)',
      expected: '/c/my-community@lemmy.world',
    },
    {
      name: 'a hyphenated user link keeps its original href',
      source: '[u](https://lemmy.world/u/my-user)',
      expected: 'https://lemmy.world/u/my-user',
    },
    {
      name: 'a hyphenated legacy DNS-handle community link keeps its original href',
      source: '[c](https://coves.social/c/retro-gaming.coves.social)',
      expected: 'https://coves.social/c/retro-gaming.coves.social',
    },
    {
      name: 'a community-shaped link with a path in its name keeps its original href',
      source: '[x](https://evil.test/c//attacker.example/pwn)',
      expected: 'https://evil.test/c//attacker.example/pwn',
    },
  ])('$name', ({ source, expected }) => {
    expect(anchorHrefs(renderMarkdown(source))).toEqual([expected])
  })
})
