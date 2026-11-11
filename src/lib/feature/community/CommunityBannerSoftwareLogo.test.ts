import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { CommunityViewDetailed } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import CommunityCard from './CommunityCard.svelte'
import CommunityHeader from './CommunityHeader.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const community: CommunityViewDetailed = {
  did: 'did:plc:comm' as DID,
  handle: 'gardening.local.coves.dev' as Handle,
  name: 'gardening',
  origin: 'lemmy.world',
  subscriberCount: 12,
  memberCount: 3,
  postCount: 40,
  createdAt: '2026-10-01T00:00:00Z',
  allowExternalDiscovery: true,
}

// The community page renders CommunityHeader as the banner above the feed
// (src/routes/c/[handle=handle]/+page.svelte) and CommunityCard as the
// sidebar card (the sidebar slot in +page.ts). Both show the community handle.
const banners = [
  { banner: 'CommunityHeader (page banner)', component: CommunityHeader },
  { banner: 'CommunityCard (sidebar card)', component: CommunityCard },
]

function renderBanner(
  component: typeof CommunityHeader | typeof CommunityCard,
  originSoftware: string | undefined,
): Document {
  const html = render(component as typeof CommunityHeader, {
    props: { community: { ...community, originSoftware } },
  }).body
  return new JSDOM(html).window.document
}

describe('community banner software logo', () => {
  describe.each(banners)('$banner', ({ component }) => {
    it.each([
      { originSoftware: 'lemmy', alt: 'Lemmy' },
      { originSoftware: 'piefed', alt: 'PieFed' },
    ])(
      'shows the $alt logo for originSoftware $originSoftware',
      ({ originSoftware, alt }) => {
        const logos = renderBanner(component, originSoftware).querySelectorAll(
          `img[alt="${alt}"]`,
        )
        expect(logos).toHaveLength(1)
        expect(logos[0].hasAttribute('title')).toBe(false)
      },
    )

    it.each([
      { case: 'absent', originSoftware: undefined },
      { case: 'empty', originSoftware: '' },
      { case: 'unrelated software', originSoftware: 'mbin' },
    ])(
      'shows no software logo when originSoftware is $case',
      ({ originSoftware }) => {
        const document = renderBanner(component, originSoftware)
        expect(document.querySelector('img[alt="Lemmy"]')).toBeNull()
        expect(document.querySelector('img[alt="PieFed"]')).toBeNull()
      },
    )
  })
})
