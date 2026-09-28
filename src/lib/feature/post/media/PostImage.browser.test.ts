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
