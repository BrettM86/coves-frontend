import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type {
  AtUri,
  CID,
  PostEmbed,
  RecordEmbed,
} from '$lib/api/coves/types'
import { settings } from '$lib/app/state/settings.svelte'
import { mediaType } from '../helpers'
import PostMedia from './PostMedia.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

const DEFAULT_POST_URI =
  'at://did:plc:alice/app.bsky.feed.post/post-key'

interface EmbedOptions {
  readonly type?: RecordEmbed['$type']
  readonly postUri?: string
  readonly omitResolved?: boolean
}

const success = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  uri: DEFAULT_POST_URI,
  cid: 'bafyreipost',
  author: {
    did: 'did:plc:alice',
    handle: 'sky.example',
    displayName: 'Sky Pilot',
  },
  text: 'A text-only Bluesky post.',
  createdAt: '2026-09-18T14:30:00Z',
  replyCount: 7,
  repostCount: 8,
  likeCount: 9,
  mediaCount: 0,
  hasMedia: false,
  unavailable: false,
  ...overrides,
})

const postEmbed = (
  resolved: unknown,
  options: EmbedOptions = {},
): PostEmbed => {
  const embed: RecordEmbed = {
    $type: options.type ?? 'social.coves.embed.post#view',
    post: {
      uri: (options.postUri ?? DEFAULT_POST_URI) as AtUri,
      cid: 'bafyreipost' as CID,
    },
  }

  return options.omitResolved ? embed : { ...embed, resolved }
}

const markup = (embed: PostEmbed): string =>
  render(PostMedia, {
    props: { embed, type: mediaType(embed), view: 'cozy' as const },
  }).body

const anchorTags = (html: string): string[] =>
  [...html.matchAll(/<a\b[^>]*>/gi)].map((match) => match[0])

const anchorBlocks = (html: string): string[] =>
  [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].map(
    (match) => match[0],
  )

const linksTo = (html: string, href: string): string[] =>
  anchorTags(html).filter((tag) => tag.includes(`href="${href}"`))

const blueskyPostLinks = (html: string): string[] =>
  anchorTags(html).filter(
    (tag) =>
      tag.includes('href="https://bsky.app/profile/') &&
      tag.includes('/post/'),
  )

afterEach(() => {
  settings.openLinksInNewTab = false
})

describe('resolved Bluesky text card', () => {
  it('renders the legacy text-only shape with DIM chrome and read-only details', () => {
    const html = markup(
      postEmbed(
        success({
          author: {
            did: 'did:plc:alice',
            handle: 'sky.example',
            displayName: '   ',
          },
          text: 'Plain <script>alert("no")</script> & selectable.',
        }),
        { type: 'social.coves.embed.post' },
      ),
    )

    expect(html).toMatch(/>\s*sky\.example\s*</)
    expect(html).toContain('@sky.example')
    expect(html).toMatch(
      /Plain &lt;script(?:>|&gt;)alert\("no"\)&lt;\/script(?:>|&gt;) &amp; selectable\./,
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('bg-bluesky-surface')
    expect(html).toContain('border-bluesky-border')
    expect(html).toContain('text-bluesky-brand')

    const profileUrl = 'https://bsky.app/profile/sky.example'
    expect(linksTo(html, profileUrl).length).toBeGreaterThan(0)
    expect(
      anchorBlocks(html).some(
        (link) => link.includes(`href="${profileUrl}"`) && /<svg\b/i.test(link),
      ),
    ).toBe(true)
    expect(linksTo(html, `${profileUrl}/post/post-key`).length).toBe(1)

    expect(html).toMatch(
      /<time\b[^>]*datetime="2026-09-18T14:30:00Z"[^>]*>/,
    )
    expect(html).toMatch(/aria-label="Replies: 7"/i)
    expect(html).toMatch(/aria-label="Reposts: 8"/i)
    expect(html).toMatch(/aria-label="Likes: 9"/i)
    expect(html).not.toContain('<button')
  })

  it('applies the new-tab setting and safe rel policy to every Bluesky link', () => {
    for (const openLinksInNewTab of [false, true]) {
      settings.openLinksInNewTab = openLinksInNewTab
      const html = markup(postEmbed(success()))
      const links = anchorTags(html).filter((tag) =>
        tag.includes('href="https://bsky.app/'),
      )

      expect(links.length).toBeGreaterThanOrEqual(2)
      for (const link of links) {
        if (openLinksInNewTab) {
          expect(link).toContain('target="_blank"')
        } else {
          expect(link).not.toContain('target=')
        }
        const rel = link.match(/\brel="([^"]*)"/)?.[1].split(/\s+/)
        expect(rel).toEqual(
          expect.arrayContaining(['noopener', 'noreferrer', 'nofollow']),
        )
      }
    }
  })
})

