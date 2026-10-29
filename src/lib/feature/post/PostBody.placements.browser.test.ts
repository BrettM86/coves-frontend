// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { PostEmbed } from '$lib/api/coves/types'
import { facetOver } from '$lib/feature/richtext/test-helpers'

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
let PostBody: (typeof import('./PostBody.svelte'))['default']

beforeAll(async () => {
  client = await import('svelte')
  PostBody = (await import('./PostBody.svelte')).default
}, 60_000)

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target?.remove()
  vi.restoreAllMocks()
})

const embed: PostEmbed = {
  $type: 'social.coves.embed.images#view',
  images: [
    {
      thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/tall',
      fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/tall',
      alt: 'Tall cliff face',
    },
  ],
}

it('shows the expand control once an inline image loads and pushes the body past the collapse height', async () => {
  // jsdom has no layout: the body measures short until the image loads.
  const scrollHeight = vi
    .spyOn(Element.prototype, 'scrollHeight', 'get')
    .mockReturnValue(100)
  const content = 'Short intro\n\n[image]'
  mounted = client.mount(PostBody, {
    target,
    props: {
      body: content,
      facets: [
        facetOver(content, '[image]', {
          $type: 'social.coves.richtext.facet#image',
          index: 0,
        }),
      ],
      embed,
    },
    intro: false,
  })
  client.flushSync()

  expect(target.querySelector('button[title="Expand"]')).toBeNull()
  const inline = target.querySelector('img[alt="Tall cliff face"]')
  expect(inline, 'inline placed image').not.toBeNull()
  if (!inline) return

  scrollHeight.mockReturnValue(600)
  inline.dispatchEvent(new Event('load'))
  await client.tick()
  client.flushSync()

  expect(target.querySelector('button[title="Expand"]')).not.toBeNull()
})
