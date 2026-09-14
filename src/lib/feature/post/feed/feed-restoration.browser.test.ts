// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component } from 'svelte'
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
  replaceState: vi.fn(),
}))
const transitions = vi.hoisted(() => ({
  fly: vi.fn((_node: Element, _params?: { y?: number }) => ({ duration: 0 })),
}))
const page = vi.hoisted(() => ({
  get url(): URL {
    return this.readUrl()
  },
  set url(value: URL) {
    this.writeUrl(value)
  },
  get state(): App.PageState {
    return this.readState()
  },
  set state(value: App.PageState) {
    this.writeState(value)
  },
  readState: () => ({}) as App.PageState,
  writeState: (_value: App.PageState) => {},
  readUrl: () => new URL('https://coves.test/?sort=top#focused'),
  writeUrl: (_value: URL) => {},
}))

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({ page }))
vi.mock('$app/navigation', () => ({
  goto: navigation.goto,
  replaceState: (url: string | URL, state: App.PageState) => {
    navigation.replaceState(url, state)
    page.state = state
  },
}))
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
vi.mock('svelte/reactivity/window', () => ({
  innerHeight: { current: 768 },
}))
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  fly: transitions.fly,
}))

const FEED_URL = '/?sort=top#focused'
const SAVED_SCROLL_Y = 4_281
const POST_URL = '/c/gardening.test/post/author.test/3lpost'
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

interface CachedFeedResponse {
  feed: FeedViewPost[]
  params: FeedPaginationParams
  virtualList: { itemHeights: (number | null)[] }
}

function feedPosts(count: number): FeedViewPost[] {
  return Array.from({ length: count }, (_, index) => ({
    post: {
      ...post,
      uri: `${post.uri}-${index}`,
      rkey: `${post.rkey}-${index}`,
    },
  })) as FeedViewPost[]
}

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

let client: typeof import('svelte')
let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let scrollTo: ReturnType<typeof vi.fn>
let actualScrollY: number
let maximumScrollY: number
let dispatchScrollEvents: boolean
let animationFrames: Map<number, FrameRequestCallback>
let nextAnimationFrameId: number
let animationFrameTime: DOMHighResTimeStamp
let anchorDocumentTops: Map<string, number>
let measuredHeights: number[]

beforeEach(async () => {
  client = await import('svelte')
  const { SvelteMap } = await import('svelte/reactivity')
  const state = new SvelteMap<string, App.PageState | URL>([
    ['page', {}],
    ['url', new URL('https://coves.test/?sort=top#focused')],
  ])
  page.readState = () => (state.get('page') as App.PageState | undefined) ?? {}
  page.writeState = (value) => state.set('page', value)
  page.readUrl = () => state.get('url') as URL
  page.writeUrl = (value) => state.set('url', value)
  page.url = new URL('https://coves.test/?sort=top#focused')
  page.state = {}

  target = document.createElement('div')
  document.body.appendChild(target)
  navigation.goto.mockClear()
  navigation.replaceState.mockClear()
  transitions.fly.mockClear()
  actualScrollY = 0
  maximumScrollY = Number.POSITIVE_INFINITY
  dispatchScrollEvents = false
  animationFrames = new Map()
  nextAnimationFrameId = 1
  animationFrameTime = 0
  anchorDocumentTops = new Map()
  measuredHeights = []
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    get: () => actualScrollY,
  })
  scrollTo = vi.fn((first: number | ScrollToOptions, second?: number) => {
    const requested =
      typeof first === 'object' && first !== null ? first.top : second
    if (typeof requested !== 'number') return
    actualScrollY = Math.min(Math.max(0, requested), maximumScrollY)
    if (dispatchScrollEvents) window.dispatchEvent(new Event('scroll'))
  })
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
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      const href = this.getAttribute('href')
      const anchorDocumentTop = href ? anchorDocumentTops.get(href) : undefined
      if (anchorDocumentTop !== undefined) {
        const top = anchorDocumentTop - actualScrollY
        return {
          x: 0,
          y: top,
          top,
          right: 300,
          bottom: top + 24,
          left: 0,
          width: 300,
          height: 24,
          toJSON: () => ({}),
        }
      }
      const index = Number(this.getAttribute('data-index'))
      const height = measuredHeights[index] ?? 100
      return {
        x: 0,
        y: 0,
        top: 0,
        right: 0,
        bottom: height,
        left: 0,
        width: 0,
        height,
        toJSON: () => ({}),
      }
    },
  )
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

