/**
 * atproto at-tags in server-rendered HTML: `<meta name="at:canonical">`,
 * `at:alternate`, `at:author` and `at:me` in `<head>`, so a crawler that
 * fetches a page without running its JavaScript can map it to the records
 * and accounts it shows. `canonical`/`alternate` name records, `author`/`me`
 * name accounts by DID-only AT URIs. Pages that show nothing public (an
 * unavailable post, a deleted comment, a removed or private community) emit
 * none.
 *
 * Every expected value is spelled out from the fixture DIDs in
 * `mock-upstream.ts`.
 */
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { UNKNOWN_PATHS_PATH } from './mock-upstream'

const baseUrl = inject('ssrBaseUrl')
const unknownPathsUrl = `${inject('mockUpstreamUrl')}${UNKNOWN_PATHS_PATH}`

type AtTag = { name: string; content: string }

interface RenderedPage {
  status: number
  /** The `<head>` and `<body>` of the markup, `<script>` blocks removed. */
  document: Document
  /** Every `meta[name^="at:"]` in `<head>`, duplicates kept, sorted. */
  atTags: AtTag[]
}

function sortTags(tags: AtTag[]): AtTag[] {
  return [...tags].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.content.localeCompare(b.content),
  )
}

/**
 * Fetches `path` as an anonymous visitor without following redirects, so a
 * path that is not the page's canonical one fails on its status instead of
 * landing somewhere else.
 */
async function render(path: string): Promise<RenderedPage> {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' })
  const html = (await response.text()).replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    '',
  )
  const document = new JSDOM(html).window.document
  const atTags = Array.from(
    document.head.querySelectorAll('meta[name^="at:"]'),
    (meta) => ({
      name: meta.getAttribute('name') ?? '',
      content: meta.getAttribute('content') ?? '',
    }),
  )
  return { status: response.status, document, atTags: sortTags(atTags) }
}

function text(document: Document, selector: string): string {
  return document.querySelector(selector)?.textContent?.trim() ?? ''
}

beforeEach(async () => {
  const res = await fetch(unknownPathsUrl, { method: 'DELETE' })
  expect(res.status).toBe(200)
})

afterEach(async () => {
  const res = await fetch(unknownPathsUrl)
  expect(((await res.json()) as { paths: string[] }).paths).toEqual([])
})

describe('post page at-tags', () => {
  it.each([
    {
      post: 'an ordinary post, in its author repo',
      path: '/c/attags@coves.social/post/attags-author.test/attagspost',
      title: 'At-tags ordinary post',
      expected: [
        {
          name: 'at:alternate',
          content:
            'at://did:plc:attagscommunityabcdefgh/social.coves.community.profile/self',
        },
        {
          name: 'at:author',
          content: 'at://did:plc:attagsauthorabcdefghijk',
        },
        {
          name: 'at:canonical',
          content:
            'at://did:plc:attagsauthorabcdefghijk/social.coves.community.postv2/attagspost',
        },
      ],
    },
    {
      // The legacy record lives in the community's repo; the author is still
      // the view's author, not the URI's DID.
      post: 'a legacy post, in its community repo',
      path: '/c/attags@coves.social/post/did:plc:attagscommunityabcdefgh/attagslegacy',
      title: 'At-tags legacy post',
      expected: [
        {
          name: 'at:alternate',
          content:
            'at://did:plc:attagscommunityabcdefgh/social.coves.community.profile/self',
        },
        {
          name: 'at:author',
          content: 'at://did:plc:attagsauthorabcdefghijk',
        },
        {
          name: 'at:canonical',
          content:
            'at://did:plc:attagscommunityabcdefgh/social.coves.community.post/attagslegacy',
        },
      ],
    },
  ])(
    'for $post: canonical post, author DID, community profile',
    async ({ path, title, expected }) => {
      const page = await render(path)

      expect(page.status).toBe(200)
      expect(text(page.document, 'title')).toBe(title)
      expect(page.atTags).toEqual(expected)
    },
  )

  it.each([
    {
      state: 'a notFound sentinel',
      path: '/c/attags@coves.social/post/did:plc:attagsauthorabcdefghijk/attagsnotfound',
      title: 'Post unavailable',
      description:
        "This post may have been removed, or it isn't available yet.",
    },
    {
      state: 'a community-removed sentinel',
      path: '/c/attags@coves.social/post/did:plc:attagsauthorabcdefghijk/attagsremoved',
      title: 'Post removed',
      description: "Removed by the community's moderators.",
    },
    {
      state: 'a blocked sentinel',
      path: '/c/attags@coves.social/post/did:plc:attagsauthorabcdefghijk/attagsblocked',
      title: 'Post unavailable',
      description: "You've blocked this post's author.",
    },
    {
      state: 'a moderated sentinel',
      path: '/c/attags@coves.social/post/did:plc:attagsauthorabcdefghijk/attagsmoderated',
      title: 'Post removed',
      description: 'Removed by server admin.',
    },
  ])(
    'for $state: the unavailable state, no at-tags',
    async ({ path, title, description }) => {
      const page = await render(path)

      expect(page.status).toBe(200)
      expect(text(page.document, 'title')).toBe(title)
      expect(page.document.body.textContent).toContain(description)
      expect(page.atTags).toEqual([])
    },
  )

  it('for a hydrated post whose moderation state is removed: no at-tags', async () => {
    const page = await render(
      '/c/attags@coves.social/post/attags-author.test/attagsmodremoved',
    )

    // The post page rendered this post (not an error page), so an empty tag
    // list means the tags were withheld rather than never reached.
    expect(page.status).toBe(200)
    expect(text(page.document, 'title')).toBe('At-tags moderation-removed post')
    expect(page.atTags).toEqual([])
  })
})

