// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { PostView } from '$lib/api/coves/types'
import { linkPost } from './Post.feed-card.fixture'

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