function runAnimationFrameAt(timestamp: DOMHighResTimeStamp): void {
  animationFrameTime = timestamp
  const callbacks = [...animationFrames.values()]
  animationFrames.clear()
  callbacks.forEach((callback) => callback(animationFrameTime))
  client.flushSync()
}

function runAnimationFrame(advanceMs = 16): void {
  runAnimationFrameAt(animationFrameTime + advanceMs)
}

function requestedSavedPixel(expected = SAVED_SCROLL_Y): boolean {
  return scrollTo.mock.calls.some(([first, second]) => {
    if (typeof first === 'object' && first !== null) {
      return (first as ScrollToOptions).top === expected
    }
    return first === 0 && second === expected
  })
}

const renderers = [
  {
    name: 'PostFeed',
    load: async () => (await import('./PostFeed.svelte')).default,
    props: () => ({}),
  },
  {
    name: 'VirtualFeed',
    load: async () => (await import('./VirtualFeed.svelte')).default,
    props: () => ({
      params: { sort: 'top' } satisfies FeedPaginationParams,
    }),
  },
]

async function mountFeed(
  load: () => Promise<unknown>,
  extraProps: Record<string, unknown>,
  initialPosts: FeedViewPost[],
  intro = false,
) {
  const { SvelteMap } = await import('svelte/reactivity')
  const values = new SvelteMap<string, unknown>([['posts', initialPosts]])
  const props = {
    get posts(): FeedViewPost[] {
      return values.get('posts') as FeedViewPost[]
    },
    set posts(value: FeedViewPost[]) {
      values.set('posts', value)
    },
    ...extraProps,
  }
  const Feed = (await load()) as Component<Record<string, unknown>>
  mounted = client.mount(Feed, {
    target,
    intro,
    props,
  })
  client.flushSync()
  return props
}

async function mountResponse(response: CachedFeedResponse) {
  const { SvelteMap } = await import('svelte/reactivity')
  const values = new SvelteMap<string, CachedFeedResponse>([
    ['response', response],
  ])
  const props = {
    get response(): CachedFeedResponse {
      return values.get('response') as CachedFeedResponse
    },
    set response(value: CachedFeedResponse) {
      values.set('response', value)
    },
  }
  const Harness = (await import('./VirtualFeedResponse.test.svelte')).default
  mounted = client.mount(Harness, { target, props, intro: false })
  client.flushSync()
  return props
}

function link(kind: string): HTMLAnchorElement {
  const element = target.querySelector<HTMLAnchorElement>(
    `[data-link="${kind}"]`,
  )
  if (!element) throw new Error(`Missing ${kind} link`)
  return element
}

function renderedPostLink(
  postUri: string,
  kind: string,
): HTMLAnchorElement | undefined {
  const postElement = [
    ...target.querySelectorAll<HTMLElement>('[data-post-uri]'),
  ].find((element) => element.dataset.postUri === postUri)
  return (
    postElement?.querySelector<HTMLAnchorElement>(`[data-link="${kind}"]`) ??
    undefined
  )
}

function click(element: HTMLAnchorElement): void {
  window.addEventListener('click', (event) => event.preventDefault(), {
    once: true,
  })
  element.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    }),
  )
}

async function captureOrigin(
  kind: 'post' | 'comments',
  viewportTop: number,
): Promise<NonNullable<App.PageState['postFeedOrigin']>> {
  const href = kind === 'comments' ? `${POST_URL}#comments` : POST_URL
  actualScrollY = SAVED_SCROLL_Y
  anchorDocumentTops.set(href, SAVED_SCROLL_Y + viewportTop)
  page.state = {}

  await mountFeed(
    async () => (await import('./PostFeed.svelte')).default,
    {},
    posts,
  )
  click(link(kind))
  const origin = navigation.goto.mock.calls[0]?.[1]?.state?.postFeedOrigin
  if (!origin)
    throw new Error('Post navigation did not capture its feed origin')

  await unmount()
  navigation.goto.mockClear()
  scrollTo.mockClear()
  return origin
}

