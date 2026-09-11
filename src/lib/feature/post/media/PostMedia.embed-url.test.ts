import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { PostEmbed } from '$lib/api/coves/types'
import { mediaType } from '../helpers'
import PostMedia from './PostMedia.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

// ---------------------------------------------------------------------------
// An embed's thumbnail is untrusted: `external.thumb` and a video embed's
// `thumbnail` are plain strings on a record that may have been written straight
// to a PDS, so nothing upstream guarantees they are http(s) at all. They reach
// an `<img src>` sink through extractEmbedThumbnail -> PostLink / PostIframe.
//
// This test drives the whole path from outside the helpers: it renders
// PostMedia the way a feed does, with `type: mediaType(embed)`, and asserts on
// the markup that actually reaches the browser. PostMedia's `type` defaults to
// 'none', which renders nothing, so passing the classified type is what makes
// the assertions meaningful.
//
// svelte/server's render() is lazy — a throw inside the template surfaces only
// when `.body` is read — so every assertion goes through markup().
// ---------------------------------------------------------------------------

const HOSTILE_URLS: readonly string[] = [
  'file:///etc/passwd',
  'javascript:alert(1)',
  'data:text/html,x.png',
]

const ARTICLE_URL = 'https://example.com/article'
const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const SAFE_THUMBNAIL = 'https://cdn.example.com/thumb.png'

interface Options {
  readonly view?: 'cozy' | 'compact'
  readonly opened?: boolean
}

const markup = (embed: PostEmbed, options: Options = {}): string =>
  render(PostMedia, {
    props: {
      embed,
      type: mediaType(embed),
      view: options.view ?? 'cozy',
      ...(options.opened === undefined ? {} : { opened: options.opened }),
    },
  }).body

const imageTags = (html: string): string[] =>
  [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0])

const externalEmbed = (thumb: string): PostEmbed => ({
  $type: 'social.coves.embed.external#view',
  external: { uri: ARTICLE_URL, title: 'Article', thumb },
})

const videoEmbed = (thumbnail: string): PostEmbed => ({
  $type: 'social.coves.embed.video#view',
  video: WATCH_URL,
  thumbnail,
})

// ---------------------------------------------------------------------------
// A. External link card
// ---------------------------------------------------------------------------

describe('PostMedia - external embed thumbnail', () => {
  it.each(HOSTILE_URLS)('emits no image for a %j thumbnail', (thumb) => {
    expect(imageTags(markup(externalEmbed(thumb)))).toEqual([])
  })

  // B. Positive control: an ordinary https thumbnail still renders. withPreset
  // passes a non-proxy URL through unchanged, so the src is the literal value.
  it('renders an https thumbnail unchanged', () => {
    const images = imageTags(markup(externalEmbed(SAFE_THUMBNAIL)))
    expect(images.some((image) => image.includes(SAFE_THUMBNAIL))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// C. Closed video player preview
// ---------------------------------------------------------------------------

describe('PostMedia - video embed thumbnail', () => {
  it.each(HOSTILE_URLS)(
    'emits no preview image for a %j thumbnail',
    (thumbnail) => {
      expect(
        imageTags(markup(videoEmbed(thumbnail), { opened: false })),
      ).toEqual([])
    },
  )

  it('renders an https preview thumbnail unchanged', () => {
    const images = imageTags(
      markup(videoEmbed(SAFE_THUMBNAIL), { opened: false }),
    )
    expect(images.some((image) => image.includes(SAFE_THUMBNAIL))).toBe(true)
  })
})
