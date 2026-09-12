import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { AtUri, CID, PostEmbed, PostView } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import { settings } from '$lib/app/state/settings.svelte'
import Post from './Post.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const image = 'https://media.example/sensitive-image.jpg'
const thumbnail = 'https://media.example/sensitive-thumbnail.jpg'
const embeds: Record<string, PostEmbed> = {
  image: {
    $type: 'social.coves.embed.images#view',
    images: [
      { image, thumb: thumbnail, fullsize: image, alt: 'Sensitive image' },
    ],
  },
  link: {
    $type: 'social.coves.embed.external#view',
    external: {
      uri: 'https://example.com/article',
      title: 'Article',
      thumb: thumbnail,
    },
  },
  video: {
    $type: 'social.coves.embed.video#view',
    video: 'https://media.example/sensitive.mp4',
    thumbnail,
  },
  youtube: {
    $type: 'social.coves.embed.external#view',
    external: {
      uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      thumb: thumbnail,
    },
  },
}

function fixture(
  labels: unknown,
  embed = embeds.image,
  federated = false,
): PostView {
  return {
    uri: 'at://did:plc:author/social.coves.community.post/one' as AtUri,
    cid: 'bafyreiexample' as CID,
    rkey: 'one',
    indexedAt: '2026-09-01T00:00:00Z',
    createdAt: '2026-09-01T00:00:00Z',
    author: {
      did: 'did:plc:author' as DID,
      handle: 'author.example' as Handle,
    },
    community: { did: 'did:plc:community' as DID, name: 'Community' },
    record: {
      $type: 'social.coves.community.post',
      community: 'did:plc:community',
      author: 'did:plc:author',
      createdAt: '2026-09-01T00:00:00Z',
      title: 'Post title',
      labels,
      ...(federated
        ? {
            federatedFrom: {
              protocol: 'activitypub',
              originalUri: 'https://lemmy.world/post/123',
            },
          }
        : {}),
    },
    embed,
  }
}

function markup(post: PostView, view: 'cozy' | 'compact' = 'cozy'): string {
  return render(Post, { props: { post, view, actions: false } }).body
}

beforeEach(() => {
  settings.nsfwBlur = true
})

describe('sensitive post server rendering', () => {
  for (const federated of [false, true]) {
    for (const view of ['cozy', 'compact'] as const) {
      it(`labels ${federated ? 'Tidepool' : 'local'} posts in ${view} view`, () => {
        const html = markup(
          fixture({ values: [{ val: 'nsfw' }] }, embeds.image, federated),
          view,
        )
        expect(html).toMatch(/>\s*NSFW\s*</)
        expect(html).toMatch(
          /<button\b[^>]*aria-label="Show sensitive content"[^>]*>/,
        )
      })
      for (const [kind, embed] of Object.entries(embeds)) {
        it(`withholds ${kind} media for ${federated ? 'Tidepool' : 'local'} ${view} posts`, () => {
          const html = markup(
            fixture({ values: [{ val: 'nsfw' }] }, embed, federated),
            view,
          )
          if (kind === 'image') {
            expect(html).toContain('sensitive-thumbnail.jpg')
            expect(html).not.toContain('sensitive-image.jpg')
            expect(html).toContain('NSFW Content')
            expect(html).toMatch(/>\s*Show\s*</)
          } else {
            expect(html).not.toContain('media.example')
          }
          expect(html).not.toMatch(/<(?:iframe|video|source)\b/)
        })
      }
    }
  }

  it.each([
    { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'nsfw' }] },
    { values: [{ val: 'nsfw', neg: false }] },
    { values: [null, {}, { val: 'other' }, { val: 'nsfw' }] },
  ])('conceals active NSFW labels in %j', (labels) => {
    const html = markup(fixture(labels))
    expect(html).toMatch(/>\s*NSFW\s*</)
    expect(html).not.toContain('sensitive-image.jpg')
  })

  it('renders the NSFW Content row and Show action on the server', () => {
    const html = markup(fixture({ values: [{ val: 'nsfw' }] }, embeds.link))
    expect(html).toContain('NSFW Content')
    expect(html).toMatch(/>\s*Show\s*</)
  })

  it('keeps the title when the duplicate link card is concealed', () => {
    const previous = settings.posts.deduplicateEmbed
    settings.posts.deduplicateEmbed = true
    try {
      const post = fixture({ values: [{ val: 'nsfw' }] }, embeds.link)
      if (!post.record) throw new Error('Missing post record')
      post.record.title = 'Article'
      const html = markup(post)
      expect(html).toMatch(/<h3\b[^>]*>[\s\S]*?Article[\s\S]*?<\/h3>/)
      expect(html).not.toContain('sensitive-thumbnail.jpg')
    } finally {
      settings.posts.deduplicateEmbed = previous
    }
  })

  it('keeps the badge when the viewer disables sensitive media concealment', () => {
    settings.nsfwBlur = false
    const html = markup(fixture({ values: [{ val: 'nsfw' }] }))
    expect(html).toMatch(/>\s*NSFW\s*</)
    expect(html).toContain('sensitive-image.jpg')
  })

  it.each([
    undefined,
    null,
    {},
    { values: null },
    { values: {} },
    { values: [null, 3, {}] },
    { values: [{ val: 'other' }] },
    { values: [{ val: 'nsfw', neg: true }] },
    { values: [{ val: 'nsfw', neg: 'false' }] },
    { values: [{ val: 'nsfw', neg: 'true' }] },
  ])(
    'renders non-sensitive or malformed labels %j without hiding ordinary media',
    (labels) => {
      const html = markup(fixture(labels))
      expect(html).not.toMatch(/>\s*NSFW\s*</)
      expect(html).toContain('sensitive-image.jpg')
    },
  )
})

