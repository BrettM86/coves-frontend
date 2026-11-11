import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { CommunityViewDetailed } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import CommunityHeader from './CommunityHeader.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const community: CommunityViewDetailed = {
  did: 'did:plc:comm' as DID,
  handle: 'gardening.local.coves.dev' as Handle,
  name: 'gardening',
  subscriberCount: 12,
  memberCount: 3,
  postCount: 40,
  createdAt: '2026-10-01T00:00:00Z',
  allowExternalDiscovery: true,
}

function renderHeader(
  overrides: Pick<
    CommunityViewDetailed,
    'origin' | 'originSoftware' | 'originUrl'
  >,
): Document {
  const html = render(CommunityHeader, {
    props: { community: { ...community, ...overrides } },
  }).body
  return new JSDOM(html).window.document
}

function visibleText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function viewOnLinks(document: Document): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll('a')).filter((anchor) =>
    visibleText(anchor).startsWith('View on'),
  )
}

// On phones the sidebar card (which carries the "View on" link) is hidden, so
// the page banner must carry the link too.
describe('CommunityHeader (page banner) origin link', () => {
  it.each([
    {
      originSoftware: 'lemmy',
      origin: 'lemmy.world',
      originUrl: 'https://lemmy.world/c/selfhosted',
      text: 'View on lemmy.world',
    },
    {
      originSoftware: 'piefed',
      origin: 'piefed.social',
      originUrl: 'https://piefed.social/c/tech',
      text: 'View on piefed.social',
    },
  ])(
    'links to the home instance for a bridged $originSoftware community',
    ({ originSoftware, origin, originUrl, text }) => {
      const links = viewOnLinks(
        renderHeader({ origin, originSoftware, originUrl }),
      )
      expect(links).toHaveLength(1)
      const link = links[0]
      expect(visibleText(link)).toBe(text)
      expect(link.getAttribute('href')).toBe(originUrl)
      expect(link.getAttribute('target')).toBe('_blank')
      const rel = (link.getAttribute('rel') ?? '').split(/\s+/)
      expect(rel).toContain('noopener')
      expect(rel).toContain('noreferrer')
    },
  )

  it('shows no origin link for a native community without originUrl', () => {
    const document = renderHeader({ origin: 'coves.social' })
    expect(viewOnLinks(document)).toHaveLength(0)
    expect(
      document.querySelector(
        'a[target="_blank"][href^="https://coves.social"]',
      ),
    ).toBeNull()
  })
})
