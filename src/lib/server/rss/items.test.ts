import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import type {
  AtUri,
  CID,
  CommentRecord,
  CommentView,
  PostEmbed,
  PostRecord,
  PostView,
} from '$lib/api/coves/types'
import { FEATURE_TYPE } from '$lib/feature/richtext/facets'
import { facetOver } from '$lib/feature/richtext/test-helpers'
import type { DID, Handle } from '$lib/types/atproto'
import { commentsToRssItems, postToRssItem } from './items'

// Pins the local community domain: `gaming` with origin coves.test is local,
// so its permalink segment is the bare `/c/gaming`.
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.test' },
}))

const ORIGIN = 'https://coves.test'

const POST_URI =
  'at://did:plc:alice/social.coves.community.postv2/3kabc' as AtUri
const POST_LINK = 'https://coves.test/c/gaming/post/alice.coves.test/3kabc'
const OTHER_POST_URI =
  'at://did:plc:carol/social.coves.community.postv2/3kxyz' as AtUri
const COMMENT_URI =
  'at://did:plc:bob/social.coves.community.comment/3kcom1' as AtUri
const HOSTILE = '"><script>alert(1)</script>'

// ---------------------------------------------------------------------------
// Fixtures: alice posts in the local community `gaming`; bob comments on it
// two months later.
// ---------------------------------------------------------------------------

const fixtures = {
  post(
    record: Partial<PostRecord> = {},
    view: Partial<PostView> = {},
  ): PostView {
    return {
      uri: POST_URI,
      cid: 'bafypostaaaa' as CID,
      rkey: '3kabc',
      indexedAt: '2026-03-04T05:06:08.000Z',
      createdAt: '2026-03-04T05:06:07.000Z',
      author: {
        did: 'did:plc:alice' as DID,
        handle: 'alice.coves.test' as Handle,
        displayName: 'Alice',
      },
      community: {
        did: 'did:plc:gaming' as DID,
        handle: 'c-gaming.coves.test' as Handle,
        name: 'gaming',
        origin: 'coves.test',
      },
      record: {
        $type: 'social.coves.community.post',
        community: 'did:plc:gaming',
        author: 'did:plc:alice',
        createdAt: '2026-03-04T05:06:07.000Z',
        title: 'Parent title',
        content: 'Hello *world*',
        ...record,
      },
      ...view,
    }
  },

  comment(
    record: Partial<CommentRecord> = {},
    view: Partial<CommentView> = {},
  ): CommentView {
    const postRef = { uri: POST_URI, cid: 'bafypostaaaa' as CID }
    return {
      uri: COMMENT_URI,
      cid: 'bafycommentaaaa' as CID,
      createdAt: '2026-05-06T07:08:09.000Z',
      indexedAt: '2026-05-06T07:08:10.000Z',
      record: {
        $type: 'social.coves.community.comment',
        content: 'Nice *one*',
        reply: { root: postRef, parent: postRef },
        createdAt: '2026-05-06T07:08:09.000Z',
        ...record,
      },
      author: { did: 'did:plc:bob' as DID, handle: 'bob.coves.test' as Handle },
      post: postRef,
      stats: { upvotes: 0, downvotes: 0, score: 0, replyCount: 0 },
      ...view,
    }
  },
}

function parse(html: string): DocumentFragment {
  return JSDOM.fragment(html)
}

function hrefs(html: string): string[] {
  return Array.from(
    parse(html).querySelectorAll('a'),
    (a) => a.getAttribute('href') ?? '',
  )
}

const external = (fields: {
  uri: string
  title?: string
  description?: string
}): PostEmbed => ({
  $type: 'social.coves.embed.external#view',
  external: fields,
})