describe('sensitive post body concealment', () => {
  // A markdown image in the body degrades to its alt text and nothing else, so
  // the concealment signal to assert on is the alt text 'Body image'. The URL
  // is absent whether or not the body is revealed; both halves pin that.
  const content =
    'Sensitive body details\n\n![Body image](https://media.example/body-image.jpg)'

  it('withholds body text and image alt text alongside embedded media', () => {
    const post = fixture({ values: [{ val: 'nsfw' }] })
    if (!post.record) throw new Error('Missing post record')
    post.record.content = content
    const html = markup(post)
    expect(html).not.toContain('Sensitive body details')
    expect(html).not.toContain('Body image')
    expect(html).not.toContain('body-image.jpg')
    expect(html).toContain('Post title')
  })

  it('does not expose the body as a compact title fallback while concealed', () => {
    const post = fixture({ values: [{ val: 'nsfw' }] })
    if (!post.record) throw new Error('Missing post record')
    post.record.title = undefined
    post.record.content = content
    expect(markup(post, 'compact')).not.toContain('Sensitive body details')
  })

  it.each([false, true])(
    'shows body text and image alt text when concealment is not requested (labeled=%s)',
    (labeled) => {
      settings.nsfwBlur = !labeled
      const post = fixture(labeled ? { values: [{ val: 'nsfw' }] } : undefined)
      if (!post.record) throw new Error('Missing post record')
      post.record.content = content
      const html = markup(post)
      expect(html).toContain('Sensitive body details')
      expect(html).toContain('Body image')
      expect(html).not.toContain('body-image.jpg')
    },
  )
})

describe('native preview dimensions', () => {
  it('uses the revealed image intrinsic dimensions and height cap in cozy view', () => {
    const html = markup(fixture({ values: [{ val: 'nsfw' }] }))
    const decorativeImages = [
      ...html.matchAll(/<img\b[^>]*aria-hidden="true"[^>]*>/g),
    ].map((match) => match[0])
    const preview = decorativeImages.find(
      (image) => !/class="[^"]*\babsolute\b/.test(image),
    )
    for (const image of decorativeImages) {
      expect(image).toContain('sensitive-thumbnail.jpg')
      expect(image).not.toContain('sensitive-image.jpg')
      expect(image).toContain('blur(')
    }
    expect(preview).toBeDefined()
    expect(preview).toMatch(/\bwidth="512"/)
    expect(preview).toMatch(/\bheight="300"/)
    expect(preview).toContain('max-h-[60vh]')
    expect(preview).not.toContain('aspect-square')
  })

  it('uses the existing compact thumbnail sizes without forcing a square', () => {
    const html = markup(fixture({ values: [{ val: 'nsfw' }] }), 'compact')
    const button = [
      ...html.matchAll(
        /<button\b[^>]*aria-label="Show sensitive content"[^>]*>[\s\S]*?<\/button>/g,
      ),
    ]
      .map((match) => match[0])
      .find((button) => button.includes('<img'))
    expect(button).toBeDefined()
    expect(button).toContain('w-22')
    expect(button).toContain('h-22')
    expect(button).toContain('sm:w-28')
    expect(button).not.toContain('aspect-square')
  })
})
