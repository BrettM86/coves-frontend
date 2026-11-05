// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { AtUri, CID, PostView } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'

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

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')
let settings: (typeof import('$lib/app/state/settings.svelte'))['settings']
let SvelteMap: (typeof import('svelte/reactivity'))['SvelteMap']
let Post: (typeof import('./Post.svelte'))['default']

// Cold-loading Post.svelte and its tree takes seconds under full-suite load.
// Paying it inside the first test's 5 s budget made that test time out, and
// its still-running body then mounted into the next test's target and
// revealed media there. Load everything once, outside any per-test timeout.
beforeAll(async () => {
  client = await import('svelte')
  settings = (await import('$lib/app/state/settings.svelte')).settings
  SvelteMap = (await import('svelte/reactivity')).SvelteMap
  Post = (await import('./Post.svelte')).default
}, 60_000)

beforeEach(() => {
  settings.nsfwBlur = false
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target?.remove()
})

const image = (index: number) => ({
  thumb: `https://media.example/gallery-${index}-thumb.jpg`,
  fullsize: `https://media.example/gallery-${index}.jpg`,
  alt: `Gallery image ${index}`,
})

const multiImagePost = (count: number): PostView =>
  ({
    uri: 'at://did:plc:author/social.coves.community.post/gallery' as AtUri,
    rkey: 'gallery',
    cid: 'bafyreiexample' as CID,
    indexedAt: '2026-09-01T00:00:00Z',
    author: {
      did: 'did:plc:author' as DID,
      handle: 'author.example' as Handle,
    },
    community: { did: 'did:plc:community' as DID, name: 'Community' },
    createdAt: '2026-09-01T00:00:00Z',
    record: {
      $type: 'social.coves.community.post',
      title: 'Gallery post',
      author: 'did:plc:author',
      community: 'did:plc:community',
      createdAt: '2026-09-01T00:00:00Z',
    },
    embed: {
      $type: 'social.coves.embed.images#view',
      images: Array.from({ length: count }, (_, index) => image(index + 1)),
    },
  }) as PostView

/**
 * A Tailwind arbitrary variant that sets `display` on every direct child,
 * such as `[&>*]:block`. It is emitted after `.grid` with the same
 * specificity, so it silently turns the gallery's grid into a block.
 */
const childDisplayOverride =
  /^\[&>\*\]:(block|flex|inline|inline-block|inline-flex|hidden|contents|table)$/

it.each([2, 4, 8])(
  'keeps the gallery a two-column grid inside a cozy post with %i images',
  (count) => {
    const values = new SvelteMap([['post', multiImagePost(count)]])
    mounted = client.mount(Post, {
      target,
      props: {
        get post(): PostView {
          const post = values.get('post')
          if (!post) throw new Error('Missing post fixture')
          return post
        },
        actions: false,
        view: 'cozy',
      },
      intro: false,
    })
    client.flushSync()

    const grid = target.querySelector<HTMLElement>('.grid-cols-2')
    expect(grid, 'gallery grid root').not.toBeNull()
    if (!grid) return
    expect(grid.classList.contains('grid')).toBe(true)

    const parent = grid.parentElement
    expect(parent, 'gallery wrapper').not.toBeNull()
    if (!parent) return
    const overrides = [...parent.classList].filter((name) =>
      childDisplayOverride.test(name),
    )
    expect(overrides, 'direct-child display overrides on the wrapper').toEqual(
      [],
    )
  },
)