describe('postToRssItem', () => {
  it('maps the post to an item with absolute link, AT-URI guid, date and author', () => {
    const item = postToRssItem(fixtures.post(), ORIGIN)

    expect(item.title).toBe('Parent title')
    expect(item.link).toBe(POST_LINK)
    expect(item.guid).toBe(
      'at://did:plc:alice/social.coves.community.postv2/3kabc',
    )
    expect(item.publishedAt).toBe('2026-03-04T05:06:07.000Z')
    expect(item.author).toBe('@alice.coves.test')
  })

  it.each([
    [
      'the first line of the content, stripped of markup',
      '**Hello** world, this is the first line\nsecond line',
      'Hello world, this is the first line',
    ],
    [
      'content cut to 80 characters with an ellipsis',
      'x'.repeat(100),
      `${'x'.repeat(79)}…`,
    ],
  ])('titles an untitled post with %s', (_label, content, expected) => {
    const item = postToRssItem(
      fixtures.post({ title: undefined, content }),
      ORIGIN,
    )

    expect(item.title).toBe(expected)
  })

  it('titles a post with an empty-string title from its content', () => {
    const item = postToRssItem(
      fixtures.post({ title: '', content: 'Hello world' }),
      ORIGIN,
    )

    expect(item.title).toBe('Hello world')
  })

  it('withholds the body and media of an NSFW-labelled post but keeps its title and link', () => {
    const item = postToRssItem(
      fixtures.post(
        {
          content: 'Secret *spicy* body',
          labels: {
            $type: 'com.atproto.label.defs#selfLabels',
            values: [{ val: 'nsfw' }],
          },
        },
        {
          embed: {
            $type: 'social.coves.embed.images#view',
            images: [
              {
                image:
                  'https://cdn.example/img/content_preview/plain/did:plc:alice/bafyimgone',
                alt: 'A cat',
              },
            ],
          },
        },
      ),
      ORIGIN,
    )
    const fragment = parse(item.html)

    expect(
      Array.from(fragment.querySelectorAll('img'), (img) =>
        img.getAttribute('src'),
      ),
    ).toEqual([])
    expect(fragment.textContent).not.toContain('Secret')
    expect(fragment.textContent).not.toContain('spicy')
    expect(hrefs(item.html)).toContain(POST_LINK)
    expect(item.title).toBe('Parent title')
    expect(item.sensitive).toBe(true)
  })

  it.each([
    ['absent', undefined],
    ['empty', ''],
  ])(
    'titles an NSFW-labelled post whose title is %s after its author, not its withheld body',
    (_label, title) => {
      const item = postToRssItem(
        fixtures.post({
          title,
          content: 'Secret spicy body',
          labels: {
            $type: 'com.atproto.label.defs#selfLabels',
            values: [{ val: 'nsfw' }],
          },
        }),
        ORIGIN,
      )

      expect(item.title).not.toContain('Secret')
      expect(item.title).not.toContain('spicy')
      expect(item.title).toBe('Post by @alice.coves.test')
    },
  )

  it('does not mark an unlabelled post sensitive', () => {
    const item = postToRssItem(fixtures.post(), ORIGIN)

    expect(item.sensitive).toBeFalsy()
  })

  it('renders a markdown body as HTML', () => {
    const item = postToRssItem(fixtures.post(), ORIGIN)

    expect(parse(item.html).querySelector('em')?.textContent).toBe('world')
  })

  it('renders a faceted body from its facets, not as markdown', () => {
    const content = 'Hello *literal* world'
    const item = postToRssItem(
      fixtures.post({
        content,
        facets: [facetOver(content, 'world', { $type: FEATURE_TYPE.bold })],
      }),
      ORIGIN,
    )
    const fragment = parse(item.html)

    expect(fragment.querySelector('strong')?.textContent).toBe('world')
    expect(fragment.querySelector('em')).toBeNull()
    expect(fragment.textContent).toContain('*literal*')
  })

  it.each([
    {
      label: 'external embed with a title links the title',
      embed: external({
        uri: 'https://news.example/story',
        title: 'Story',
        description: 'What happened',
      }),
      href: 'https://news.example/story',
      text: 'Story',
      contains: 'What happened',
    },
    {
      label: 'external embed without a title links the URL itself',
      embed: external({ uri: 'https://news.example/story' }),
      href: 'https://news.example/story',
      text: 'https://news.example/story',
      contains: undefined,
    },
    {
      label: 'video embed links to the Coves post page',
      embed: {
        $type: 'social.coves.embed.video#view',
        video: 'https://cdn.example/video.mp4',
      },
      href: POST_LINK,
      text: undefined,
      contains: undefined,
    },
    {
      label: 'record embed links to the Coves post page',
      embed: {
        $type: 'social.coves.embed.post#view',
        post: {
          uri: 'at://did:plc:dave/app.bsky.feed.post/3kbsky' as AtUri,
          cid: 'bafybskyaaaa' as CID,
        },
      },
      href: POST_LINK,
      text: undefined,
      contains: undefined,
    },
  ] satisfies {
    label: string
    embed: PostEmbed
    href: string
    text: string | undefined
    contains: string | undefined
  }[])('appends the $label', ({ embed, href, text, contains }) => {
    const item = postToRssItem(fixtures.post({}, { embed }), ORIGIN)
    const fragment = parse(item.html)
    const anchor = Array.from(fragment.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === href,
    )

    expect(anchor).toBeDefined()
    if (text !== undefined) expect(anchor?.textContent?.trim()).toBe(text)
    if (contains !== undefined) expect(fragment.textContent).toContain(contains)
    // The body comes first, the embed after it.
    const body = fragment.querySelector('em')
    expect(body?.textContent).toBe('world')
    expect(
      anchor && body
        ? body.compareDocumentPosition(anchor) &
            body.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).toBeTruthy()
  })

  it('appends one <img> per image embed entry, fullsize first', () => {
    const item = postToRssItem(
      fixtures.post(
        {},
        {
          embed: {
            $type: 'social.coves.embed.images#view',
            images: [
              {
                image:
                  'https://cdn.example/img/content_preview/plain/did:plc:alice/bafyimgone',
                thumb:
                  'https://cdn.example/img/content_preview/plain/did:plc:alice/bafyimgone',
                fullsize:
                  'https://cdn.example/img/content_full/plain/did:plc:alice/bafyimgone',
                alt: 'A cat',
              },
              {
                image:
                  'https://cdn.example/img/content_preview/plain/did:plc:alice/bafyimgtwo',
              },
            ],
          },
        },
      ),
      ORIGIN,
    )
    const images = Array.from(parse(item.html).querySelectorAll('img'))

    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'https://cdn.example/img/content_full/plain/did:plc:alice/bafyimgone',
      'https://cdn.example/img/content_preview/plain/did:plc:alice/bafyimgtwo',
    ])
    expect(images[0].getAttribute('alt')).toBe('A cat')
  })

  it('still links the embed of a post with no content', () => {
    const item = postToRssItem(
      fixtures.post(
        { content: undefined },
        {
          embed: external({
            uri: 'https://news.example/story',
            title: 'Story',
          }),
        },
      ),
      ORIGIN,
    )

    expect(hrefs(item.html)).toContain('https://news.example/story')
  })

  it('drops a javascript: external embed URI from every href', () => {
    const item = postToRssItem(
      fixtures.post(
        {},
        { embed: external({ uri: 'javascript:alert(1)', title: 'Click' }) },
      ),
      ORIGIN,
    )

    // The rest of the item still renders; only the unsafe target is dropped.
    expect(parse(item.html).querySelector('em')?.textContent).toBe('world')
    for (const href of hrefs(item.html)) {
      expect(href.toLowerCase()).not.toContain('javascript:')
    }
  })

  it('emits no <img> for a data: image URL and keeps the web ones', () => {
    const dataUrl = 'data:image/png;base64,AAAA'
    const item = postToRssItem(
      fixtures.post(
        {},
        {
          embed: {
            $type: 'social.coves.embed.images#view',
            images: [
              { image: dataUrl, fullsize: dataUrl, alt: 'pixel' },
              {
                image:
                  'https://cdn.example/img/content_preview/plain/did:plc:alice/bafyimgtwo',
              },
            ],
          },
        },
      ),
      ORIGIN,
    )

    const images = Array.from(parse(item.html).querySelectorAll('img'))

    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'https://cdn.example/img/content_preview/plain/did:plc:alice/bafyimgtwo',
    ])
    expect(item.html).not.toContain('data:image')
  })

  it('emits no <img> for an image entry with no URL and keeps the others', () => {
    const item = postToRssItem(
      fixtures.post(
        {},
        {
          embed: {
            $type: 'social.coves.embed.images#view',
            images: [
              { image: '', alt: 'missing' },
              {
                image:
                  'https://cdn.example/img/content_preview/plain/did:plc:alice/bafyimgtwo',
              },
            ],
          },
        },
      ),
      ORIGIN,
    )

    const images = Array.from(parse(item.html).querySelectorAll('img'))

    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'https://cdn.example/img/content_preview/plain/did:plc:alice/bafyimgtwo',
    ])
  })

  it('links an unhydrated record-shape images embed to the post as "View images"', () => {
    // The backend sends the raw record when blob hydration fails. That shape
    // is outside the PostEmbed union, so the fixture mirrors the wire data.
    const recordShapeEmbed = {
      $type: 'social.coves.embed.images',
      images: [
        {
          image: {
            $type: 'blob',
            ref: { $link: 'bafyimgone' },
            mimeType: 'image/jpeg',
            size: 1234,
          },
          alt: 'A cat',
        },
      ],
    } as unknown as PostEmbed
    const item = postToRssItem(
      fixtures.post({}, { embed: recordShapeEmbed }),
      ORIGIN,
    )
    const anchors = Array.from(parse(item.html).querySelectorAll('a'))

    expect(anchors.map((a) => [a.getAttribute('href'), a.textContent])).toEqual(
      [[POST_LINK, 'View images']],
    )
    expect(parse(item.html).querySelectorAll('img')).toHaveLength(0)
  })

  it.each([
    {
      label: 'external title and description',
      embed: external({
        uri: 'https://news.example/story',
        title: HOSTILE,
        description: HOSTILE,
      }),
    },
    {
      label: 'image alt text',
      embed: {
        $type: 'social.coves.embed.images#view',
        images: [
          {
            image:
              'https://cdn.example/img/content_preview/plain/did:plc:alice/bafyimgone',
            alt: HOSTILE,
          },
        ],
      },
    },
  ] satisfies { label: string; embed: PostEmbed }[])(
    'keeps markup in the $label as escaped text',
    ({ embed }) => {
      const item = postToRssItem(fixtures.post({}, { embed }), ORIGIN)
      const fragment = parse(item.html)

      expect(fragment.querySelector('script')).toBeNull()
      const anchor = fragment.querySelector(
        'a[href="https://news.example/story"]',
      )
      const img = fragment.querySelector('img')
      if (embed.$type === 'social.coves.embed.images#view') {
        expect(img?.getAttribute('alt')).toBe(HOSTILE)
      } else {
        expect(anchor?.textContent ?? '').toContain(HOSTILE)
        expect(fragment.textContent?.split(HOSTILE)).toHaveLength(3)
      }
    },
  )
})