describe('Bluesky identity and canonical links', () => {
  it.each([
    ['a missing handle', undefined],
    ['the unresolved handle sentinel', 'handle.invalid'],
  ])('falls back to the DID for %s', (_label, handle) => {
    const html = markup(
      postEmbed(
        success({
          author: { did: 'did:plc:alice', handle, displayName: '' },
        }),
      ),
    )

    expect(html).toMatch(/>\s*did:plc:alice\s*</)
    expect(html).not.toContain('handle.invalid')
    expect(
      linksTo(html, 'https://bsky.app/profile/did%3Aplc%3Aalice').length,
    ).toBeGreaterThan(0)
    expect(
      linksTo(
        html,
        'https://bsky.app/profile/did%3Aplc%3Aalice/post/post-key',
      ).length,
    ).toBe(1)
  })

  it.each([
    {
      label: 'substitutes a handle when the author DID owns the URI',
      actor: 'did:plc:alice',
      authorDid: 'did:plc:alice',
      handle: 'sky.example',
      expectedActor: 'sky.example',
    },
    {
      label: 'keeps an authority that is already the matching handle',
      actor: 'sky.example',
      authorDid: 'did:plc:elsewhere',
      handle: 'sky.example',
      expectedActor: 'sky.example',
    },
    {
      label: 'preserves a DID authority when the supplied identity mismatches',
      actor: 'did:plc:owner',
      authorDid: 'did:plc:impostor',
      handle: 'impostor.example',
      expectedActor: 'did%3Aplc%3Aowner',
    },
  ])('$label', ({ actor, authorDid, handle, expectedActor }) => {
    const uri = `at://${actor}/app.bsky.feed.post/post:key`
    const html = markup(
      postEmbed(
        success({
          uri,
          author: { did: authorDid, handle, displayName: 'Visible author' },
          text: 'Canonical link positive control.',
        }),
      ),
    )

    expect(html).toContain('Canonical link positive control.')
    expect(
      linksTo(
        html,
        `https://bsky.app/profile/${expectedActor}/post/post%3Akey`,
      ).length,
    ).toBe(1)
    if (authorDid !== actor && actor !== handle) {
      expect(html).not.toContain(
        `https://bsky.app/profile/${handle}/post/post%3Akey`,
      )
    }
  })

  it('falls back to the original post ref only when resolved.uri is absent', () => {
    const withoutUri = success({ text: 'Fallback URI positive control.' })
    delete withoutUri.uri
    const html = markup(
      postEmbed(withoutUri, {
        postUri: 'at://did:plc:alice/app.bsky.feed.post/fallback:key',
      }),
    )

    expect(html).toContain('Fallback URI positive control.')
    expect(
      linksTo(
        html,
        'https://bsky.app/profile/sky.example/post/fallback%3Akey',
      ).length,
    ).toBe(1)
  })

  it('does not replace a malformed resolved.uri with the original post ref', () => {
    const html = markup(
      postEmbed(success({ uri: 'not an at-uri', text: 'Still safe text.' })),
    )

    expect(html).toContain('Still safe text.')
    expect(blueskyPostLinks(html)).toEqual([])
  })

  it('keeps rendering safe text when an AT ref has extra path segments', () => {
    const html = markup(
      postEmbed(
        success({
          uri: 'at://did:plc:alice/app.bsky.feed.post/key/extra',
          text: 'Malformed ref positive control.',
        }),
      ),
    )

    expect(html).toContain('Malformed ref positive control.')
    expect(blueskyPostLinks(html)).toEqual([])
  })

  it.each([
    {
      label: 'a converted post targeting another collection',
      type: 'social.coves.embed.post#view' as const,
      postUri: 'at://did:plc:alice/app.bsky.feed.post.extra/post-key',
    },
    {
      label: 'a generic record embed',
      type: 'social.coves.embed.record#view' as const,
      postUri: DEFAULT_POST_URI,
    },
  ])('does not treat $label as a Bluesky card', ({ type, postUri }) => {
    const validHtml = markup(
      postEmbed(success({ text: 'Valid Bluesky positive control.' })),
    )
    expect(validHtml).toContain('Valid Bluesky positive control.')

    const unrelatedHtml = markup(
      postEmbed(success({ text: 'Must stay outside Bluesky rendering.' }), {
        type,
        postUri,
      }),
    )
    expect(unrelatedHtml).not.toContain('Must stay outside Bluesky rendering.')
  })
})

