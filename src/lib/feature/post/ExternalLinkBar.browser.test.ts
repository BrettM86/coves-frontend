// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

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
let ExternalLinkBar: (typeof import('./ExternalLinkBar.svelte'))['default']

beforeAll(async () => {
  client = await import('svelte')
  ExternalLinkBar = (await import('./ExternalLinkBar.svelte')).default
}, 60_000)

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

it('swaps a favicon that fails to load for the globe icon and stays a link', () => {
  mounted = client.mount(ExternalLinkBar, {
    target,
    props: { uri: 'https://www.thegamer.com/tim-sweeney/' },
  })
  client.flushSync()

  const favicon = target.querySelector('img')
  expect(favicon).not.toBeNull()
  expect(target.querySelector('svg.lucide-globe')).toBeNull()

  favicon?.dispatchEvent(new Event('error'))
  client.flushSync()

  expect(target.querySelector('img')).toBeNull()
  expect(target.querySelector('svg.lucide-globe')).not.toBeNull()
  const link = target.querySelector('a')
  expect(link?.getAttribute('href')).toBe(
    'https://www.thegamer.com/tim-sweeney/',
  )
})
