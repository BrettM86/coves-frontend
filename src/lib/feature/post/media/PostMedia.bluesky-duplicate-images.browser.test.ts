// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { AtUri, CID, PostEmbed } from '$lib/api/coves/types'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))

const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */
    require_.resolve('svelte/package.json').replace('package.json', subpath)
  )
}
vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))
vi.mock('svelte/reactivity', () =>
  svelteClientEntry('src/reactivity/index-client.js'),
)

const SHARED_THUMB =
  'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/shared@jpeg'
const ORIGINAL_URL = 'https://bsky.app/profile/sky.example/post/root'

const embed: PostEmbed = {
  $type: 'social.coves.embed.post#view',
  post: {
    uri: 'at://did:plc:alice/app.bsky.feed.post/root' as AtUri,
    cid: 'bafyreiroot' as CID,
  },
  resolved: {
    uri: 'at://did:plc:alice/app.bsky.feed.post/root',
    cid: 'bafyreiroot',
    author: {
      did: 'did:plc:alice',
      handle: 'sky.example',
      displayName: 'Sky Pilot',
    },
    text: 'Duplicate attachment sources remain renderable.',
    createdAt: '2026-09-18T14:30:00Z',
    replyCount: 1,
    repostCount: 2,
    likeCount: 3,
    mediaCount: 2,
    hasMedia: true,
    unavailable: false,
    images: [
      {
        thumb: SHARED_THUMB,
        fullsize:
          'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/first@jpeg',
        alt: 'First duplicate attachment',
      },
      {
        thumb: SHARED_THUMB,
        fullsize:
          'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/second@jpeg',
        alt: 'Second duplicate attachment',
      },
    ],
  },
}

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')
let mediaType: (typeof import('../helpers'))['mediaType']
let PostMedia: (typeof import('./PostMedia.svelte'))['default']

beforeAll(async () => {
  client = await import('svelte')
  mediaType = (await import('../helpers')).mediaType
  PostMedia = (await import('./PostMedia.svelte')).default
}, 60_000)

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target?.remove()
})

it.each([
  { hasMedia: true, mediaCount: 2 },
  { hasMedia: false, mediaCount: 0 },
])(
  'mounts duplicate image sources and falls back on shared failure with metadata $hasMedia/$mediaCount',
  (metadata) => {
    const media: PostEmbed = {
      ...embed,
      resolved: { ...(embed.resolved as Record<string, unknown>), ...metadata },
    }
    expect(() => {
      mounted = client.mount(PostMedia, {
        target,
        props: { embed: media, type: mediaType(media), view: 'cozy' },
        intro: false,
      })
      client.flushSync()
    }).not.toThrow()

    const images = [
      ...target.querySelectorAll<HTMLImageElement>(
        `img[src="${SHARED_THUMB}"]`,
      ),
    ]
    expect(images).toHaveLength(2)
    expect(target.textContent).not.toContain('Media: 2')

    images[0]?.dispatchEvent(new Event('error'))
    client.flushSync()

    expect(target.querySelector(`img[src="${SHARED_THUMB}"]`)).toBeNull()
    expect(target.querySelector(`a[href="${ORIGINAL_URL}"]`)).not.toBeNull()
    expect(target.textContent).toContain('Media: 2')
  },
)