describe.each(renderers)(
  '$name exact-scroll restoration',
  ({ load, props }) => {
    it('waits for list DOM, restores on the next frame, and consumes once', async () => {
      page.state = {
        postFeedOrigin: { url: FEED_URL, scrollY: SAVED_SCROLL_Y },
      }
      const mountedProps = await mountFeed(load, props(), [])
      expect(scrollTo).not.toHaveBeenCalled()
      expect(navigation.replaceState).not.toHaveBeenCalled()

      mountedProps.posts = posts
      client.flushSync()
      expect(scrollTo).not.toHaveBeenCalled()

      runAnimationFrame()
      expect(requestedSavedPixel()).toBe(true)
      expect(navigation.replaceState).toHaveBeenCalledTimes(1)
      const consumedState = navigation.replaceState.mock.calls[0]?.[1]
      expect((consumedState as App.PageState).postFeedOrigin).toBeUndefined()

      await unmount()
      scrollTo.mockClear()
      navigation.replaceState.mockClear()
      await mountFeed(load, props(), posts)
      runAnimationFrame()
      expect(scrollTo).not.toHaveBeenCalled()
      expect(navigation.replaceState).not.toHaveBeenCalled()
    })

    it('does not restore or consume state for another feed URL', async () => {
      const origin = { url: '/?sort=new#focused', scrollY: SAVED_SCROLL_Y }
      page.state = { postFeedOrigin: origin }
      await mountFeed(load, props(), posts)
      runAnimationFrame()

      expect(scrollTo).not.toHaveBeenCalled()
      expect(navigation.replaceState).not.toHaveBeenCalled()
      expect(page.state.postFeedOrigin).toEqual(origin)
    })
  },
)

