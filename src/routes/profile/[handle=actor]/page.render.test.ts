/**
 * Server render of the profile page: the header identity, the tab bar and
 * the comments tab's wiring of parent posts into each comment.
 */
import { JSDOM } from 'jsdom'
import type { ComponentProps } from 'svelte'
import { render } from 'svelte/server'
import { describe, expect, it, vi } from 'vitest'
import { ReactiveState } from '$lib/app/util/reactive.svelte'

vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.test' },
}))
vi.stubGlobal('__VERSION__', 'test')

import ProfilePage from './+page.svelte'

const profile = {
  did: 'did:plc:alice',
  handle: 'alice.coves.test',
  displayName: 'Alice',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const parent = {
  uri: 'at://did:plc:alice/social.coves.community.post/p1',
  author: { did: 'did:plc:alice', handle: 'alice.coves.test' },
  community: { did: 'did:plc:sci', name: 'science' },
  record: { title: 'Tall comics' },
}

function comment(rkey: string, postUri: string, extra: object = {}) {
  return {
    uri: `at://did:plc:alice/social.coves.community.comment/${rkey}`,
    createdAt: '2026-01-02T00:00:00.000Z',
    author: { did: 'did:plc:alice', handle: 'alice.coves.test' },
    post: { uri: postUri },
    record: { content: `body ${rkey}` },
    stats: { upvotes: 0, downvotes: 0, score: 0, replyCount: 0 },
    ...extra,
  }
}

function renderPage(value: object, path: string): Document {
  const { body } = render(ProfilePage, {
    props: {
      data: { data: new ReactiveState(value) },
    } as unknown as ComponentProps<typeof ProfilePage>,
    context: new Map([
      ['__request__', { page: { url: new URL(path, 'https://coves.test') } }],
    ]),
  })
  return new JSDOM(body).window.document
}

function article(doc: Document, text: string): Element {
  const found = [...doc.querySelectorAll('article')].find((el) =>
    el.textContent?.includes(text),
  )
  if (!found) throw new Error(`no comment containing ${text}`)
  return found
}

describe('profile comments tab', () => {
  const doc = renderPage(
    {
      profile,
      tab: 'comments',
      comments: {
        comments: [
          comment('c1', parent.uri),
          comment('c2', 'at://did:plc:bob/social.coves.community.post/gone'),
          comment('c3', parent.uri, {
            isDeleted: true,
            deletionReason: 'author',
          }),
        ],
      },
      commentPosts: [parent],
    },
    '/profile/alice.coves.test?type=comments',
  )

  it('links a comment with a hydrated parent to its permalink and community', () => {
    const hrefs = [...article(doc, 'body c1').querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    )
    expect(hrefs).toContain('/c/did%3Aplc%3Asci')
    expect(hrefs).toContain(
      '/c/did%3Aplc%3Asci/post/alice.coves.test/p1/comment/alice.coves.test/c1',
    )
    expect(article(doc, 'body c1').textContent).toContain('Tall comics')
  })

  it('gives a comment whose parent is gone no permalink', () => {
    const links = [...article(doc, 'body c2').querySelectorAll('a')].filter(
      (a) => a.getAttribute('href')?.includes('/comment/'),
    )
    expect(links).toEqual([])
  })

  it('shows the deleted placeholder, without Markdown asterisks, for a deleted comment', () => {
    const deleted = [...doc.querySelectorAll('article')].at(-1)
    expect(deleted?.textContent).not.toContain('body c3')
    expect(deleted?.textContent).not.toContain('*')
  })

  it('marks the comments tab current and links both tabs', () => {
    const tabs = [...doc.querySelectorAll('nav a')].filter((a) =>
      a.getAttribute('href')?.includes('?type='),
    )
    expect(tabs.map((a) => a.getAttribute('href'))).toEqual([
      '/profile/alice.coves.test?type=posts',
      '/profile/alice.coves.test?type=comments',
    ])
    expect(tabs.map((a) => a.getAttribute('aria-current'))).toEqual([
      null,
      'page',
    ])
  })
})

describe('profile header identity', () => {
  it('names the account by its handle when there is no display name', () => {
    const doc = renderPage(
      {
        profile: { ...profile, displayName: undefined },
        tab: 'posts',
        posts: { feed: [] },
      },
      '/profile/alice.coves.test',
    )
    expect(doc.querySelector('h1')?.textContent?.trim()).toBe(
      '@alice.coves.test',
    )
    expect(doc.body.textContent?.match(/@alice\.coves\.test/g)).toHaveLength(1)
  })

  it('never renders an empty @ line for a display name without a handle', () => {
    const doc = renderPage(
      {
        profile: { ...profile, handle: undefined },
        tab: 'posts',
        posts: { feed: [] },
      },
      '/profile/did:plc:alice',
    )
    expect(doc.querySelector('h1')?.textContent?.trim()).toBe('Alice')
    const lines = [...doc.querySelectorAll('section p')].map((p) =>
      p.textContent?.trim(),
    )
    expect(lines).not.toContain('@')
    expect(lines).not.toContain('@undefined')
  })

  it('links the posts and comments stats to their tabs but not memberships', () => {
    const doc = renderPage(
      { profile, tab: 'posts', posts: { feed: [] } },
      '/profile/alice.coves.test',
    )
    const statLinks = [...doc.querySelectorAll('section a')]
      .map((a) => a.getAttribute('href'))
      .filter((href) => href?.includes('?type='))
    expect(statLinks).toEqual([
      '/profile/alice.coves.test?type=posts',
      '/profile/alice.coves.test?type=comments',
    ])
  })
})
