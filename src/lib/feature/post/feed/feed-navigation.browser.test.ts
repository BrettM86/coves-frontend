// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component, ComponentProps } from 'svelte'
import type {
  FeedPaginationParams,
  FeedViewPost,
  PostView,
} from '$lib/api/coves/types'

interface NavigationOptions {
  state?: App.PageState
}

const navigation = vi.hoisted(() => ({
  goto: vi.fn(
    async (_destination: string | URL, _options?: NavigationOptions) => {},
  ),
}))
const page = vi.hoisted(() => ({
  url: new URL('https://coves.test/?sort=top#focused'),
}))

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({ page }))
vi.mock('$app/navigation', () => ({ goto: navigation.goto }))
vi.mock('..', async () => ({
  Post: (await import('./FeedNavigationPost.test.svelte')).default,
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
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  fly: () => ({ duration: 0 }),
}))

const FEED_URL = '/?sort=top#focused'
const POST_URL = '/c/gardening.test/post/author.test/3lpost'
const SCROLL_Y = 481
const TITLE_TOP = 83
const COMMENTS_TOP = 219
const post = {
  uri: 'at://did:plc:author/social.coves.community.postv2/3lpost',
  cid: 'bafypost',
  rkey: '3lpost',
  author: { did: 'did:plc:author', handle: 'author.test' },
  community: {
    did: 'did:plc:community',
    handle: 'gardening.test',
    name: 'Gardening',
  },
  record: { title: 'Keep rosemary thriving' },
} as unknown as PostView
const posts = [{ post }] as FeedViewPost[]

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds: ReadonlyArray<number> = []
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

class MockResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let client: typeof import('svelte')
let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

beforeEach(async () => {
  client = await import('svelte')
  target = document.createElement('div')
  document.body.appendChild(target)
  navigation.goto.mockClear()
  Object.defineProperty(window, 'scrollY', {
    value: SCROLL_Y,
    configurable: true,
  })
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  vi.unstubAllGlobals()
})

function carriesFeedPosition(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const values = Object.values(value)
  if (values.includes(FEED_URL) && values.includes(SCROLL_Y)) return true
  return values.some(carriesFeedPosition)
}

function carriesReturnAnchor(
  value: unknown,
  href: string,
  viewportTop: number,
): boolean {
  if (!value || typeof value !== 'object') return false
  const values = Object.values(value)
  if (values.includes(href) && values.includes(viewportTop)) return true
  return values.some((item) => carriesReturnAnchor(item, href, viewportTop))
}

function link(kind: string): HTMLAnchorElement {
  const element = target.querySelector<HTMLAnchorElement>(
    `[data-link="${kind}"]`,
  )
  if (!element) throw new Error(`Missing ${kind} link`)
  return element
}

function click(element: HTMLAnchorElement, init: MouseEventInit = {}): boolean {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  })
  let preventedByComponent = false
  window.addEventListener(
    'click',
    (arrivingEvent) => {
      preventedByComponent = arrivingEvent.defaultPrevented
      arrivingEvent.preventDefault()
    },
    { once: true },
  )
  element.dispatchEvent(event)
  return preventedByComponent
}

const renderers = [
  {
    name: 'PostFeed',
    load: async () => (await import('./PostFeed.svelte')).default,
    props: () => ({ posts }),
  },
  {
    name: 'VirtualFeed',
    load: async () => (await import('./VirtualFeed.svelte')).default,
    props: () => ({
      posts,
      params: { sort: 'top' } satisfies FeedPaginationParams,
    }),
  },
]

describe.each(renderers)('$name post-link navigation', ({ load, props }) => {
  it('intercepts only ordinary same-tab post permalink clicks', async () => {
    const Feed = (await load()) as Component
    mounted = client.mount(Feed, {
      target,
      props: props() as ComponentProps<typeof Feed>,
      intro: false,
    })
    client.flushSync()

    const prevented = click(link('post'))
    expect(navigation.goto).toHaveBeenCalledTimes(1)
    expect(prevented).toBe(true)
    const [destination, options] = navigation.goto.mock.calls[0]
    expect(destination).toBe(POST_URL)
    expect(carriesFeedPosition(options?.state)).toBe(true)

    for (const modified of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      navigation.goto.mockClear()
      expect(click(link('post'), modified)).toBe(false)
      expect(navigation.goto).not.toHaveBeenCalled()
    }

    for (const nativeLink of [link('external'), link('non-post')]) {
      navigation.goto.mockClear()
      expect(click(nativeLink)).toBe(false)
      expect(navigation.goto).not.toHaveBeenCalled()
    }
  })

  it('captures the exact clicked title and comments anchors with their viewport positions', async () => {
    const Feed = (await load()) as Component
    mounted = client.mount(Feed, {
      target,
      props: props() as ComponentProps<typeof Feed>,
      intro: false,
    })
    client.flushSync()

    for (const [kind, href, viewportTop] of [
      ['post', POST_URL, TITLE_TOP],
      ['comments', `${POST_URL}#comments`, COMMENTS_TOP],
    ] as const) {
      vi.spyOn(link(kind), 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: viewportTop,
        top: viewportTop,
        right: 300,
        bottom: viewportTop + 24,
        left: 0,
        width: 300,
        height: 24,
        toJSON: () => ({}),
      })

      navigation.goto.mockClear()
      expect.soft(click(link(kind))).toBe(true)
      expect.soft(navigation.goto).toHaveBeenCalledTimes(1)
      const [destination, options] = navigation.goto.mock.calls[0]
      expect.soft(destination).toBe(href)
      expect
        .soft(carriesReturnAnchor(options?.state, href, viewportTop))
        .toBe(true)
    }
  })

  it('leaves native opt-out post permalinks untouched', async () => {
    const Feed = (await load()) as Component
    mounted = client.mount(Feed, {
      target,
      props: props() as ComponentProps<typeof Feed>,
      intro: false,
    })
    client.flushSync()

    for (const kind of ['download', 'rel-external', 'reload']) {
      navigation.goto.mockClear()
      expect.soft(click(link(kind)), kind).toBe(false)
      expect.soft(navigation.goto, kind).not.toHaveBeenCalled()
    }
  })
})
