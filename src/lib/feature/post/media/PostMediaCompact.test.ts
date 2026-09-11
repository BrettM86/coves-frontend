import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { PostEmbed } from '$lib/api/coves/types'
import { mediaType } from '../helpers'
import PostMediaCompact from './PostMediaCompact.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

// ---------------------------------------------------------------------------
// The compact thumbnail is the third `<img src>` sink for embed media. Unlike
// PostLink and PostIframe it takes the whole embed rather than a URL prop, so
// it reaches the address through extractEmbedThumbnail and bestImageURL — the
// helpers gated in the previous cycle. These tests pin that the gate actually
// reaches this surface, and that a rejected thumbnail collapses to the icon
// placeholder instead of an `<img src="">`.
// ---------------------------------------------------------------------------

const UNSAFE_MEDIA_URLS: readonly string[] = [
  'file:///etc/passwd',
  'javascript:alert(1)',
  'data:text/html,x.png',
  '//example.com/x.png',
  '/x.png',
  'relative/x.png',
  'https://',
]

const SAFE_MEDIA_URLS: readonly string[] = [
  'https://cdn.example.com/x.png',
  'http://cdn.example.com/x.png',
]

const ARTICLE_URL = 'https://example.com/article'

const externalEmbed = (thumb: string): PostEmbed => ({
  $type: 'social.coves.embed.external#view',
  external: { uri: ARTICLE_URL, title: 'Article', thumb },
})

const videoEmbed = (thumbnail: string): PostEmbed => ({
  $type: 'social.coves.embed.video#view',
  video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  thumbnail,
})

const markup = (embed: PostEmbed): string =>
  render(PostMediaCompact, {
    props: { embed, type: mediaType(embed), view: 'compact' as const },
  }).body

const imageTags = (html: string): string[] =>
  [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0])

describe('PostMediaCompact - external embed thumbnail', () => {
  it.each(UNSAFE_MEDIA_URLS)('emits no image for %j', (thumb) => {
    const images = imageTags(markup(externalEmbed(thumb)))
    expect(images).toEqual([])
  })

  it.each(SAFE_MEDIA_URLS)('renders %j unchanged', (thumb) => {
    const images = imageTags(markup(externalEmbed(thumb)))
    expect(images).toHaveLength(1)
    expect(images[0]).toContain(`src="${thumb}"`)
  })
})

describe('PostMediaCompact - video embed thumbnail', () => {
  it.each(UNSAFE_MEDIA_URLS)('emits no image for %j', (thumbnail) => {
    expect(imageTags(markup(videoEmbed(thumbnail)))).toEqual([])
  })

  it.each(SAFE_MEDIA_URLS)('renders %j unchanged', (thumbnail) => {
    const images = imageTags(markup(videoEmbed(thumbnail)))
    expect(images).toHaveLength(1)
    expect(images[0]).toContain(`src="${thumbnail}"`)
  })
})
