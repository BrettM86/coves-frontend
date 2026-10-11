/**
 * RSS autodiscovery on the community page: the server-rendered head advertises
 * the community's feed, for the sort the visitor is looking at.
 */
import { JSDOM } from 'jsdom'
import { render } from 'svelte/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.test' },
}))

import CommunityPage from './+page.svelte'

const COMMUNITY = {
  did: 'did:plc:gaming',
  handle: 'c-gaming.coves.test',
  name: 'gaming',
  origin: 'coves.test',
  displayName: 'Gaming Hub',
  subscriberCount: 3,
  memberCount: 3,
  postCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  allowExternalDiscovery: true,
}

/** The RSS alternates in the head of `/c/gaming<query>`, rendered on the server. */
function rssAlternates(
  query: string,
  params: { sort: string; timeframe?: string },
) {
  const { head } = render(CommunityPage, {
    // The shape `+page.ts` returns, with an empty feed.
    props: {
      data: {
        community: COMMUNITY,
        feed: [],
        params: { community: 'gaming', limit: 20, ...params },
        matchesServerRender: true,
        loadFeed: async () => ({ feed: [] }),
        virtualList: { itemHeights: [] },
      },
    } as never,
    context: new Map([
      [
        '__request__',
        {
          page: {
            url: new URL(`https://coves.test/c/gaming${query}`),
            params: { handle: 'gaming' },
            route: { id: '/c/[handle=handle]' },
          },
        },
      ],
    ]),
  })
  return Array.from(
    JSDOM.fragment(head).querySelectorAll(
      'link[rel="alternate"][type="application/rss+xml"]',
    ),
    (link) => ({
      href: link.getAttribute('href'),
      title: link.getAttribute('title'),
    }),
  )
}

beforeEach(() => {
  vi.stubGlobal('__VERSION__', 'test')
})

describe('community page RSS autodiscovery', () => {
  it("advertises the community's feed, named after the community", () => {
    // The server load resolves an unparameterised URL to `hot`; the feed's
    // own default is `new`, so the link must not carry the page's sort.
    const alternates = rssAlternates('', { sort: 'hot' })

    expect(alternates.map((alternate) => alternate.href)).toEqual([
      '/c/gaming/rss',
    ])
    expect(alternates[0]?.title).toContain('Gaming Hub')
  })

  it('carries the sort and timeframe in the page URL into the feed link', () => {
    const alternates = rssAlternates('?sort=top&timeframe=week', {
      sort: 'top',
      timeframe: 'week',
    })

    expect(alternates.map((alternate) => alternate.href)).toEqual([
      '/c/gaming/rss?sort=top&timeframe=week',
    ])
  })
})
