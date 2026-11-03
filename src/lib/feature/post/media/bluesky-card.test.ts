import { describe, expect, it } from 'vitest'
import type {
  AtUri,
  CID,
  ExternalEmbed,
  ImageEmbed,
  RecordEmbed,
} from '$lib/api/coves/types'
import { titleDuplicatesBlueskyEmbed } from './bluesky-card'

const BLUESKY_URI = 'at://did:plc:alice/app.bsky.feed.post/root'

function blueskyEmbed(
  resolved: unknown,
  options: { $type?: RecordEmbed['$type']; uri?: string } = {},
): RecordEmbed {
  return {
    $type: options.$type ?? 'social.coves.embed.post#view',
    post: {
      uri: (options.uri ?? BLUESKY_URI) as AtUri,
      cid: 'bafyreibluesky' as CID,
    },
    resolved,
  }
}

function resolvedPost(text: unknown): Record<string, unknown> {
  return {
    uri: BLUESKY_URI,
    cid: 'bafyreibluesky',
    author: { did: 'did:plc:alice', handle: 'sky.example' },
    text,
    unavailable: false,
  }
}

describe('titleDuplicatesBlueskyEmbed', () => {
  it.each(['social.coves.embed.post', 'social.coves.embed.post#view'] as const)(
    'matches an identical title for %s embeds',
    ($type) => {
      expect(
        titleDuplicatesBlueskyEmbed(
          'Hello world',
          blueskyEmbed(resolvedPost('Hello world'), { $type }),
        ),
      ).toBe(true)
    },
  )

  it('matches after collapsing whitespace runs and newlines in the text', () => {
    expect(
      titleDuplicatesBlueskyEmbed(
        'Hello  world',
        blueskyEmbed(resolvedPost('  Hello\n\nworld \n')),
      ),
    ).toBe(true)
  })

  it('matches after trimming the title', () => {
    expect(
      titleDuplicatesBlueskyEmbed(
        '  Hello world  ',
        blueskyEmbed(resolvedPost('Hello world')),
      ),
    ).toBe(true)
  })

  it('does not match different text', () => {
    expect(
      titleDuplicatesBlueskyEmbed(
        'Hello world',
        blueskyEmbed(resolvedPost('Goodbye world')),
      ),
    ).toBe(false)
  })

  it('does not match when only letter case differs', () => {
    expect(
      titleDuplicatesBlueskyEmbed(
        'Hello World',
        blueskyEmbed(resolvedPost('hello world')),
      ),
    ).toBe(false)
  })

  it('does not match a title that is only a prefix of the text', () => {
    expect(
      titleDuplicatesBlueskyEmbed(
        'Shipping the new release',
        blueskyEmbed(resolvedPost('Shipping the new release today')),
      ),
    ).toBe(false)
  })

  it('does not match an undefined title', () => {
    expect(
      titleDuplicatesBlueskyEmbed(undefined, blueskyEmbed(resolvedPost(''))),
    ).toBe(false)
  })

  it('does not match an empty title against empty text', () => {
    expect(
      titleDuplicatesBlueskyEmbed('', blueskyEmbed(resolvedPost(''))),
    ).toBe(false)
  })

  it('does not match a whitespace-only title against whitespace-only text', () => {
    expect(
      titleDuplicatesBlueskyEmbed('   ', blueskyEmbed(resolvedPost(' \n '))),
    ).toBe(false)
  })

  it('does not match an undefined embed', () => {
    expect(titleDuplicatesBlueskyEmbed('Hello world', undefined)).toBe(false)
  })

  it('does not match a link card whose title equals the post title', () => {
    const link: ExternalEmbed = {
      $type: 'social.coves.embed.external#view',
      external: { uri: 'https://example.com/article', title: 'Hello world' },
    }
    expect(titleDuplicatesBlueskyEmbed('Hello world', link)).toBe(false)
  })

  it('does not match an image embed whose alt text equals the post title', () => {
    const images: ImageEmbed = {
      $type: 'social.coves.embed.images#view',
      images: [{ image: 'https://media.example/a.jpg', alt: 'Hello world' }],
    }
    expect(titleDuplicatesBlueskyEmbed('Hello world', images)).toBe(false)
  })

  it('does not match a generic record embed pointing at a Bluesky post', () => {
    expect(
      titleDuplicatesBlueskyEmbed(
        'Hello world',
        blueskyEmbed(resolvedPost('Hello world'), {
          $type: 'social.coves.embed.record#view',
        }),
      ),
    ).toBe(false)
  })

  it('does not match a converted post embed outside the Bluesky post collection', () => {
    expect(
      titleDuplicatesBlueskyEmbed(
        'Hello world',
        blueskyEmbed(resolvedPost('Hello world'), {
          uri: 'at://did:plc:alice/social.coves.community.post/root',
        }),
      ),
    ).toBe(false)
  })

  it('does not match when the post was not resolved', () => {
    expect(
      titleDuplicatesBlueskyEmbed('Hello world', blueskyEmbed(undefined)),
    ).toBe(false)
  })

  it('does not match matching text on an unavailable post', () => {
    expect(
      titleDuplicatesBlueskyEmbed(
        'Hello world',
        blueskyEmbed({ ...resolvedPost('Hello world'), unavailable: true }),
      ),
    ).toBe(false)
  })

  it('does not match matching text when the author is missing', () => {
    const { author: _author, ...withoutAuthor } = resolvedPost('Hello world')
    expect(
      titleDuplicatesBlueskyEmbed('Hello world', blueskyEmbed(withoutAuthor)),
    ).toBe(false)
  })

  it('does not match matching text when the author DID is invalid', () => {
    expect(
      titleDuplicatesBlueskyEmbed(
        'Hello world',
        blueskyEmbed({
          ...resolvedPost('Hello world'),
          author: { did: 'not-a-did', handle: 'sky.example' },
        }),
      ),
    ).toBe(false)
  })

  it.each([
    ['missing', undefined],
    ['non-string', 42],
  ])('does not match when the resolved text is %s', (_case, text) => {
    expect(
      titleDuplicatesBlueskyEmbed(
        'Hello world',
        blueskyEmbed(resolvedPost(text)),
      ),
    ).toBe(false)
  })
})