describe('runtime resolved-data fallbacks', () => {
  it('ignores malformed optional author values without losing the safe card', () => {
    const html = markup(
      postEmbed(
        success({
          author: {
            did: 'did:plc:alice',
            handle: 'sky.example',
            displayName: ['MALFORMED_DISPLAY_NAME'],
            avatar: { url: 'MALFORMED_AVATAR' },
          },
          text: 'Optional-data positive control.',
        }),
      ),
    )

    expect(html).toContain('Optional-data positive control.')
    expect(html).toMatch(/>\s*sky\.example\s*</)
    expect(html).not.toContain('MALFORMED_DISPLAY_NAME')
    expect(html).not.toContain('MALFORMED_AVATAR')
    expect(html).not.toContain('[object Object]')
  })

  it.each([
    {
      label: 'an unavailable response',
      embed: postEmbed({
        unavailable: true,
        message: 'This Bluesky post was removed.',
        retryable: false,
      }),
      message: 'This Bluesky post was removed.',
    },
    {
      label: 'a message-only response',
      embed: postEmbed({ message: 'The resolver returned no post.' }),
      message: 'The resolver returned no post.',
    },
    {
      label: 'a missing resolved response',
      embed: postEmbed(undefined, { omitResolved: true }),
      message: 'This Bluesky post is unavailable',
    },
  ])('shows a fallback for $label', ({ embed, message }) => {
    const html = markup(embed)

    expect(html).toContain(message)
    expect(html).toMatch(/Bluesky/i)
  })

  it('lets unavailable override success identity, text, and media', () => {
    const html = markup(
      postEmbed({
        ...success(),
        unavailable: true,
        message: 'This blocked Bluesky post is unavailable.',
        author: {
          did: 'did:plc:blocked',
          handle: 'blocked.example',
          displayName: 'BLOCKED_AUTHOR_NAME',
          avatar:
            'https://cdn.bsky.app/img/avatar/plain/did:plc:blocked/BLOCKED_AVATAR',
        },
        text: 'BLOCKED_POST_TEXT',
        images: [
          {
            thumb:
              'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:blocked/BLOCKED_MEDIA',
            fullsize:
              'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:blocked/BLOCKED_MEDIA',
            alt: 'BLOCKED_MEDIA_ALT',
          },
        ],
      }),
    )

    expect(html).toContain('This blocked Bluesky post is unavailable.')
    expect(html).not.toContain('BLOCKED_AUTHOR_NAME')
    expect(html).not.toContain('blocked.example')
    expect(html).not.toContain('BLOCKED_AVATAR')
    expect(html).not.toContain('BLOCKED_POST_TEXT')
    expect(html).not.toContain('BLOCKED_MEDIA')
    expect(html).not.toContain('BLOCKED_MEDIA_ALT')
  })
})
