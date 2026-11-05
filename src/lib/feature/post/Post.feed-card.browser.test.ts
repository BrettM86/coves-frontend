// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { PostView } from '$lib/api/coves/types'
import { IMAGE_FULL, imagePost, linkPost } from './Post.feed-card.fixture'

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

let target: HTMLDivElement | undefined
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')
let Post: (typeof import('./Post.svelte'))['default']

beforeAll(async () => {
  client = await import('svelte')
  Post = (await import('./Post.svelte')).default
}, 60_000)

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target?.remove()
  target = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('never shows the Expand control on a feed card with an overflowing body', () => {
  // jsdom has no layout; model a body far taller than PostBody's limit.
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000)
  const post: PostView = linkPost({
    body: 'Long paragraph. '.repeat(100) + 'END_OF_FULL_BODY',
  })

  target = document.createElement('div')
  document.body.appendChild(target)
  mounted = client.mount(Post, {
    target,
    props: { post, view: 'cozy', actions: false },
    intro: false,
  })
  client.flushSync()

  expect(target.textContent).toContain('Long paragraph.')
  expect(target.querySelector('button[title="Expand"]')).toBeNull()
})

it('removes the thumbnail when it fails to load and keeps the link card', () => {
  target = document.createElement('div')
  document.body.appendChild(target)
  mounted = client.mount(Post, {
    target,
    props: { post: linkPost(), view: 'cozy', actions: false },
    intro: false,
  })
  client.flushSync()

  const card = target.querySelector('[data-testid="link-card"]')
  const thumbnail = target.querySelector(
    'img[src="https://cdn.example.com/thumb.jpg"]',
  )
  expect(card).not.toBeNull()
  expect(thumbnail).not.toBeNull()
  expect(card?.contains(thumbnail)).toBe(true)

  thumbnail?.dispatchEvent(new Event('error'))
  client.flushSync()

  expect(
    target.querySelector('img[src="https://cdn.example.com/thumb.jpg"]'),
  ).toBeNull()
  const kept = target.querySelector('[data-testid="link-card"]')
  expect(kept).not.toBeNull()
  expect(kept?.getAttribute('href')).toBe(
    'https://www.thegamer.com/tim-sweeney/',
  )
  expect(kept?.textContent).toContain('www.thegamer.com')
})

// Once a feed image loads, its reserved width shrinks to the file's width
// when that is smaller, and never grows past the reserved width (no upscale).
// The file is measured through a plain Image: with srcset width descriptors
// the shown image's naturalWidth is scaled and does not give the file's pixels.
it.each([
  {
    ratio: { width: 3, height: 1 },
    natural: { width: 300, height: 100 },
    width: '300px',
  },
  {
    ratio: { width: 1, height: 1 },
    natural: { width: 2000, height: 2000 },
    width: '560px',
  },
])(
  'sets a loaded feed image to width $width',
  async ({ ratio, natural, width }) => {
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        naturalWidth = natural.width
        naturalHeight = natural.height
        decode(): Promise<void> {
          return Promise.resolve()
        }
      },
    )
    target = document.createElement('div')
    document.body.appendChild(target)
    mounted = client.mount(Post, {
      target,
      props: { post: imagePost(ratio), view: 'cozy', actions: false },
      intro: false,
    })
    client.flushSync()

    const image = [...target.querySelectorAll('img')].find((element) =>
      (element.getAttribute('src') ?? '').includes(IMAGE_FULL),
    )
    expect(image).toBeDefined()
    if (!image) return
    image.dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(image.style.width).toBe(width))
  },
)
