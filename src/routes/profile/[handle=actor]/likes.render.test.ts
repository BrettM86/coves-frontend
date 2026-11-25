/**
 * Server render of the profile Likes tab. Likes are private, so the tab is
 * offered only when the signed-in viewer owns the profile; page.render.test.ts
 * covers the signed-out tab bar.
 */
import { JSDOM } from 'jsdom'
import type { ComponentProps } from 'svelte'
import { render } from 'svelte/server'
import { describe, expect, it, vi } from 'vitest'
import { ReactiveState } from '$lib/app/util/reactive.svelte'

const viewer = vi.hoisted(() => ({
  current: {
    type: 'authenticated',
    did: 'did:plc:alice',
    handle: 'alice.coves.test',
    jwt: 'authenticated',
    instance: 'https://coves.test',
  },
}))

vi.mock('$lib/app/state/auth.svelte', () => ({ profile: viewer }))
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.test' },
}))
vi.stubGlobal('__VERSION__', 'test')

import ProfilePage from './+page.svelte'

const alice = {
  did: 'did:plc:alice',
  handle: 'alice.coves.test',
  displayName: 'Alice',
  createdAt: '2026-01-01T00:00:00.000Z',
}
const bob = {
  did: 'did:plc:bob',
  handle: 'bob.coves.test',
  displayName: 'Bob',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const likedPost = {
  $type: 'social.coves.actor.getLikes#likedPost',
  post: {
    uri: 'at://did:plc:carol/social.coves.community.post/liked1',
    cid: 'bafyreiliked1',
    rkey: 'liked1',
    author: { did: 'did:plc:carol', handle: 'carol.coves.test' },
    community: {
      did: 'did:plc:sci',
      handle: 'science.coves.test',
      name: 'science',
    },
    record: {
      $type: 'social.coves.community.post',
      title: 'A post Alice liked',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
    createdAt: '2026-01-02T00:00:00.000Z',
    indexedAt: '2026-01-02T00:00:00.000Z',
    stats: { upvotes: 1, downvotes: 0, score: 1, commentCount: 0 },
  },
}

/** A post view authored by `author`, in a community with no handle. */
function rootPost(author: string, rkey: string, title: string) {
  return {
    uri: `at://did:plc:${author}/social.coves.community.post/${rkey}`,
    cid: `bafyrei${rkey}`,
    rkey,
    author: { did: `did:plc:${author}`, handle: `${author}.coves.test` },
    community: { did: 'did:plc:sci', name: 'science' },
    record: {
      $type: 'social.coves.community.post',
      title,
      createdAt: '2026-01-02T00:00:00.000Z',
    },
    createdAt: '2026-01-02T00:00:00.000Z',
    indexedAt: '2026-01-02T00:00:00.000Z',
    stats: { upvotes: 1, downvotes: 0, score: 1, commentCount: 1 },
  }
}

/** A comment by Dave, liked by Alice, under `post`. */
function likedComment(rkey: string, post: ReturnType<typeof rootPost>) {
  return {
    $type: 'social.coves.actor.getLikes#likedComment',
    comment: {
      uri: `at://did:plc:dave/social.coves.community.comment/${rkey}`,
      cid: `bafyrei${rkey}`,
      createdAt: '2026-01-03T00:00:00.000Z',
      indexedAt: '2026-01-03T00:00:00.000Z',
      author: { did: 'did:plc:dave', handle: 'dave.coves.test' },
      post: { uri: post.uri, cid: post.cid },
      record: { content: `comment body ${rkey}` },
      stats: { upvotes: 1, downvotes: 0, score: 1, replyCount: 0 },
    },
    post,
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

function tabLinks(doc: Document): Element[] {
  return [...doc.querySelectorAll('nav[aria-label="Profile sections"] a')]
}

/** The likes filter links: likes-tab links outside the profile tab bar. */
function filterLinks(doc: Document): Element[] {
  return [...doc.querySelectorAll('a')].filter(
    (a) =>
      !a.closest('nav[aria-label="Profile sections"]') &&
      a
        .getAttribute('href')
        ?.startsWith('/profile/alice.coves.test?type=likes'),
  )
}

/**
 * The innermost list item holding `text`: a liked comment's own row, without
 * the neighbouring rows of the list.
 */
function commentRow(doc: Document, text: string): Element | undefined {
  return [...doc.querySelectorAll('li')]
    .filter((li) => li.textContent?.includes(text))
    .at(-1)
}

/** A row's upvote control, named by its visible "Upvote" text. */
function upvoteButton(row: Element | undefined): Element | undefined {
  return [...(row?.querySelectorAll('button') ?? [])].find((button) =>
    button.textContent?.includes('Upvote'),
  )
}

/** Whether a SvelteKit link option is switched on for this link. */
function linkOptionOn(link: Element, option: string): boolean {
  return ['', 'true'].includes(link.getAttribute(option) ?? 'absent')
}

function headings(doc: Document): string[] {
  return [...doc.querySelectorAll('h1')].map((h) => h.textContent?.trim() ?? '')
}

describe('profile likes tab link', () => {
  it.each([
    [
      'the owner',
      alice,
      [
        '/profile/alice.coves.test?type=posts',
        '/profile/alice.coves.test?type=comments',
        '/profile/alice.coves.test?type=likes',
      ],
    ],
    [
      'another signed-in account',
      bob,
      [
        '/profile/bob.coves.test?type=posts',
        '/profile/bob.coves.test?type=comments',
      ],
    ],
  ])('shows %s its tabs', (_who, profile, hrefs) => {
    const doc = renderPage(
      { profile, tab: 'posts', posts: { feed: [] } },
      `/profile/${profile.handle}`,
    )
    expect(tabLinks(doc).map((a) => a.getAttribute('href'))).toEqual(hrefs)
  })

  // Switching tabs is a client-side navigation that keeps the reader's place
  // on the page instead of jumping to the top.
  it('keeps scroll and focus when switching profile tabs', () => {
    const doc = renderPage(
      { profile: alice, tab: 'likes', likesFilter: 'all', likes: { feed: [] } },
      '/profile/alice.coves.test?type=likes',
    )
    const links = tabLinks(doc)
    expect(links).toHaveLength(3)
    expect(
      links.map((a) => [
        linkOptionOn(a, 'data-sveltekit-noscroll'),
        linkOptionOn(a, 'data-sveltekit-keepfocus'),
      ]),
    ).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ])
  })

  it('labels the owner’s likes tab Likes', () => {
    const doc = renderPage(
      { profile: alice, tab: 'posts', posts: { feed: [] } },
      '/profile/alice.coves.test',
    )
    expect(tabLinks(doc).at(-1)?.textContent?.trim()).toBe('Likes')
  })
})

describe('profile likes tab', () => {
  it('lists the liked posts, marks the tab current and pages by likesCursor', () => {
    const doc = renderPage(
      {
        profile: alice,
        tab: 'likes',
        likesFilter: 'all',
        likes: { feed: [likedPost], cursor: 'l2' },
      },
      '/profile/alice.coves.test?type=likes',
    )
    expect(doc.body.textContent).toContain('A post Alice liked')
    expect(tabLinks(doc).map((a) => a.getAttribute('aria-current'))).toEqual([
      null,
      null,
      'page',
    ])
    const hrefs = [...doc.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    )
    expect(hrefs).toContain('?type=likes&likesCursor=l2')
  })

  // One list in server order: a liked post is a post card, a liked comment a
  // thread comment whose permalink comes from the item's own root post.
  it('renders a mixed page as one list in server order', () => {
    const postA = rootPost('carol', 'p1', 'Root of comment A')
    const postB = rootPost('erin', 'p2', 'Root of comment B')
    const doc = renderPage(
      {
        profile: alice,
        tab: 'likes',
        likesFilter: 'all',
        likes: {
          feed: [
            likedComment('ca', postA),
            likedPost,
            likedComment('cb', postB),
          ],
        },
      },
      '/profile/alice.coves.test?type=likes',
    )

    const rows = [
      ...doc.querySelectorAll('li[data-post-uri], li[id^="comment-"]'),
    ]
    expect(
      rows.map((row) => row.getAttribute('data-post-uri') ?? row.id),
    ).toEqual([
      'comment-ca',
      'at://did:plc:carol/social.coves.community.post/liked1',
      'comment-cb',
    ])
    expect(rows[0].textContent).toContain('comment body ca')
    expect(rows[1].textContent).toContain('A post Alice liked')
    expect(rows[2].textContent).toContain('comment body cb')
    const hrefs = (row: Element) =>
      [...row.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs(rows[0])).toContain(
      '/c/did%3Aplc%3Asci/post/carol.coves.test/p1/comment/dave.coves.test/ca',
    )
    expect(hrefs(rows[2])).toContain(
      '/c/did%3Aplc%3Asci/post/erin.coves.test/p2/comment/dave.coves.test/cb',
    )
  })

  // A liked comment reads like the same comment in its thread: author, body,
  // votes and a permalink, without the community and post-title context line
  // of the Comments tab.
  it('renders a liked comment as a thread comment', () => {
    const doc = renderPage(
      {
        profile: alice,
        tab: 'likes',
        likesFilter: 'comments',
        likes: {
          feed: [
            likedComment('ca', rootPost('carol', 'p1', 'Root of comment A')),
          ],
        },
      },
      '/profile/alice.coves.test?type=likes&likes=comments',
    )
    const row = commentRow(doc, 'comment body ca')
    const links = [...(row?.querySelectorAll('a') ?? [])]
    expect
      .soft(
        links.find((a) => a.getAttribute('href') === '/profile/dave.coves.test')
          ?.textContent,
      )
      .toContain('dave.coves.test')
    expect
      .soft(links.map((a) => a.getAttribute('href')))
      .toContain(
        '/c/did%3Aplc%3Asci/post/carol.coves.test/p1/comment/dave.coves.test/ca',
      )
    expect
      .soft(links.map((a) => a.textContent?.trim()))
      .not.toContain('science')
    expect.soft(row?.textContent).not.toContain('Root of comment A')
  })

  it('shows the viewer’s upvote on a liked comment', () => {
    const post = rootPost('carol', 'p1', 'Root of the liked comments')
    const voted = likedComment('cv', post)
    const doc = renderPage(
      {
        profile: alice,
        tab: 'likes',
        likesFilter: 'comments',
        likes: {
          feed: [
            {
              ...voted,
              comment: {
                ...voted.comment,
                viewer: {
                  vote: 'up',
                  voteUri: 'at://did:plc:alice/social.coves.vote/1',
                },
              },
            },
            likedComment('cn', post),
          ],
        },
      },
      '/profile/alice.coves.test?type=likes&likes=comments',
    )
    expect
      .soft(
        upvoteButton(commentRow(doc, 'comment body cv'))?.getAttribute(
          'aria-pressed',
        ),
      )
      .toBe('true')
    expect
      .soft(
        upvoteButton(commentRow(doc, 'comment body cn'))?.getAttribute(
          'aria-pressed',
        ),
      )
      .toBe('false')
  })

  // Switching filters keeps the reader's place, like switching tabs.
  it('keeps scroll and focus when switching likes filters', () => {
    const doc = renderPage(
      {
        profile: alice,
        tab: 'likes',
        likesFilter: 'all',
        likes: { feed: [likedPost] },
      },
      '/profile/alice.coves.test?type=likes',
    )
    const links = filterLinks(doc)
    expect(links).toHaveLength(3)
    expect(
      links.map((a) => [
        linkOptionOn(a, 'data-sveltekit-noscroll'),
        linkOptionOn(a, 'data-sveltekit-keepfocus'),
      ]),
    ).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ])
  })

  // Filter links are absolute, so switching drops the cursor.
  it.each([
    ['all', '/profile/alice.coves.test?type=likes', ['page', null, null]],
    [
      'all',
      '/profile/alice.coves.test?type=likes&likesCursor=c1',
      ['page', null, null],
    ],
    [
      'posts',
      '/profile/alice.coves.test?type=likes&likes=posts',
      [null, 'page', null],
    ],
    [
      'posts',
      '/profile/alice.coves.test?type=likes&likes=posts&likesCursor=c1',
      [null, 'page', null],
    ],
    [
      'comments',
      '/profile/alice.coves.test?type=likes&likes=comments',
      [null, null, 'page'],
    ],
    [
      'comments',
      '/profile/alice.coves.test?type=likes&likes=comments&likesCursor=c1',
      [null, null, 'page'],
    ],
  ])('marks the %s filter current at %s', (likesFilter, path, current) => {
    const doc = renderPage(
      {
        profile: alice,
        tab: 'likes',
        likesFilter,
        likes: { feed: [likedPost] },
      },
      path,
    )

    const links = filterLinks(doc)
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/profile/alice.coves.test?type=likes',
      '/profile/alice.coves.test?type=likes&likes=posts',
      '/profile/alice.coves.test?type=likes&likes=comments',
    ])
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(current)
    expect(tabLinks(doc).map((a) => a.getAttribute('aria-current'))).toEqual([
      null,
      null,
      'page',
    ])
  })

  it.each([
    ['all', '/profile/alice.coves.test?type=likes', 'No likes'],
    [
      'posts',
      '/profile/alice.coves.test?type=likes&likes=posts',
      'No liked posts',
    ],
    [
      'comments',
      '/profile/alice.coves.test?type=likes&likes=comments',
      'No liked comments',
    ],
  ])('shows the %s empty state', (likesFilter, path, title) => {
    const doc = renderPage(
      { profile: alice, tab: 'likes', likesFilter, likes: { feed: [] } },
      path,
    )
    expect(headings(doc)).toContain(title)
  })

  // A page can come back empty with a cursor (the server drops deleted or
  // blocked items after paging), so the next link must still render.
  it('offers the next page of an empty filtered page that has a cursor', () => {
    const doc = renderPage(
      {
        profile: alice,
        tab: 'likes',
        likesFilter: 'comments',
        likes: { feed: [], cursor: 'c2' },
      },
      '/profile/alice.coves.test?type=likes&likes=comments',
    )
    const hrefs = [...doc.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    )
    expect(hrefs).toContain('?type=likes&likes=comments&likesCursor=c2')
  })

  // An empty page with a cursor is not the end of the likes: the server
  // drops deleted or blocked items after paging, so later pages can hold some.
  it.each([
    ['all', '/profile/alice.coves.test?type=likes'],
    ['posts', '/profile/alice.coves.test?type=likes&likes=posts'],
    ['comments', '/profile/alice.coves.test?type=likes&likes=comments'],
  ])(
    'does not say the %s filter has no likes when a cursor remains',
    (likesFilter, path) => {
      const doc = renderPage(
        {
          profile: alice,
          tab: 'likes',
          likesFilter,
          likes: { feed: [], cursor: 'c2' },
        },
        path,
      )
      expect(doc.body.textContent).not.toContain("haven't liked")
    },
  )

  // Liked comments are other people's, so each row names its author: the
  // display name, or the handle when there is none.
  it('names the author of each liked comment', () => {
    const post = rootPost('carol', 'p1', 'Root of the liked comments')
    const named = likedComment('cd', post)
    const doc = renderPage(
      {
        profile: alice,
        tab: 'likes',
        likesFilter: 'comments',
        likes: {
          feed: [
            {
              ...named,
              comment: {
                ...named.comment,
                author: { ...named.comment.author, displayName: 'Dave' },
              },
            },
            likedComment('ce', post),
          ],
        },
      },
      '/profile/alice.coves.test?type=likes&likes=comments',
    )
    // Like a thread comment, the author line is the handle link alone: the
    // display name is not shown.
    for (const body of ['comment body cd', 'comment body ce']) {
      const row = commentRow(doc, body)
      expect
        .soft(
          [...(row?.querySelectorAll('a') ?? [])].find(
            (a) => a.getAttribute('href') === '/profile/dave.coves.test',
          )?.textContent,
          body,
        )
        .toContain('dave.coves.test')
    }
    expect
      .soft(commentRow(doc, 'comment body cd')?.textContent)
      .not.toContain('Dave')
  })

  // A deleted comment stays anonymous even when the older tombstone shape
  // still carries its author, as Comment.svelte does in threads.
  it('does not name or link the author of a deleted liked comment', () => {
    const post = rootPost('carol', 'p1', 'Root of the liked comments')
    const deleted = likedComment('cf', post)
    const doc = renderPage(
      {
        profile: alice,
        tab: 'likes',
        likesFilter: 'comments',
        likes: {
          feed: [
            {
              ...deleted,
              comment: {
                ...deleted.comment,
                isDeleted: true,
                author: {
                  did: 'did:plc:dave',
                  handle: 'dave.coves.test',
                  displayName: 'Dave',
                },
              },
            },
          ],
        },
      },
      '/profile/alice.coves.test?type=likes&likes=comments',
    )
    const row = doc.getElementById('comment-cf')
    if (!row) throw new Error('no row for the deleted liked comment')
    expect.soft(row.textContent).not.toContain('Dave')
    expect.soft(row.textContent).not.toContain('dave.coves.test')
    const hrefs = [...row.querySelectorAll('a')].map(
      (a) => a.getAttribute('href') ?? '',
    )
    expect
      .soft(hrefs.filter((href) => href.startsWith('/profile/')))
      .toEqual([])
    expect
      .soft(hrefs.filter((href) => href.includes('did:plc:dave')))
      .toEqual([])
  })

  // The older tombstone shape can still carry the deleted body; the row shows
  // the deletion placeholder instead, as a thread does.
  it('shows the deleted placeholder, not the body, for a deleted liked comment', () => {
    const post = rootPost('carol', 'p1', 'Root of the liked comments')
    const deleted = likedComment('cg', post)
    const doc = renderPage(
      {
        profile: alice,
        tab: 'likes',
        likesFilter: 'comments',
        likes: {
          feed: [
            {
              ...deleted,
              comment: {
                ...deleted.comment,
                isDeleted: true,
                record: { content: 'body that was deleted' },
              },
            },
          ],
        },
      },
      '/profile/alice.coves.test?type=likes&likes=comments',
    )
    const row = doc.getElementById('comment-cg')
    if (!row) throw new Error('no row for the deleted liked comment')
    expect.soft(doc.body.textContent).not.toContain('body that was deleted')
    expect.soft(row.textContent).toContain('[Deleted by user]')
  })
})
