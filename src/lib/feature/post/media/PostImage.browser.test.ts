// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostEmbed } from '$lib/api/coves/types'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))

// Vitest resolves `svelte` with server conditions; the component was compiled
// for the DOM, so point both halves at the client runtime (see
// VirtualFeed.test.ts).
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

interface SvelteClient {
  mount: (
    component: unknown,
    options: { target: Element; props: unknown },
  ) => unknown
  unmount: (component: unknown) => void
  flushSync: (fn?: () => void) => void
}

const embed = {
  $type: 'social.coves.embed.images#view',
  images: [
    {
      thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/b',
      fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/b',
      alt: 'A lake',
    },
  ],
} as unknown as PostEmbed

let client: SvelteClient
let mounted: unknown
let target: HTMLElement

beforeEach(async () => {
  client = (await import('svelte')) as unknown as SvelteClient
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (mounted) client.unmount(mounted)
  mounted = undefined
  target.remove()
})

/** Mounts with every image's `complete` reporting `complete`. */
async function mountImage(complete: boolean): Promise<HTMLImageElement> {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(
    complete,
  )
  const PostImage = (await import('./PostImage.svelte')).default
  mounted = client.mount(PostImage, { target, props: { embed } })
  client.flushSync()

  const image = target.querySelector<HTMLImageElement>('img[alt="A lake"]')
  if (!image) throw new Error('PostImage rendered no image')
  return image
}

describe('PostImage fade-in', () => {
  it('shows an image that finished loading before hydration', async () => {
    // Its load event has already fired: waiting for one would hide it forever.
    const image = await mountImage(true)

    expect(image.classList).toContain('opacity-100')
  })

  it('hides a still-loading image until it loads', async () => {
    const image = await mountImage(false)

    expect(image.classList).toContain('opacity-0')

    image.dispatchEvent(new Event('load'))
    client.flushSync()

    expect(image.classList).toContain('opacity-100')
    expect(image.classList).not.toContain('opacity-0')
  })
})

/** Mounts a feed image whose first image carries `images`. */
async function mountFeedImage(
  images: readonly unknown[],
): Promise<HTMLImageElement> {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false)
  const PostImage = (await import('./PostImage.svelte')).default
  const feedEmbed = {
    $type: 'social.coves.embed.images#view',
    images,
  } as unknown as PostEmbed
  mounted = client.mount(PostImage, {
    target,
    props: { embed: feedEmbed, feed: true },
  })
  client.flushSync()

  const image = target.querySelector<HTMLImageElement>('picture img')
  if (!image) throw new Error('PostImage rendered no image')
  return image
}

function feedImage(
  aspectRatio: unknown,
  url = 'https://img.coves.test/img/content_full/plain/did:plc:a/b',
): Record<string, unknown> {
  return { thumb: url, fullsize: url, alt: 'A lake', aspectRatio }
}

describe('PostImage feed aspect ratio', () => {
  it('reserves a valid ratio', async () => {
    const image = await mountFeedImage([feedImage({ width: 4, height: 3 })])

    expect(image.getAttribute('style')).toBe(
      'aspect-ratio: 4 / 3; width: 746.67px;',
    )
    expect(image.getAttribute('width')).toBe('4')
    expect(image.getAttribute('height')).toBe('3')
  })

  it.each([
    ['zero width', { width: 0, height: 1 }],
    ['zero height', { width: 1, height: 0 }],
    ['negative width', { width: -4, height: 3 }],
    ['NaN height', { width: 4, height: Number.NaN }],
    ['infinite width', { width: Number.POSITIVE_INFINITY, height: 3 }],
    ['string width', { width: '1; position:fixed; inset:0', height: 1 }],
    ['string height', { width: 1, height: '1; position:fixed; inset:0' }],
    ['non-object ratio', '16 / 9'],
  ])('falls back to the natural size for a %s', async (_name, ratio) => {
    const image = await mountFeedImage([feedImage(ratio)])

    expect(image.getAttribute('style')).toBeNull()
    expect(image.getAttribute('width')).toBe('512')
    expect(image.getAttribute('height')).toBe('300')
    expect(image.classList).toContain('w-auto')
  })

  it('renders an embed with no images without a reserved size', async () => {
    const image = await mountFeedImage([])

    expect(image.getAttribute('style')).toBeNull()
    expect(image.getAttribute('width')).toBe('512')
    expect(image.getAttribute('height')).toBe('300')
  })
})

describe('PostImage feed load failure', () => {
  it('collapses the reserved box when the image fails to load', async () => {
    const image = await mountFeedImage([feedImage({ width: 4, height: 3 })])

    image.dispatchEvent(new Event('error'))
    client.flushSync()

    expect(image.getAttribute('style')).toBeNull()
    expect(image.getAttribute('width')).toBe('512')
    expect(image.getAttribute('height')).toBe('300')
    expect(image.classList).toContain('w-auto')
  })

  it('reserves again when the component moves to a new URL', async () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(
      false,
    )
    const { SvelteMap } = await import('svelte/reactivity')
    const PostImage = (await import('./PostImage.svelte')).default
    const embedFor = (url: string): PostEmbed =>
      ({
        $type: 'social.coves.embed.images#view',
        images: [feedImage({ width: 4, height: 3 }, url)],
      }) as unknown as PostEmbed
    // A reactive prop source, so the mounted component sees the new embed.
    const state = new SvelteMap<'embed', PostEmbed>([
      ['embed', embedFor('https://img.coves.test/a')],
    ])
    const props = {
      get embed(): PostEmbed {
        const current = state.get('embed')
        if (!current) throw new Error('no embed')
        return current
      },
      feed: true,
    }
    mounted = client.mount(PostImage, { target, props })
    client.flushSync()
    const image = target.querySelector<HTMLImageElement>('picture img')
    if (!image) throw new Error('PostImage rendered no image')

    image.dispatchEvent(new Event('error'))
    client.flushSync()
    expect(image.getAttribute('style')).toBeNull()

    state.set('embed', embedFor('https://img.coves.test/b'))
    client.flushSync()

    const next = target.querySelector<HTMLImageElement>('picture img')
    expect(next?.getAttribute('style')).toBe(
      'aspect-ratio: 4 / 3; width: 746.67px;',
    )
  })
})