describe('commentsToRssItems', () => {
  const COMMENT_LINK =
    'https://coves.test/c/gaming/post/alice.coves.test/3kabc/comment/bob.coves.test/3kcom1'

  it('maps a comment to an item titled after its parent post, dated and credited to the comment', () => {
    const [item, ...rest] = commentsToRssItems(
      [fixtures.comment()],
      [fixtures.post()],
      ORIGIN,
    )

    expect(rest).toHaveLength(0)
    expect(item?.title).toBe('Comment on "Parent title"')
    expect(item?.link).toBe(COMMENT_LINK)
    expect(item?.guid).toBe(
      'at://did:plc:bob/social.coves.community.comment/3kcom1',
    )
    expect(item?.publishedAt).toBe('2026-05-06T07:08:09.000Z')
    expect(item?.author).toBe('@bob.coves.test')
    expect(parse(item?.html ?? '').querySelector('em')?.textContent).toBe('one')
  })

  it('renders a faceted comment body from its facets', () => {
    const content = 'Nice *one* there'
    const [item] = commentsToRssItems(
      [
        fixtures.comment({
          content,
          facets: [facetOver(content, 'there', { $type: FEATURE_TYPE.bold })],
        }),
      ],
      [fixtures.post()],
      ORIGIN,
    )
    const fragment = parse(item?.html ?? '')

    expect(fragment.querySelector('strong')?.textContent).toBe('there')
    expect(fragment.querySelector('em')).toBeNull()
  })

  it('titles a comment on an untitled NSFW-labelled post without the withheld body', () => {
    const [item] = commentsToRssItems(
      [fixtures.comment()],
      [
        fixtures.post({
          title: undefined,
          content: 'Secret spicy body',
          labels: {
            $type: 'com.atproto.label.defs#selfLabels',
            values: [{ val: 'nsfw' }],
          },
        }),
      ],
      ORIGIN,
    )

    expect(item?.title).not.toContain('Secret')
    expect(item?.title).not.toContain('spicy')
    expect(item?.title).toBe('Comment on "Post by @alice.coves.test"')
  })

  const BAD_URI =
    'at://did:plc:bob/social.coves.community.comment/3kbad' as AtUri

  function withoutRecord(comment: CommentView): CommentView {
    const copy = { ...comment }
    delete copy.record
    return copy
  }

  it.each([
    [
      'record omitted (tombstone)',
      withoutRecord(fixtures.comment({}, { uri: BAD_URI })),
    ],
    [
      'record null (older tombstone)',
      fixtures.comment({}, { uri: BAD_URI, record: null }),
    ],
    [
      'flagged isDeleted',
      fixtures.comment({}, { uri: BAD_URI, isDeleted: true }),
    ],
    [
      'author missing',
      fixtures.comment({}, { uri: BAD_URI, author: undefined }),
    ],
    [
      'parent post not hydrated',
      fixtures.comment(
        {},
        {
          uri: BAD_URI,
          post: { uri: OTHER_POST_URI, cid: 'bafyotheraaaa' as CID },
        },
      ),
    ],
  ])('omits a comment with %s', (_label, bad) => {
    const items = commentsToRssItems(
      [fixtures.comment(), bad],
      [fixtures.post()],
      ORIGIN,
    )

    expect(items.map((item) => item.guid)).toEqual([COMMENT_URI])
  })

  it('appends the image or external embed of a comment after its body', () => {
    const [withImage, withExternal] = commentsToRssItems(
      [
        fixtures.comment(
          {},
          {
            embed: {
              $type: 'social.coves.embed.images#view',
              images: [
                {
                  image:
                    'https://cdn.example/img/content_preview/plain/did:plc:bob/bafycommentimg',
                },
              ],
            },
          },
        ),
        fixtures.comment(
          {},
          {
            uri: 'at://did:plc:bob/social.coves.community.comment/3kcom2' as AtUri,
            embed: external({
              uri: 'https://news.example/story',
              title: 'Story',
            }),
          },
        ),
      ],
      [fixtures.post()],
      ORIGIN,
    )
    const imageFragment = parse(withImage?.html ?? '')
    const externalFragment = parse(withExternal?.html ?? '')

    expect(imageFragment.querySelector('em')?.textContent).toBe('one')
    expect(
      Array.from(imageFragment.querySelectorAll('img'), (img) =>
        img.getAttribute('src'),
      ),
    ).toEqual([
      'https://cdn.example/img/content_preview/plain/did:plc:bob/bafycommentimg',
    ])
    expect(externalFragment.querySelector('em')?.textContent).toBe('one')
    expect(hrefs(withExternal?.html ?? '')).toEqual([
      'https://news.example/story',
    ])
  })

  it('preserves comment order across parent posts', () => {
    const otherPost = fixtures.post(
      { title: 'Other title' },
      {
        uri: OTHER_POST_URI,
        rkey: '3kxyz',
        author: {
          did: 'did:plc:carol' as DID,
          handle: 'carol.coves.test' as Handle,
        },
      },
    )
    const second = fixtures.comment(
      {},
      {
        uri: 'at://did:plc:bob/social.coves.community.comment/3kcom2' as AtUri,
        post: { uri: OTHER_POST_URI, cid: 'bafyotheraaaa' as CID },
      },
    )
    const third = fixtures.comment(
      {},
      {
        uri: 'at://did:plc:bob/social.coves.community.comment/3kcom3' as AtUri,
      },
    )

    const items = commentsToRssItems(
      [fixtures.comment(), second, third],
      [otherPost, fixtures.post()],
      ORIGIN,
    )

    expect(items.map((item) => item.guid)).toEqual([
      'at://did:plc:bob/social.coves.community.comment/3kcom1',
      'at://did:plc:bob/social.coves.community.comment/3kcom2',
      'at://did:plc:bob/social.coves.community.comment/3kcom3',
    ])
    expect(items[1]?.title).toBe('Comment on "Other title"')
    expect(items[1]?.link).toBe(
      'https://coves.test/c/gaming/post/carol.coves.test/3kxyz/comment/bob.coves.test/3kcom2',
    )
  })
})
