// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedViewPost } from '$lib/api/coves/types'

// Same environmental shims as VirtualFeed.test.ts: jsdom, the client entries
// of `svelte` and `svelte/reactivity`, and a Post stub that forwards `class`.
vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$app/state', () => ({
  page: {
    url: new URL('https://coves.test/'),
    state: {} satisfies App.PageState,
  },
}))
vi.mock('$app/navigation', () => ({
  goto: vi.fn(async () => {}),
  replaceState: vi.fn(),
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('..', async () => ({
  Post: (await import('./VirtualFeedPost.test.svelte')).default,
}))

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

const feedPost = (uri: string): FeedViewPost =>
  ({ post: { uri } }) as unknown as FeedViewPost

const pinnedPost = (uri: string): FeedViewPost =>
  ({
    post: { uri },
    reason: { $type: 'social.coves.feed.defs#reasonPin' },
  }) as unknown as FeedViewPost

let client: typeof import('svelte')
let settings: typeof import('$lib/app/state/settings.svelte').settings
let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let savedView: typeof settings.view
let savedCompactFeatured: boolean

beforeEach(async () => {
  client = await import('svelte')
  settings = (await import('$lib/app/state/settings.svelte')).settings
  savedView = settings.view
  savedCompactFeatured = settings.posts.compactFeatured
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (mounted) client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  settings.view = savedView
  settings.posts.compactFeatured = savedCompactFeatured
})

const mountFeed = async (posts: FeedViewPost[]): Promise<void> => {
  const PostFeed = (await import('./PostFeed.svelte')).default
  mounted = client.mount(PostFeed, { target, props: { posts }, intro: false })
  client.flushSync()
}

const rowZoomed = (uri: string): boolean => {
  const row = target.querySelector(`span[data-post-uri="${uri}"]`)
  if (!row) throw new Error(`Missing row ${uri}`)
  return row.classList.contains('md:[zoom:0.9]')
}

describe('PostFeed row scale', () => {
  it('scales cozy rows to 90% from md', async () => {
    settings.view = 'cozy'
    await mountFeed([feedPost('at://post/1')])

    expect(rowZoomed('at://post/1')).toBe(true)
  })

  it('keeps compact rows at full size', async () => {
    settings.view = 'compact'
    await mountFeed([feedPost('at://post/1')])

    expect(rowZoomed('at://post/1')).toBe(false)
  })

  it('keeps a compact pinned row in a cozy feed at full size', async () => {
    settings.view = 'cozy'
    settings.posts.compactFeatured = true
    await mountFeed([pinnedPost('at://post/pinned'), feedPost('at://post/1')])

    expect(rowZoomed('at://post/pinned')).toBe(false)
    expect(rowZoomed('at://post/1')).toBe(true)
  })

  it('scales a pinned row that stays cozy', async () => {
    settings.view = 'cozy'
    settings.posts.compactFeatured = false
    await mountFeed([pinnedPost('at://post/pinned')])

    expect(rowZoomed('at://post/pinned')).toBe(true)
  })
})
