// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'svelte'
import type {
  FeedPaginationParams,
  FeedViewPost,
  PostView,
} from '$lib/api/coves/types'

interface NavigationOptions {
  state?: Record<string, unknown>
}

const router = vi.hoisted(() => ({
  page: {
    url: new URL('https://coves.test/'),
    state: {} as Record<string, unknown>,
  },
  goto: vi.fn(
    async (_destination: string | URL, _options?: NavigationOptions) => {},
  ),
  replaceState: vi.fn(),
}))

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({ page: router.page }))
vi.mock('$app/navigation', () => ({
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
  goto: router.goto,
  invalidate: vi.fn(),
  replaceState: (url: string | URL, state: Record<string, unknown>) => {
    router.replaceState(url, state)
    router.page.state = state
  },
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

const FEED_URL = '/?sort=top&time=week'
const POST_URL = '/c/gardening.test/post/author.test/3lpost'
const SAVED_SCROLL_Y = 731
const POST_URI = 'at://did:plc:author/social.coves.community.postv2/3lpost'
const VIRTUAL_LIST_RESIZE_DEBOUNCE_MS = 100
const STABLE_INTERVAL_OVER_DEBOUNCE_MS = 1

const post = {
  uri: POST_URI,
  cid: 'bafypost',
  rkey: '3lpost',
  indexedAt: '2026-09-13T10:00:00.000Z',
  createdAt: '2026-09-13T10:00:00.000Z',
  author: { did: 'did:plc:author', handle: 'author.test' },
  community: {
    did: 'did:plc:community',
    handle: 'gardening.test',
    name: 'Gardening',
  },
  record: { title: 'Keep rosemary thriving', content: 'Use sharp drainage.' },
  stats: { commentCount: 0, likeCount: 0, dislikeCount: 0 },
} as unknown as PostView

const feedPost = { post } as FeedViewPost

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

class FakeAnimation {
  currentTime = 0
  startTime = 0
  playbackRate = 1
  playState = 'running'
  effect = {
    setKeyframes: () => {},
    getComputedTiming: () => ({ duration: 0 }),
  }
  onfinish: (() => void) | null = null
  play(): void {}
  pause(): void {}
  finish(): void {}
  cancel(): void {}
  commitStyles(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

let target: HTMLDivElement
let client: typeof import('svelte')
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let scrollTo: ReturnType<typeof vi.fn>
let animationFrames: Map<number, FrameRequestCallback>
let nextAnimationFrameId: number
let animationFrameTime: DOMHighResTimeStamp

beforeEach(async () => {
  client = await import('svelte')
  target = document.createElement('div')
  document.body.appendChild(target)

  router.page.url = new URL(FEED_URL, 'https://coves.test')
  router.page.state = {}
  router.goto.mockClear()
  router.replaceState.mockClear()

  Object.defineProperty(window, 'scrollY', {
    value: SAVED_SCROLL_Y,
    configurable: true,
  })
  scrollTo = vi.fn()
  animationFrames = new Map()
  nextAnimationFrameId = 1
  animationFrameTime = 0
  vi.stubGlobal('scrollTo', scrollTo)
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextAnimationFrameId++
    animationFrames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    animationFrames.delete(id)
  })
  Object.assign(Element.prototype, {
    animate: () => new FakeAnimation(),
    getAnimations: () => [],
  })
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  vi.unstubAllGlobals()
})

async function unmount(): Promise<void> {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.replaceChildren()
}

function flushAnimationFrames(advanceMs = 16): void {
  animationFrameTime += advanceMs
  const callbacks = [...animationFrames.values()]
  animationFrames.clear()
  callbacks.forEach((callback) => callback(animationFrameTime))
  client.flushSync()
}

function pathOf(destination: unknown): string {
  const url =
    destination instanceof URL
      ? destination
      : new URL(String(destination), 'https://coves.test')
  return `${url.pathname}${url.search}${url.hash}`
}

function carriesExactPosition(
  value: unknown,
  expectedUrl = FEED_URL,
  expectedScrollY = SAVED_SCROLL_Y,
): boolean {
  if (!value || typeof value !== 'object') return false
  const values = Object.values(value)
  if (
    values.some((item) => item === expectedUrl) &&
    values.some((item) => item === expectedScrollY)
  ) {
    return true
  }
  return values.some((item) =>
    carriesExactPosition(item, expectedUrl, expectedScrollY),
  )
}

function accessibleBackLink(): HTMLAnchorElement | undefined {
  return [...target.querySelectorAll<HTMLAnchorElement>('a')].find((link) => {
    const name =
      link.getAttribute('aria-label') ??
      link.textContent?.trim() ??
      link.getAttribute('title') ??
      ''
    return /^back$/i.test(name)
  })
}

async function mountFeed(posts: FeedViewPost[]) {
  const { SvelteMap } = await import('svelte/reactivity')
  const VirtualFeed = (
    await import('$lib/feature/post/feed/VirtualFeed.svelte')
  ).default
  const values = new SvelteMap<string, unknown>([
    ['posts', posts],
    ['params', { sort: 'top' } satisfies FeedPaginationParams],
  ])
  const props = {
    get posts(): FeedViewPost[] {
      return values.get('posts') as FeedViewPost[]
    },
    set posts(next: FeedViewPost[]) {
      values.set('posts', next)
    },
    get params(): FeedPaginationParams {
      return values.get('params') as FeedPaginationParams
    },
    set params(next: FeedPaginationParams) {
      values.set('params', next)
    },
  }
  mounted = client.mount(VirtualFeed, { target, props, intro: false })
  client.flushSync()
  return props
}

async function mountPostPage(): Promise<void> {
  const { ReactiveState } = await import('$lib/app/util/reactive.svelte')
  const PostPage = (await import('./+page.svelte')).default
  const data = {
    data: new ReactiveState({
      post,
      comments: Promise.resolve({ comments: [] }),
      params: {
        postUri: POST_URI,
        comments: { post: POST_URI, sort: 'hot', depth: 3, limit: 50 },
        thread: {},
      },
    }),
  } as unknown as ComponentProps<typeof PostPage>['data']
  mounted = client.mount(PostPage, {
    target,
    props: { data },
    intro: false,
  })
  client.flushSync()
  await vi.waitFor(() =>
    expect(target.querySelector('section#comments')).not.toBeNull(),
  )
}

function requestedSavedPixel(): boolean {
  return scrollTo.mock.calls.some(([first, second]) => {
    if (typeof first === 'object' && first !== null) {
      return (first as ScrollToOptions).top === SAVED_SCROLL_Y
    }
    return first === 0 && second === SAVED_SCROLL_Y
  })
}

describe('post Back navigation from a feed', () => {
  it('returns directly to the exact feed position once and keeps / as the native fallback', async () => {
    await mountFeed([feedPost])
    const permalink = target.querySelector<HTMLAnchorElement>(
      `a[href="${POST_URL}"]`,
    )
    expect(permalink, 'feed post permalink').not.toBeNull()
    expect(permalink?.target).toBe('')

    // The mocked app router observes the component's click handling; suppress
    // jsdom's unrelated attempt to perform a real document navigation.
    window.addEventListener('click', (event) => event.preventDefault(), {
      once: true,
    })
    permalink?.click()
    await vi.waitFor(() => expect(router.goto).toHaveBeenCalledTimes(1))
    const [postDestination, postOptions] = router.goto.mock.calls[0]
    expect(pathOf(postDestination)).toBe(POST_URL)
    const postState = postOptions?.state
    expect(
      carriesExactPosition(postState),
      'post navigation state to carry the exact feed URL and scroll offset',
    ).toBe(true)

    await unmount()
    router.page.url = new URL(POST_URL, 'https://coves.test')
    router.page.state = postState ?? {}
    router.goto.mockClear()
    const historyBack = vi.spyOn(window.history, 'back')
    await mountPostPage()

    const back = accessibleBackLink()
    expect(back, 'accessible Back link on post page').toBeDefined()
    back?.click()
    await vi.waitFor(() => expect(router.goto).toHaveBeenCalledTimes(1))
    expect(historyBack).not.toHaveBeenCalled()
    const [feedDestination, feedOptions] = router.goto.mock.calls[0]
    expect(pathOf(feedDestination)).toBe(FEED_URL)
    const restorationState = feedOptions?.state
    expect(
      carriesExactPosition(restorationState),
      'feed navigation state to request one exact-scroll restoration',
    ).toBe(true)

    await unmount()
    router.page.url = new URL(POST_URL, 'https://coves.test')
    router.page.state = {}
    await mountPostPage()
    const fallback = accessibleBackLink()
    expect(fallback, 'accessible Back link without origin state').toBeDefined()
    expect(fallback?.getAttribute('href')).toBe('/')

    await unmount()
    router.page.url = new URL(FEED_URL, 'https://coves.test')
    router.page.state = restorationState ?? {}
    scrollTo.mockClear()
    const restoredFeed = await mountFeed([])
    expect(
      scrollTo,
      'restoration before the feed list exists',
    ).not.toHaveBeenCalled()

    restoredFeed.posts = [feedPost]
    client.flushSync()
    expect(
      animationFrames.size,
      'restoration to be scheduled for the next animation frame',
    ).toBeGreaterThan(0)
    flushAnimationFrames()
    expect(
      requestedSavedPixel(),
      `window.scrollTo to request pixel ${SAVED_SCROLL_Y}`,
    ).toBe(true)
    expect(router.page.state.postFeedOrigin).toEqual(
      restorationState?.postFeedOrigin,
    )
    expect(
      animationFrames.size,
      'aligned restoration to await a stable interval beyond list measurement',
    ).toBeGreaterThan(0)

    flushAnimationFrames(VIRTUAL_LIST_RESIZE_DEBOUNCE_MS)
    expect(router.page.state.postFeedOrigin).toEqual(
      restorationState?.postFeedOrigin,
    )
    expect(animationFrames.size).toBeGreaterThan(0)

    flushAnimationFrames(STABLE_INTERVAL_OVER_DEBOUNCE_MS)
    expect(router.page.state.postFeedOrigin).toBeUndefined()
    expect(router.replaceState).toHaveBeenCalledTimes(1)

    await unmount()
    scrollTo.mockClear()
    await mountFeed([feedPost])
    expect(
      animationFrames.size,
      'consumed restoration not to schedule another animation frame',
    ).toBe(0)
    flushAnimationFrames()
    expect(
      scrollTo,
      'consumed restoration on a second feed mount',
    ).not.toHaveBeenCalled()
  })
})
