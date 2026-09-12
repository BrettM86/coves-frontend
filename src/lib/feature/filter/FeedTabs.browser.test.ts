// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ savedFeed: 'timeline' }))

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/') },
}))
vi.mock('$app/navigation', () => ({ goto: vi.fn() }))
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: { isAuthenticated: false },
}))
vi.mock('$lib/app/state/settings.svelte', () => ({
  settings: {
    defaultSort: {
      get feed() {
        return state.savedFeed
      },
      set feed(value: string) {
        state.savedFeed = value
      },
    },
  },
}))
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

const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */ require_
      .resolve('svelte/package.json')
      .replace('package.json', subpath)
  )
}
vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))
vi.mock('svelte/reactivity', () =>
  svelteClientEntry('src/reactivity/index-client.js'),
)

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')

beforeEach(async () => {
  state.savedFeed = 'timeline'
  client = await import('svelte')
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

describe('signed-out feed tabs', () => {
  it('renders the discover fallback without overwriting a saved timeline default', async () => {
    const FeedTabs = (await import('./FeedTabs.svelte')).default
    mounted = client.mount(FeedTabs, {
      target,
      intro: false,
      props: { selected: 'discover' },
    })
    client.flushSync()

    const selected = target.querySelector('[role="tab"][aria-selected="true"]')
    expect(selected?.textContent?.trim()).toBe('filter.feed.discover')
    expect(target.textContent).not.toContain('filter.feed.forYou')
    expect(state.savedFeed).toBe('timeline')
  })
})
