import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { CommunityViewDetailed } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import CommunityCard from './CommunityCard.svelte'

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

function renderCard(
  overrides: Pick<
    CommunityViewDetailed,
    'origin' | 'originSoftware' | 'originUrl'
  >,
): Document {
  const html = render(CommunityCard, {
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

describe('CommunityCard (sidebar card) origin link', () => {
  it.each([
    {
      originSoftware: 'lemmy',
      origin: 'lemmy.world',
      originUrl: 'https://lemmy.world/c/selfhosted',
      text: 'View on lemmy.world',
      logoAlt: 'Lemmy',
    },
    {
      originSoftware: 'piefed',
      origin: 'piefed.social',
      originUrl: 'https://piefed.social/c/tech',
      text: 'View on piefed.social',
      logoAlt: 'PieFed',
    },
    {
      originSoftware: 'mbin',
      origin: 'kbin.example',
      originUrl: 'https://kbin.example/m/tech',
      text: 'View on kbin.example',
      logoAlt: undefined,
    },
  ])(
    'links to the home instance for a bridged $originSoftware community',
    ({ originSoftware, origin, originUrl, text, logoAlt }) => {
      const links = viewOnLinks(
        renderCard({ origin, originSoftware, originUrl }),
      )
      expect(links).toHaveLength(1)
      const link = links[0]
      expect(visibleText(link)).toBe(text)
      expect(link.getAttribute('href')).toBe(originUrl)
      expect(link.getAttribute('target')).toBe('_blank')
      const rel = (link.getAttribute('rel') ?? '').split(/\s+/)
      expect(rel).toContain('noopener')
      expect(rel).toContain('noreferrer')
      if (logoAlt) {
        expect(link.querySelectorAll(`img[alt="${logoAlt}"]`)).toHaveLength(1)
      } else {
        expect(link.querySelector('img[alt="Lemmy"]')).toBeNull()
        expect(link.querySelector('img[alt="PieFed"]')).toBeNull()
      }
    },
  )

  it('shows no origin link for a native community without originUrl', () => {
    const links = viewOnLinks(renderCard({ origin: 'coves.social' }))
    expect(links).toHaveLength(0)
  })

  it('shows no origin link when originUrl uses a javascript: scheme', () => {
    const document = renderCard({
      origin: 'lemmy.world',
      originSoftware: 'lemmy',
      originUrl: 'javascript:alert(1)',
    })
    expect(viewOnLinks(document).length).toBe(0)
    expect(document.querySelectorAll('a[href^="javascript:"]').length).toBe(0)
  })

  it('shows no origin link when originUrl is not a URL', () => {
    const document = renderCard({
      origin: 'lemmy.world',
      originUrl: 'not a url',
    })
    expect(viewOnLinks(document).length).toBe(0)
  })

  it('labels the origin link with the originUrl host when origin is absent', () => {
    const links = viewOnLinks(
      renderCard({ originUrl: 'https://lemmy.world/c/selfhosted' }),
    )
    expect(links.length).toBe(1)
    expect(visibleText(links[0])).toBe('View on lemmy.world')
    expect(links[0].getAttribute('href')).toBe(
      'https://lemmy.world/c/selfhosted',
    )
  })
})
