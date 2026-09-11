import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { ComponentProps } from 'svelte'
import { settings } from '$lib/app/state/settings.svelte'
import ProfilePage from './profile/[handle=actor]/+page.svelte'
import HomePage from './+page.svelte'
import PostListShell from '$lib/feature/shell/PostListShell.svelte'
import Navbar from '$lib/feature/shell/navbar/Navbar.svelte'

vi.stubGlobal('__VERSION__', 'test')

function context(path: string) {
  return new Map([
    ['__request__', { page: { url: new URL(path, 'https://coves.test') } }],
  ])
}

function nextLinks(html: string): URL[] {
  return (html.match(/<a\b[^>]*>/g) ?? [])
    .filter((tag) => tag.includes('title="Next"'))
    .map((tag) => {
      const href = /href="([^"]+)"/.exec(tag)?.[1]
      if (!href) throw new Error('Next link has no href')
      return new URL(href.replaceAll('&amp;', '&'), 'https://coves.test')
    })
}

beforeEach(() => {
  settings.infiniteScroll = false
})

describe('cursor pagination rendered navigation', () => {
  it('gives profile posts and comments independent, encoded continuation links', () => {
    const data = {
      data: {
        value: {
          profile: {
            did: 'did:plc:alice',
            handle: 'alice.test',
            createdAt: '2026-09-01T00:00:00Z',
          },
          posts: { feed: [], cursor: 'posts+/=2' },
          comments: { comments: [], cursor: 'comments+/=2' },
        },
      },
    } as unknown as ComponentProps<typeof ProfilePage>['data']
    const html = render(ProfilePage, {
      props: { data },
      context: context(
        '/profile/alice.test?type=all&postsCursor=posts1&commentsCursor=comments1',
      ),
    }).body
    const links = nextLinks(html)
    expect(links).toHaveLength(2)
    expect(links[0].searchParams.get('postsCursor')).toBe('posts+/=2')
    expect(links[0].searchParams.get('commentsCursor')).toBe('comments1')
    expect(links[1].searchParams.get('commentsCursor')).toBe('comments+/=2')
    expect(links[1].searchParams.get('postsCursor')).toBe('posts1')
    expect(links.every((link) => link.searchParams.get('type') === 'all')).toBe(
      true,
    )
  })

  for (const kind of ['home', 'community'] as const) {
    it(`${kind} feed has no Next link after its last cursor`, () => {
      expect(nextLinks(feedMarkup(kind))).toEqual([])
    })

    it(`${kind} feed preserves filters and opaque cursors in Next links`, () => {
      const links = nextLinks(feedMarkup(kind, 'opaque+/=2'))
      expect(links).toHaveLength(1)
      expect(links[0].searchParams.get('cursor')).toBe('opaque+/=2')
      expect(links[0].searchParams.get('sort')).toBe('top')
      expect(links[0].searchParams.get('timeframe')).toBe('week')
      expect(links[0].searchParams.get('type')).toBe('timeline')
    })
  }
})

function feedMarkup(kind: 'home' | 'community', cursor?: string): string {
  const renderContext = context('/?sort=top&timeframe=week&type=timeline')
  if (kind === 'community') {
    return render(PostListShell, {
      props: { posts: [], cursor, params: {}, getParams: {}, header: false },
      context: renderContext,
    }).body
  }
  return render(HomePage, {
    props: {
      data: {
        feed: { value: { feed: [], cursor, params: {} } },
        filters: {
          value: { type_: 'timeline', sort: 'top', timeframe: 'week' },
        },
      } as unknown as ComponentProps<typeof HomePage>['data'],
    },
    context: renderContext,
  }).body
}

describe('mobile navigation', () => {
  it.each(['/', '/profile/alice.test'])(
    'provides a Home link on %s',
    (path) => {
      const html = render(Navbar, { context: context(path) }).body
      const anchor = (html.match(/<a\b[^>]*>/g) ?? []).find((tag) =>
        tag.includes('href="/"'),
      )
      expect(anchor).toBeDefined()
      expect(anchor).toContain('title="Home"')
      expect(anchor).toContain(`aria-selected="${path === '/'}"`)
    },
  )
})
