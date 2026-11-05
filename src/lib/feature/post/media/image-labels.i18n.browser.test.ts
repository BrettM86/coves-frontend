// @vitest-environment jsdom
/**
 * The gallery tile and the placed body image take their fallback label, ALT
 * badge text and alt modal title from en.json keys. The translator is mocked
 * to echo the key; the English at those keys is pinned by
 * PostGallery.browser.test.ts and RichText.images.browser.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { EmbedImage } from '$lib/api/coves/types'
import { shownModal } from '$lib/ui/kit/modal/modal'

vi.mock('$lib/app/state/i18n', () => {
  const translate = (key: string) => key
  return {
    t: {
      get: translate,
      subscribe: (run: (translator: typeof translate) => void) => {
        run(translate)
        return () => {}
      },
    },
  }
})
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

const WITH_ALT: EmbedImage = {
  thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/lake',
  fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/lake',
  alt: 'A lake',
}
const WITHOUT_ALT: EmbedImage = { ...WITH_ALT, alt: undefined }

let client: typeof import('svelte')
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let target: HTMLDivElement

beforeEach(async () => {
  client = await import('svelte')
  const { settings } = await import('$lib/app/state/settings.svelte')
  settings.expandImages = true
  shownModal.set(undefined)
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

async function mountTile(image: EmbedImage): Promise<void> {
  const PostGalleryTile = (await import('./PostGalleryTile.svelte')).default
  mounted = client.mount(PostGalleryTile, {
    target,
    props: { image, blur: false, priority: false, onopen() {} },
  })
  client.flushSync()
}

/** The tile's expand control: the element with role button holding the image. */
function expandControl(): Element {
  const found = target.querySelector('[role="button"]')
  if (!found) throw new Error('The tile has no expand control')
  return found
}

/** The ALT badge: the tile's one button outside the expand control. */
function altBadge(): HTMLButtonElement {
  const found = [...target.querySelectorAll('button')].find(
    (button) => !expandControl().contains(button),
  )
  if (!found) throw new Error('The tile has no ALT badge')
  return found
}

describe('PostGalleryTile labels', () => {
  it('labels the expand control of an image without alt text post.image.label', async () => {
    await mountTile(WITHOUT_ALT)

    expect(expandControl().getAttribute('aria-label')).toBe('post.image.label')
  })

  it('shows the ALT badge as post.image.altBadge and opens a modal titled post.image.altTitle', async () => {
    await mountTile(WITH_ALT)

    const badge = altBadge()
    expect(badge.textContent?.trim()).toBe('post.image.altBadge')

    badge.click()
    client.flushSync()

    expect(get(shownModal)?.title).toBe('post.image.altTitle')
  })
})

describe('RichTextImage label', () => {
  it('labels a placed image without alt text post.image.label', async () => {
    const RichTextImage = (
      await import('$lib/feature/richtext/RichTextImage.svelte')
    ).default
    mounted = client.mount(RichTextImage, {
      target,
      props: { image: WITHOUT_ALT, onopen() {} },
    })
    client.flushSync()

    const button = target.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('post.image.label')
  })
})