describe('stable-anchor restoration', () => {
  const SAVED_ANCHOR_TOP = 72
  const SHIFTED_ANCHOR_DOCUMENT_TOP = 1_240
  const VIRTUAL_LIST_RESIZE_DEBOUNCE_MS = 100
  const STABLE_INTERVAL_OVER_DEBOUNCE_MS = 1
  const HIGH_REFRESH_FRAME_MS = 1_000 / 240

  it('suppresses entrance movement while an anchored restoration is active', async () => {
    page.state = {
      postFeedOrigin: {
        url: FEED_URL,
        scrollY: SAVED_SCROLL_Y,
        anchor: {
          postUri: post.uri as string,
          href: POST_URL,
          viewportTop: SAVED_ANCHOR_TOP,
        },
      },
    }
    await mountFeed(
      async () => (await import('./VirtualFeed.svelte')).default,
      { params: { sort: 'top' } satisfies FeedPaginationParams },
      posts,
      true,
    )

    const targetTransition = transitions.fly.mock.calls.find(([node]) => {
      return (
        node instanceof HTMLElement &&
        node.dataset.postUri === (post.uri as string)
      )
    }) as unknown[] | undefined
    expect(targetTransition).toBeDefined()
    expect((targetTransition?.[1] as { y?: number } | undefined)?.y ?? 0).toBe(
      0,
    )
  })

  it('waits beyond the resize debounce before consuming after a delayed layout shift', async () => {
    const origin = await captureOrigin('post', SAVED_ANCHOR_TOP)
    const initialDocumentTop = SAVED_SCROLL_Y + SAVED_ANCHOR_TOP
    actualScrollY = 0
    anchorDocumentTops.set(POST_URL, initialDocumentTop)
    page.state = { postFeedOrigin: origin }
    await mountFeed(
      async () => (await import('./PostFeed.svelte')).default,
      {},
      posts,
    )

    runAnimationFrame()
    expect(link('post').getBoundingClientRect().top).toBe(SAVED_ANCHOR_TOP)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()

    runAnimationFrame(50)
    expect(link('post').getBoundingClientRect().top).toBe(SAVED_ANCHOR_TOP)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()

    runAnimationFrame(50)
    expect(link('post').getBoundingClientRect().top).toBe(SAVED_ANCHOR_TOP)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()

    anchorDocumentTops.set(POST_URL, initialDocumentTop + 240)
    runAnimationFrame(STABLE_INTERVAL_OVER_DEBOUNCE_MS)
    expect(link('post').getBoundingClientRect().top).toBe(SAVED_ANCHOR_TOP)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()

    runAnimationFrame(VIRTUAL_LIST_RESIZE_DEBOUNCE_MS)
    expect(link('post').getBoundingClientRect().top).toBe(SAVED_ANCHOR_TOP)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()

    runAnimationFrame(STABLE_INTERVAL_OVER_DEBOUNCE_MS)
    expect(link('post').getBoundingClientRect().top).toBe(SAVED_ANCHOR_TOP)
    expect(page.state.postFeedOrigin).toBeUndefined()
    expect(navigation.replaceState).toHaveBeenCalledTimes(1)
  })

  it('keeps retrying at 240 Hz through a second stability window after a late layout shift', async () => {
    const origin = await captureOrigin('post', SAVED_ANCHOR_TOP)
    const initialDocumentTop = SAVED_SCROLL_Y + SAVED_ANCHOR_TOP
    actualScrollY = 0
    anchorDocumentTops.set(POST_URL, initialDocumentTop)
    page.state = { postFeedOrigin: origin }
    await mountFeed(
      async () => (await import('./PostFeed.svelte')).default,
      {},
      posts,
    )

    let frameNumber = 1
    runAnimationFrameAt(frameNumber * HIGH_REFRESH_FRAME_MS)
    const initialAlignmentTimestamp = animationFrameTime
    expect(link('post').getBoundingClientRect().top).toBe(SAVED_ANCHOR_TOP)
    expect(page.state.postFeedOrigin).toBe(origin)

    while (frameNumber < 25) {
      frameNumber += 1
      runAnimationFrameAt(frameNumber * HIGH_REFRESH_FRAME_MS)
    }
    expect(animationFrameTime - initialAlignmentTimestamp).toBe(100)
    expect(page.state.postFeedOrigin).toBe(origin)

    anchorDocumentTops.set(POST_URL, initialDocumentTop + 240)
    frameNumber += 1
    runAnimationFrameAt(frameNumber * HIGH_REFRESH_FRAME_MS)
    const shiftedAlignmentTimestamp = animationFrameTime
    expect(link('post').getBoundingClientRect().top).toBe(SAVED_ANCHOR_TOP)
    expect(page.state.postFeedOrigin).toBe(origin)

    while (frameNumber < 51) {
      frameNumber += 1
      runAnimationFrameAt(frameNumber * HIGH_REFRESH_FRAME_MS)
    }
    expect(animationFrameTime - shiftedAlignmentTimestamp).toBeGreaterThan(100)
    expect(link('post').getBoundingClientRect().top).toBe(SAVED_ANCHOR_TOP)
    expect(page.state.postFeedOrigin).toBeUndefined()
    expect(navigation.replaceState).toHaveBeenCalledTimes(1)
  })

  it('retries a clamped scroll, then consumes once after aligning the clicked anchor', async () => {
    const origin = await captureOrigin('comments', SAVED_ANCHOR_TOP)
    actualScrollY = 0
    maximumScrollY = 500
    anchorDocumentTops.set(`${POST_URL}#comments`, SHIFTED_ANCHOR_DOCUMENT_TOP)
    page.state = { postFeedOrigin: origin, openImage: 'keep-open' }
    await mountFeed(
      async () => (await import('./PostFeed.svelte')).default,
      {},
      posts,
    )

    runAnimationFrame()
    expect(actualScrollY).toBe(maximumScrollY)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()
    expect(animationFrames.size).toBeGreaterThan(0)

    maximumScrollY = Number.POSITIVE_INFINITY
    runAnimationFrame()
    expect(link('comments').getBoundingClientRect().top).toBe(SAVED_ANCHOR_TOP)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()

    runAnimationFrame(VIRTUAL_LIST_RESIZE_DEBOUNCE_MS)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()

    runAnimationFrame(STABLE_INTERVAL_OVER_DEBOUNCE_MS)
    expect(link('comments').getBoundingClientRect().top).toBe(SAVED_ANCHOR_TOP)
    expect(navigation.replaceState).toHaveBeenCalledTimes(1)
    expect(page.state.postFeedOrigin).toBeUndefined()
    expect(page.state.openImage).toBe('keep-open')

    runAnimationFrame()
    expect(navigation.replaceState).toHaveBeenCalledTimes(1)
  })

  it('keeps retrying while the matching anchor is absent, then aligns it when mounted', async () => {
    const origin = await captureOrigin('post', SAVED_ANCHOR_TOP)
    actualScrollY = 0
    anchorDocumentTops.set(POST_URL, SHIFTED_ANCHOR_DOCUMENT_TOP)
    page.state = { postFeedOrigin: origin }
    const mountedProps = await mountFeed(
      async () => (await import('./PostFeed.svelte')).default,
      {},
      feedPosts(1),
    )

    runAnimationFrame()
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()
    expect(animationFrames.size).toBeGreaterThan(0)

    mountedProps.posts = posts
    client.flushSync()
    runAnimationFrame()
    expect(link('post').getBoundingClientRect().top).toBe(SAVED_ANCHOR_TOP)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()

    runAnimationFrame(VIRTUAL_LIST_RESIZE_DEBOUNCE_MS)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()

    runAnimationFrame(STABLE_INTERVAL_OVER_DEBOUNCE_MS)
    expect(link('post').getBoundingClientRect().top).toBe(SAVED_ANCHOR_TOP)
    expect(page.state.postFeedOrigin).toBeUndefined()
    expect(navigation.replaceState).toHaveBeenCalledTimes(1)
  })

  it('reveals an offscreen VirtualFeed post before aligning its exact anchor', async () => {
    const targetIndex = 20
    const changedRowHeight = 300
    const changedAnchorDocumentTop = targetIndex * changedRowHeight
    const origin = await captureOrigin('post', SAVED_ANCHOR_TOP)
    const virtualPosts = feedPosts(30)
    virtualPosts[targetIndex] = { post } as FeedViewPost

    actualScrollY = 0
    dispatchScrollEvents = true
    measuredHeights = Array(virtualPosts.length).fill(changedRowHeight)
    anchorDocumentTops.set(POST_URL, changedAnchorDocumentTop)
    page.state = { postFeedOrigin: origin }
    await mountFeed(
      async () => (await import('./VirtualFeed.svelte')).default,
      {
        params: { sort: 'top' } satisfies FeedPaginationParams,
        virtualList: { itemHeights: [...measuredHeights] },
      },
      virtualPosts,
    )

    expect(renderedPostLink(post.uri as string, 'post')).toBeUndefined()
    runAnimationFrame()
    const revealedLink = renderedPostLink(post.uri as string, 'post')
    expect(revealedLink).toBeDefined()
    expect(
      revealedLink?.closest('[data-index]')?.getAttribute('data-index'),
    ).toBe(String(targetIndex))
    expect(page.state.postFeedOrigin).toBe(origin)

    scrollTo.mockClear()
    runAnimationFrame()
    expect(requestedSavedPixel()).toBe(false)
    expect(
      renderedPostLink(post.uri as string, 'post')?.getBoundingClientRect().top,
    ).toBe(SAVED_ANCHOR_TOP)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()

    runAnimationFrame(VIRTUAL_LIST_RESIZE_DEBOUNCE_MS)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()

    runAnimationFrame(STABLE_INTERVAL_OVER_DEBOUNCE_MS)
    expect(
      renderedPostLink(post.uri as string, 'post')?.getBoundingClientRect().top,
    ).toBe(SAVED_ANCHOR_TOP)
    expect(navigation.replaceState).toHaveBeenCalledTimes(1)
    expect(page.state.postFeedOrigin).toBeUndefined()

    runAnimationFrame()
    expect(navigation.replaceState).toHaveBeenCalledTimes(1)
  })

  it('reveals a near-start VirtualFeed post before aligning its exact anchor', async () => {
    const targetIndex = 0
    const changedRowHeight = 300
    const changedAnchorDocumentTop = changedRowHeight
    const origin = await captureOrigin('post', SAVED_ANCHOR_TOP)
    const virtualPosts = feedPosts(30)
    virtualPosts[targetIndex] = { post } as FeedViewPost

    actualScrollY = SAVED_SCROLL_Y
    dispatchScrollEvents = true
    measuredHeights = Array(virtualPosts.length).fill(changedRowHeight)
    anchorDocumentTops.set(POST_URL, changedAnchorDocumentTop)
    page.state = { postFeedOrigin: origin }
    await mountFeed(
      async () => (await import('./VirtualFeed.svelte')).default,
      {
        params: { sort: 'top' } satisfies FeedPaginationParams,
        virtualList: { itemHeights: [...measuredHeights] },
      },
      virtualPosts,
    )
    window.dispatchEvent(new Event('scroll'))
    client.flushSync()

    expect(renderedPostLink(post.uri as string, 'post')).toBeUndefined()
    runAnimationFrame()
    const revealedLink = renderedPostLink(post.uri as string, 'post')
    expect(revealedLink).toBeDefined()
    expect(
      revealedLink?.closest('[data-index]')?.getAttribute('data-index'),
    ).toBe(String(targetIndex))
    expect(page.state.postFeedOrigin).toBe(origin)

    scrollTo.mockClear()
    runAnimationFrame()
    expect(requestedSavedPixel()).toBe(false)
    expect(
      renderedPostLink(post.uri as string, 'post')?.getBoundingClientRect().top,
    ).toBe(SAVED_ANCHOR_TOP)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()

    runAnimationFrame(VIRTUAL_LIST_RESIZE_DEBOUNCE_MS)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()

    runAnimationFrame(STABLE_INTERVAL_OVER_DEBOUNCE_MS)
    expect(
      renderedPostLink(post.uri as string, 'post')?.getBoundingClientRect().top,
    ).toBe(SAVED_ANCHOR_TOP)
    expect(navigation.replaceState).toHaveBeenCalledTimes(1)
    expect(page.state.postFeedOrigin).toBeUndefined()

    runAnimationFrame()
    expect(navigation.replaceState).toHaveBeenCalledTimes(1)
  })

  it('stops by a finite elapsed-time retry deadline without consuming an unalignable anchor', async () => {
    const origin = await captureOrigin('comments', SAVED_ANCHOR_TOP)
    actualScrollY = 0
    maximumScrollY = 100
    anchorDocumentTops.set(`${POST_URL}#comments`, SHIFTED_ANCHOR_DOCUMENT_TOP)
    page.state = { postFeedOrigin: origin }
    await mountFeed(
      async () => (await import('./PostFeed.svelte')).default,
      {},
      posts,
    )

    const retryDeadlineCeilingMs = 10_000
    let frameNumber = 1
    while (
      animationFrames.size > 0 &&
      frameNumber * HIGH_REFRESH_FRAME_MS <= retryDeadlineCeilingMs
    ) {
      runAnimationFrameAt(frameNumber * HIGH_REFRESH_FRAME_MS)
      frameNumber += 1
    }

    expect(animationFrameTime).toBeLessThanOrEqual(retryDeadlineCeilingMs)
    expect(animationFrames.size).toBe(0)
    expect(link('comments').getBoundingClientRect().top).not.toBe(
      SAVED_ANCHOR_TOP,
    )
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()
  })

  it.each(['component cleanup', 'URL replacement', 'page-state replacement'])(
    'cancels a pending retry on %s',
    async (ending) => {
      const origin = await captureOrigin('post', SAVED_ANCHOR_TOP)
      actualScrollY = 0
      page.state = { postFeedOrigin: origin }
      await mountFeed(
        async () => (await import('./PostFeed.svelte')).default,
        {},
        feedPosts(1),
      )
      runAnimationFrame()
      expect(animationFrames.size).toBeGreaterThan(0)

      scrollTo.mockClear()
      navigation.replaceState.mockClear()
      if (ending === 'component cleanup') {
        await unmount()
      } else if (ending === 'URL replacement') {
        page.url = new URL('https://coves.test/?sort=new')
        client.flushSync()
      } else {
        page.state = { openImage: 'replacement' }
        client.flushSync()
      }

      expect(animationFrames.size).toBe(0)
      runAnimationFrame()
      expect(scrollTo).not.toHaveBeenCalled()
      expect(navigation.replaceState).not.toHaveBeenCalled()
    },
  )
})

