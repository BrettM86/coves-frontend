import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type {
  AtUri,
  CommunityRef,
  CommunityViewDetailed,
} from '$lib/api/coves/types'
import { settings } from '$lib/app/state/settings.svelte'
import type { DID, Handle } from '$lib/types/atproto'
import PostMeta from '../post/PostMeta.svelte'
import CommunityCard from './CommunityCard.svelte'
import CommunityHeader from './CommunityHeader.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const POST_URI =
  'at://did:plc:author/social.coves.community.postv2/3lrkey' as AtUri

const communityRef: CommunityRef = {
  did: 'did:plc:comm' as DID,
  handle: 'gardening.local.coves.dev' as Handle,
  name: 'gardening',
}

const community: CommunityViewDetailed = {
  did: 'did:plc:comm' as DID,
  handle: 'gardening.local.coves.dev' as Handle,
  name: 'gardening',
  origin: 'lemmy.world',
  originUrl: 'https://lemmy.world/c/gardening',
  subscriberCount: 12,
  memberCount: 3,
  postCount: 40,
  createdAt: '2026-10-01T00:00:00Z',
  allowExternalDiscovery: true,
}

function toDocument(html: string): Document {
  return new JSDOM(html).window.document
}

// Every place a community software logo appears.
const placements = [
  {
    placement: 'PostMeta (feed post header)',
    renderWith: (originSoftware: string) =>
      toDocument(
        render(PostMeta, {
          props: {
            feed: true,
            uri: POST_URI,
            title: 'Companion planting',
            community: { ...communityRef, originSoftware },
            user: {
              did: 'did:plc:author' as DID,
              handle: 'mari.local.coves.dev' as Handle,
            },
            published: new Date('2026-10-01T00:00:00Z'),
          },
        }).body,
      ),
  },
  {
    placement: 'PostMeta (default post header)',
    renderWith: (originSoftware: string) =>
      toDocument(
        render(PostMeta, {
          props: {
            feed: false,
            uri: POST_URI,
            title: 'Companion planting',
            community: { ...communityRef, originSoftware },
            user: {
              did: 'did:plc:author' as DID,
              handle: 'mari.local.coves.dev' as Handle,
            },
            published: new Date('2026-10-01T00:00:00Z'),
          },
        }).body,
      ),
  },
  {
    placement: 'CommunityHeader (page banner)',
    renderWith: (originSoftware: string) =>
      toDocument(
        render(CommunityHeader, {
          props: { community: { ...community, originSoftware } },
        }).body,
      ),
  },
  {
    placement: 'CommunityCard (sidebar card)',
    renderWith: (originSoftware: string) =>
      toDocument(
        render(CommunityCard, {
          props: { community: { ...community, originSoftware } },
        }).body,
      ),
  },
]

let previous: boolean

beforeEach(() => {
  previous = settings.showSoftwareLogos
})

afterEach(() => {
  settings.showSoftwareLogos = previous
})

describe('showSoftwareLogos setting', () => {
  describe.each(placements)('$placement', ({ renderWith }) => {
    it.each([
      { originSoftware: 'lemmy', alt: 'Lemmy' },
      { originSoftware: 'piefed', alt: 'PieFed' },
    ])(
      'shows no $alt logo for originSoftware $originSoftware when the setting is off',
      ({ originSoftware }) => {
        settings.showSoftwareLogos = false
        const document = renderWith(originSoftware)
        // Counts, not elements: a failing matcher on a jsdom node trips over
        // the opaque-origin localStorage while printing it.
        expect(document.querySelectorAll('img[alt="Lemmy"]').length).toBe(0)
        expect(document.querySelectorAll('img[alt="PieFed"]').length).toBe(0)
      },
    )

    it.each([
      { originSoftware: 'lemmy', alt: 'Lemmy' },
      { originSoftware: 'piefed', alt: 'PieFed' },
    ])(
      'shows the $alt logo for originSoftware $originSoftware when the setting is on',
      ({ originSoftware, alt }) => {
        settings.showSoftwareLogos = true
        const document = renderWith(originSoftware)
        expect(
          document.querySelectorAll(`img[alt="${alt}"]`).length,
        ).toBeGreaterThan(0)
      },
    )
  })

  it('keeps the sidebar card "View on lemmy.world" link when the setting is off', () => {
    settings.showSoftwareLogos = false
    const document = toDocument(
      render(CommunityCard, {
        props: { community: { ...community, originSoftware: 'lemmy' } },
      }).body,
    )
    const links = Array.from(document.querySelectorAll('a')).filter(
      (anchor) =>
        (anchor.textContent ?? '').replace(/\s+/g, ' ').trim() ===
        'View on lemmy.world',
    )
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe(
      'https://lemmy.world/c/gardening',
    )
    expect(links[0].querySelectorAll('img').length).toBe(0)
  })
})