describe('comment permalink at-tags', () => {
  it('for a live reply to a comment: canonical comment, commenter DID, the post as alternate', async () => {
    const page = await render(
      '/c/attags@coves.social/post/attags-author.test/attagspost/comment/attags-commenter.test/attagsreply',
    )

    expect(page.status).toBe(200)
    expect(text(page.document, 'title')).toBe(
      'At-tags ordinary post · Comment thread',
    )
    expect(page.atTags).toEqual([
      {
        name: 'at:alternate',
        content:
          'at://did:plc:attagsauthorabcdefghijk/social.coves.community.postv2/attagspost',
      },
      {
        name: 'at:author',
        content: 'at://did:plc:attagscommenterabcdefgh',
      },
      {
        name: 'at:canonical',
        content:
          'at://did:plc:attagscommenterabcdefgh/social.coves.community.comment/attagsreply',
      },
    ])
  })

  it.each([
    {
      comment: 'a deleted comment with no author and no record',
      path: '/c/attags@coves.social/post/attags-author.test/attagspost/comment/did:plc:attagscommenterabcdefgh/attagsdeleted',
      title: 'At-tags ordinary post · Comment thread',
    },
    {
      comment: 'a deleted comment with its author and record still present',
      path: '/c/attags@coves.social/post/attags-author.test/attagspost/comment/attags-commenter.test/attagsdeletedkept',
      title: 'At-tags ordinary post · Comment thread',
    },
    {
      // The thread renders a record-less comment as deleted whether or not
      // the view marks it so.
      comment: 'a comment with no record and no author, not marked deleted',
      path: '/c/attags@coves.social/post/attags-author.test/attagspost/comment/did:plc:attagscommenterabcdefgh/attagsnorecord',
      title: 'At-tags ordinary post · Comment thread',
    },
    {
      comment: 'a live comment whose moderation state is removed',
      path: '/c/attags@coves.social/post/attags-author.test/attagspost/comment/attags-commenter.test/attagsmodremovedcomment',
      title: 'At-tags ordinary post · Comment thread',
    },
    {
      comment: 'a live comment under a post whose moderation state is removed',
      path: '/c/attags@coves.social/post/attags-author.test/attagsmodremoved/comment/attags-commenter.test/attagsundermodremoved',
      title: 'At-tags moderation-removed post · Comment thread',
    },
  ])('for $comment: no at-tags', async ({ path, title }) => {
    const page = await render(path)

    expect(page.status).toBe(200)
    expect(text(page.document, 'title')).toBe(title)
    expect(page.document.body.textContent).toContain(
      "You're viewing a single comment's thread.",
    )
    expect(page.atTags).toEqual([])
  })
})

describe('community page at-tags', () => {
  it.each([
    {
      community: 'an active public community',
      path: '/c/attags@coves.social',
      title: 'At-tags Community',
      expected: [
        {
          name: 'at:canonical',
          content:
            'at://did:plc:attagscommunityabcdefgh/social.coves.community.profile/self',
        },
        { name: 'at:me', content: 'at://did:plc:attagscommunityabcdefgh' },
      ],
    },
    {
      community: 'a public community whose view omits visibility',
      path: '/c/attagsnovisibility@coves.social',
      title: 'At-tags No-visibility Community',
      expected: [
        {
          name: 'at:canonical',
          content:
            'at://did:plc:attagsnovisibilitycommun/social.coves.community.profile/self',
        },
        { name: 'at:me', content: 'at://did:plc:attagsnovisibilitycommun' },
      ],
    },
  ])(
    'for $community: its profile record and its DID',
    async ({ path, title, expected }) => {
      const page = await render(path)

      expect(page.status).toBe(200)
      expect(text(page.document, 'title')).toBe(title)
      expect(page.atTags).toEqual(expected)
    },
  )

  it.each([
    {
      community: 'removed by the instance',
      path: '/c/attagsremoved@coves.social',
      title: 'attagsremoved',
    },
    {
      community: 'private',
      path: '/c/attagsprivate@coves.social',
      title: 'At-tags Private Community',
    },
    {
      community: 'unlisted',
      path: '/c/attagsunlisted@coves.social',
      title: 'At-tags Unlisted Community',
    },
  ])('for a community $community: no at-tags', async ({ path, title }) => {
    const page = await render(path)

    expect(page.status).toBe(200)
    expect(text(page.document, 'title')).toBe(title)
    expect(page.atTags).toEqual([])
  })
})

describe('profile page at-tags', () => {
  // No at:canonical: not every account has a social.coves.actor.profile/self
  // record, and the profile view does not say whether this one does.
  it('for an active account: its DID as author, nothing else', async () => {
    const page = await render('/profile/attags-profile.test')

    expect(page.status).toBe(200)
    expect(text(page.document, 'title')).toBe('At-tags Profile')
    expect(page.atTags).toEqual([
      { name: 'at:author', content: 'at://did:plc:attagsprofileabcdefghij' },
    ])
  })

  it('for a suspended account: no at-tags', async () => {
    const page = await render('/profile/attags-suspended.test')

    // The profile page rendered the reduced view (its handle as the title,
    // the empty posts tab), not an error page, so an empty tag list means the
    // tags were withheld rather than never reached.
    expect(page.status).toBe(200)
    expect(text(page.document, 'title')).toBe('attags-suspended.test')
    expect(page.document.body.textContent).toContain('This user has no posts.')
    expect(page.atTags).toEqual([])
  })
})