describe('pixel-only restoration', () => {
  it('verifies the resulting scroll position before consuming legacy state', async () => {
    const origin = { url: FEED_URL, scrollY: SAVED_SCROLL_Y }
    actualScrollY = 0
    maximumScrollY = 500
    page.state = { postFeedOrigin: origin, openModals: ['still-open'] }
    await mountFeed(
      async () => (await import('./PostFeed.svelte')).default,
      {},
      posts,
    )

    runAnimationFrame()
    expect(actualScrollY).toBe(maximumScrollY)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()
    expect(animationFrames.size).toBeGreaterThan(0)

    maximumScrollY = Number.POSITIVE_INFINITY
    runAnimationFrame()
    expect(actualScrollY).toBe(SAVED_SCROLL_Y)
    expect(page.state.postFeedOrigin).toBeUndefined()
    expect(page.state.openModals).toEqual(['still-open'])
    expect(navigation.replaceState).toHaveBeenCalledTimes(1)
  })

  it('bounds retries when a legacy pixel position stays clamped', async () => {
    const origin = { url: FEED_URL, scrollY: SAVED_SCROLL_Y }
    maximumScrollY = 500
    page.state = { postFeedOrigin: origin }
    await mountFeed(
      async () => (await import('./PostFeed.svelte')).default,
      {},
      posts,
    )

    let frameCount = 0
    while (animationFrames.size > 0 && frameCount < 100) {
      runAnimationFrame()
      frameCount += 1
    }

    expect(frameCount).toBeLessThan(100)
    expect(animationFrames.size).toBe(0)
    expect(actualScrollY).toBe(maximumScrollY)
    expect(page.state.postFeedOrigin).toBe(origin)
    expect(navigation.replaceState).not.toHaveBeenCalled()
  })
})

