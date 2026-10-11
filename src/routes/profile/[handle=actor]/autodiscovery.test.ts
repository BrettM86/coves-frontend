/**
 * RSS autodiscovery on the profile page: the server-rendered head advertises
 * both of the user's feeds, posts and comments.
 */
import { JSDOM } from 'jsdom'
import { render } from 'svelte/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReactiveState } from '$lib/app/util/reactive.svelte'

vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.test' },
}))

import ProfilePage from './+page.svelte'

beforeEach(() => {
  vi.stubGlobal('__VERSION__', 'test')
})

describe('profile page RSS autodiscovery', () => {
  it("advertises the user's posts feed and comments feed", () => {
    const { head } = render(ProfilePage, {
      // The shape `+page.ts` returns, for a user with no posts or comments.
      props: {
        data: {
          data: new ReactiveState({
            profile: {
              did: 'did:plc:alice',
              handle: 'alice.coves.test',
              displayName: 'Alice',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            posts: { feed: [] },
            comments: { comments: [] },
          }),
        },
      } as never,
      context: new Map([
        [
          '__request__',
          {
            page: {
              url: new URL('https://coves.test/profile/alice.coves.test'),
              params: { handle: 'alice.coves.test' },
              route: { id: '/profile/[handle=actor]' },
            },
          },
        ],
      ]),
    })

    const alternates = Array.from(
      JSDOM.fragment(head).querySelectorAll(
        'link[rel="alternate"][type="application/rss+xml"]',
      ),
      (link) => ({
        href: link.getAttribute('href'),
        title: link.getAttribute('title'),
      }),
    )

    expect(alternates.map((alternate) => alternate.href).sort()).toEqual([
      '/profile/alice.coves.test/rss',
      '/profile/alice.coves.test/rss?type=comments',
    ])
    // Feed readers list alternates by title, so the two must differ.
    const titles = alternates.map((alternate) => alternate.title ?? '')
    expect(new Set(titles).size).toBe(2)
    expect(titles.every((title) => title.includes('Alice'))).toBe(true)
  })
})
