// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))

// Vitest resolves `svelte` with server conditions; the component was compiled
// for the DOM, so point both halves at the client runtime (see
// PostImage.browser.test.ts).
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

/** The button whose accessible name (aria-label, else text) is `name`. */
function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...target.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) =>
      (button.getAttribute('aria-label') ?? button.textContent?.trim()) ===
      name,
  )
}

describe('PostIframe play button', () => {
  it('opens exactly one autoplaying Streamable player', async () => {
    const PostIframe = (await import('./PostIframe.svelte')).default
    mounted = client.mount(PostIframe, {
      target,
      props: {
        url: 'https://streamable.com/abc123',
        type: 'streamable',
        opened: false,
        autoplay: true,
      },
    })
    client.flushSync()

    expect(target.querySelectorAll('iframe')).toHaveLength(0)
    const play = buttonNamed('Play video')
    if (!play) throw new Error('PostIframe rendered no Play video button')

    play.click()
    client.flushSync()

    const frames = target.querySelectorAll('iframe')
    expect(frames).toHaveLength(1)
    expect(frames[0]?.getAttribute('src')).toBe(
      'https://streamable.com/e/abc123?autoplay=1',
    )
    // Only the unopened preview is 2:1; the player goes back to 16:9.
    expect(
      target.querySelector('.iframe-container')?.classList.contains('preview'),
    ).toBe(false)
  })
})