describe('VirtualFeed cached measurement ownership', () => {
  it('saves measurements into its response and supplies them before remount scroll', async () => {
    const remountScrollY = 281
    measuredHeights = [120, 180]
    const response: CachedFeedResponse = {
      feed: feedPosts(2),
      params: { sort: 'top' },
      virtualList: { itemHeights: [] },
    }

    await mountResponse(response)
    await unmount()
    expect(response.virtualList.itemHeights).toEqual(measuredHeights)

    page.state = {
      postFeedOrigin: { url: FEED_URL, scrollY: remountScrollY },
    }
    animationFrames.clear()
    scrollTo.mockClear()
    await mountResponse(response)

    expect(target.querySelector<HTMLElement>('#feed')?.style.height).toBe(
      '300px',
    )
    expect(scrollTo).not.toHaveBeenCalled()
    runAnimationFrame()
    expect(requestedSavedPixel(remountScrollY)).toBe(true)
  })

  it('keeps an outgoing teardown from writing measurements into the replacement response', async () => {
    measuredHeights = [120, 180]
    const responseA: CachedFeedResponse = {
      feed: feedPosts(2),
      params: { sort: 'top' },
      virtualList: { itemHeights: [] },
    }
    const responseB: CachedFeedResponse = {
      feed: feedPosts(1),
      params: { sort: 'new' },
      virtualList: { itemHeights: [] },
    }

    const props = await mountResponse(responseA)
    props.response = responseB
    client.flushSync()

    expect.soft(responseA.virtualList.itemHeights).toEqual(measuredHeights)
    expect(responseB.virtualList.itemHeights).toEqual([])
  })
})
