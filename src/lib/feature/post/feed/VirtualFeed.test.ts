// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeedViewPost, FeedPaginationParams } from '$lib/api/coves/types'
import type { ServerSession } from '$lib/app/state/auth.svelte'
import { XrpcError } from '$lib/api/coves/xrpc'

// ---------------------------------------------------------------------------
// VirtualFeed's load-more path is driven entirely by an IntersectionObserver on
// the spinner sentinel plus a re-arm that runs after every settled request.
// IntersectionObserver only reports intersection *changes*, so any trigger the
// component drops is gone for good — these tests exist to prove the component
// never drops one silently, and never chains without bound.
//
// Mounting a real Svelte 5 component under Vitest needs three shims, all of
// them environmental rather than behavioural:
//
//  1. `// @vitest-environment jsdom` above — the repo default is `node`.
//  2. The `svelte` and `svelte/reactivity` mocks below. Vitest externalises
//     node_modules, so Node resolves those specifiers with server conditions
//     and hands back the SSR runtime (`mount is not a function`, `onDestroy`
//     blowing up in index-server.js, a SvelteMap that never notifies), even
//     though vite-plugin-svelte compiled every component for the DOM.
//     Redirecting each to its client entry re-unites the two halves.
//  3. jsdom implements neither ResizeObserver (VirtualList) nor the Web
//     Animations API (the `in:fly` on each row), so both are stubbed per test.
//
// Everything else — the observer, the clock-free promise plumbing, the rects —
// is the actual behaviour under test and is controlled explicitly.
// ---------------------------------------------------------------------------

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

vi.mock('$env/dynamic/public', () => ({ env: {} }))

// The Post subtree is irrelevant to pagination; expose only each fixture URI so
// replacement tests can distinguish bound state from content rendered onscreen.
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

interface SvelteClient {
  mount: (
    component: unknown,
    options: { target: Element; props: unknown; intro?: boolean },
  ) => unknown
  unmount: (component: unknown, options?: { outro?: boolean }) => void
  flushSync: (fn?: () => void) => void
}

interface FeedPage {
  feed: FeedViewPost[]
  cursor?: string
}

interface TestFeedPaginationParams extends FeedPaginationParams {
  listing?: 'discover' | 'timeline'
  community?: string
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

/** Minimal FeedViewPost: only `post.uri` and `reason` are read by the feed. */
const feedPost = (uri: string): FeedViewPost =>
  ({ post: { uri } }) as unknown as FeedViewPost

let sessionGeneration = 0

const viewerSession = (viewer: string): ServerSession =>
  ({
    authenticated: true,
    activeAccountId: `did:plc:${viewer}`,
    sessionGeneration: `${viewer}-generation-${++sessionGeneration}`,
    account: {
      id: `did:plc:${viewer}`,
      did: `did:plc:${viewer}`,
      handle: `${viewer}.test`,
      instance: 'http://localhost:8081',
    },
  }) as ServerSession

// --- IntersectionObserver double ------------------------------------------

interface ObserverRecord {
  callback: IntersectionObserverCallback
  options?: IntersectionObserverInit
  targets: Element[]
  disconnected: boolean
}

let observers: ObserverRecord[] = []

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin: string
  readonly thresholds: ReadonlyArray<number> = []
  #record: ObserverRecord

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.rootMargin = options?.rootMargin ?? '0px'
    this.#record = { callback, options, targets: [], disconnected: false }
    observers.push(this.#record)
  }

  observe(target: Element): void {
    this.#record.targets.push(target)
  }

  unobserve(target: Element): void {
    this.#record.targets = this.#record.targets.filter((el) => el !== target)
  }

  disconnect(): void {
    this.#record.disconnected = true
    this.#record.targets = []
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

/**
 * The sentinel observer, identified by the rootMargin VirtualFeed gives it —
 * the other observer the component creates (last-seen post tracking) is
 * threshold-based.
 */
const sentinelObserver = (): ObserverRecord | undefined =>
  observers.find(
    (o) => !o.disconnected && !!o.options?.rootMargin && o.targets.length > 0,
  )

/** Deliver an intersection callback for the sentinel, as the browser would. */
const fireSentinel = (isIntersecting = true): void => {
  const observer = sentinelObserver()
  if (!observer) throw new Error('sentinel is not being observed')
  observer.callback(
    observer.targets.map(
      (target) => ({ target, isIntersecting }) as IntersectionObserverEntry,
    ),
    observer as unknown as IntersectionObserver,
  )
}

// --- viewport geometry -----------------------------------------------------

/** Rect reported for every element; drives the component's sentinelInView(). */
let rect = { top: 0, bottom: 0 }

/** Far below the fold: only an explicit trigger can start a load. */
const OUT_OF_VIEW = { top: 5000, bottom: 5400 }
/** Sentinel sitting in the viewport: the short-page chaining case. */
const IN_VIEW = { top: 100, bottom: 500 }

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

// --- harness ---------------------------------------------------------------

let client: SvelteClient
let mounted: unknown
let target: HTMLElement

beforeEach(async () => {
  observers = []
  rect = OUT_OF_VIEW

  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ ...rect, left: 0, right: 0, width: 0, height: 0 }) as DOMRect,
  )
  Object.assign(Element.prototype, {
    animate: () => new FakeAnimation(),
    getAnimations: () => [],
  })

  // The document is pinned well away from its own bottom for every test. The
  // sentinel is not the last thing on the page (the `children` snippet renders
  // after it), so "the viewer can see the spinner" and "the viewer has scrolled
  // to the end of the document" are different questions — these tests answer
  // the first one, via the rect above, and this makes sure the second one
  // cannot accidentally stand in for it.
  for (const [property, value] of [
    ['scrollHeight', 5000],
    ['clientHeight', 800],
    ['scrollTop', 0],
  ] as const) {
    Object.defineProperty(document.documentElement, property, {
      value,
      configurable: true,
    })
  }

  client = (await import('svelte')) as unknown as SvelteClient
})

afterEach(() => {
  if (mounted) client.unmount(mounted, { outro: false })
  mounted = undefined
  target?.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** More pages than any test legitimately loads. */
const RUNAWAY_PAGES = 12

interface Harness {
  /** Live props object; assigning to `posts` is a feed switch. */
  props: { posts: FeedViewPost[]; params: TestFeedPaginationParams }
  loadFeed: ReturnType<typeof vi.fn>
}

interface StateHarnessComponent {
  currentPosts: () => FeedViewPost[]
  replacePosts: (posts: FeedViewPost[]) => void
  currentParams: () => TestFeedPaginationParams
  replaceParams: (params: TestFeedPaginationParams) => void
}

const mountFeed = async (
  posts: FeedViewPost[],
  params: TestFeedPaginationParams,
  loadFeed: (params: TestFeedPaginationParams) => Promise<FeedPage>,
  { stateProxy = false }: { stateProxy?: boolean } = {},
): Promise<Harness> => {
  // A runaway pagination loop is one of the bugs under test, and left
  // unbounded it hangs the worker instead of failing. Past the cap every page
  // is empty, which stops the component and leaves the call count — which
  // every test asserts — as the visible failure.
  const spy = vi.fn(async (p: TestFeedPaginationParams): Promise<FeedPage> => {
    if (spy.mock.calls.length > RUNAWAY_PAGES) return { feed: [] }
    return loadFeed(p)
  })

  target = document.createElement('div')
  document.body.appendChild(target)

  if (stateProxy) {
    const StateHarness = (await import('./VirtualFeed.test.svelte')).default
    mounted = client.mount(StateHarness, {
      target,
      props: {
        initialPosts: posts,
        initialParams: params,
        loadFeed: spy,
      },
      intro: false,
    })
    const state = mounted as StateHarnessComponent
    const props = {
      get posts(): FeedViewPost[] {
        return state.currentPosts()
      },
      set posts(value: FeedViewPost[]) {
        state.replacePosts(value)
      },
      get params(): TestFeedPaginationParams {
        return state.currentParams()
      },
      set params(value: TestFeedPaginationParams) {
        state.replaceParams(value)
      },
    }
    client.flushSync()
    return { props, loadFeed: spy }
  }

  const { SvelteMap } = await import('svelte/reactivity')
  const VirtualFeed = (await import('./VirtualFeed.svelte')).default
  // Props must be reactive for a feed switch (`props.posts = […]`) to reach
  // the component, and runes are unavailable in a plain .ts file. Accessors
  // over a SvelteMap are the public-API equivalent: the component reads them
  // inside its effects, so each get() is tracked and each set() re-runs them.
  // `params` is $bindable and written by the component, hence the setters.
  const values = new SvelteMap<string, unknown>([
    ['posts', posts],
    ['params', params],
  ])
  const props = {
    get posts(): FeedViewPost[] {
      return values.get('posts') as FeedViewPost[]
    },
    set posts(value: FeedViewPost[]) {
      values.set('posts', value)
    },
    get params(): TestFeedPaginationParams {
      return values.get('params') as TestFeedPaginationParams
    },
    set params(value: TestFeedPaginationParams) {
      values.set('params', value)
    },
    loadFeed: spy,
  }

  mounted = client.mount(VirtualFeed, { target, props, intro: false })
  client.flushSync()

  return { props, loadFeed: spy }
}

/**
 * Drain every pending microtask (awaits, tick(), queueMicrotask re-arms) and
 * flush Svelte's effects, repeatedly — one settled request can legitimately
 * chain into the next.
 */
const settle = async (rounds = 6): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    client.flushSync()
  }
}

/** Drain promise, tick, and queued-microtask work without advancing a clock. */
const flushEffects = async (rounds = 8): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
    client.flushSync()
  }
}

const retryButton = (): HTMLButtonElement | undefined =>
  [...target.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Retry',
  )

const retryStatus = (): HTMLElement | null =>
  target.querySelector<HTMLElement>(
    '[role="status"], [aria-live="polite"], [aria-live="assertive"]',
  )

const expectRetrySeconds = (seconds: number): void => {
  expect(target.textContent).toMatch(
    new RegExp(`\\b${seconds}\\s+seconds?\\b`, 'i'),
  )
}

const discoverUnavailable = (retryAfterSeconds?: number): XrpcError =>
  new XrpcError(
    503,
    'DiscoverUnavailable',
    'Discover is recovering',
    retryAfterSeconds,
  )

const NO_NEW_POSTS = '[feed] page returned no new posts; stopping pagination'

/**
 * Collect console.warn calls, keeping only VirtualFeed's own: Svelte's dev
 * warnings (non-reactive bindings on the stubbed Post, ownership) share the
 * channel and would otherwise be counted as feed warnings.
 */
const captureFeedWarnings = (): unknown[][] => {
  const captured: unknown[][] = []
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (args[0] === NO_NEW_POSTS) captured.push(args)
  })
  return captured
}

describe('VirtualFeed load-more', () => {
  it('stops paginating when a non-empty page yields no new posts', async () => {
    const warnings = captureFeedWarnings()

    // A cursor that never advances: the API keeps returning page 1 and keeps
    // handing back a cursor, so nothing but the dedupe result can stop this.
    const { loadFeed } = await mountFeed(
      [feedPost('at://post/1')],
      { limit: 20, cursor: 'stuck' },
      async () => ({ feed: [feedPost('at://post/1')], cursor: 'stuck' }),
    )

    // In view for the whole test: if the re-arm ignored the dedupe result it
    // would chain forever rather than stopping after one page.
    rect = IN_VIEW
    fireSentinel()
    await settle()

    expect(loadFeed).toHaveBeenCalledTimes(1)
    expect(warnings).toEqual([[NO_NEW_POSTS, { cursor: 'stuck', returned: 1 }]])
    // hasMore latched false: the sentinel is unmounted, so its observer went.
    expect(sentinelObserver()).toBeUndefined()
  })

  it('appends a page of genuinely new posts and keeps paginating', async () => {
    const { props, loadFeed } = await mountFeed(
      [feedPost('at://post/1')],
      { limit: 20 },
      async () => ({ feed: [feedPost('at://post/2')], cursor: 'page-2' }),
    )

    fireSentinel()
    await settle()

    expect(loadFeed).toHaveBeenCalledTimes(1)
    expect(props.posts.map((p) => p.post.uri)).toEqual([
      'at://post/1',
      'at://post/2',
    ])
    expect(props.params.cursor).toBe('page-2')
    // Out of view and no missed trigger: the feed waits for the next scroll.
    expect(sentinelObserver()).toBeDefined()
  })

  it('clears a stale cursor when the successful page is final', async () => {
    const { props, loadFeed } = await mountFeed(
      [feedPost('at://post/1')],
      { limit: 20, cursor: 'last-page' },
      async () => ({ feed: [feedPost('at://post/2')] }),
    )

    fireSentinel()
    await settle()

    expect(loadFeed).toHaveBeenCalledTimes(1)
    expect(props.posts.map((post) => post.post.uri)).toEqual([
      'at://post/1',
      'at://post/2',
    ])
    expect(props.params.cursor).toBeUndefined()
    expect(sentinelObserver()).toBeUndefined()
  })

  it('loads the new feed after a feed switch during an in-flight request', async () => {
    let resolveStale: (page: FeedPage) => void = () => {}
    const stale = new Promise<FeedPage>((resolve) => {
      resolveStale = resolve
    })

    const loadFeed = vi
      .fn<(params: FeedPaginationParams) => Promise<FeedPage>>()
      .mockImplementationOnce(() => stale)
      .mockImplementationOnce(async () => ({
        feed: [feedPost('at://b/2')],
        cursor: 'b-2',
      }))

    const feedA = [feedPost('at://a/1')]
    const { props } = await mountFeed(
      feedA,
      { limit: 20, cursor: 'a-1' },
      (p) => loadFeed(p),
    )

    // Page 2 of feed A goes in flight.
    fireSentinel()
    await settle(1)
    expect(loadFeed).toHaveBeenCalledTimes(1)

    // The user navigates to feed B; its sentinel intersects immediately, but
    // `loading` is still held by feed A's request, so the trigger is dropped.
    props.posts = [feedPost('at://b/1')]
    props.params = { limit: 20, cursor: 'b-1' }
    client.flushSync()
    fireSentinel()
    expect(loadFeed).toHaveBeenCalledTimes(1)

    // Feed A's page lands on a feed nobody is looking at and is discarded —
    // this is the settle that must re-arm, and the sentinel is out of view, so
    // only the remembered trigger can rescue the new feed.
    resolveStale({ feed: [feedPost('at://a/2')], cursor: 'a-2' })
    await settle()

    expect(loadFeed).toHaveBeenCalledTimes(2)
    expect(loadFeed.mock.calls[1]?.[0]).toMatchObject({ cursor: 'b-1' })
    // Feed B got its page; feed A's discarded page went nowhere.
    expect(props.posts.map((p) => p.post.uri)).toEqual(['at://b/1', 'at://b/2'])
    expect(feedA.map((p) => p.post.uri)).toEqual(['at://a/1'])
  })

  it('issues one request for concurrent triggers', async () => {
    // Last page (no cursor) so the settle cannot re-arm: every call counted
    // here is a concurrent one.
    const { loadFeed } = await mountFeed(
      [feedPost('at://post/1')],
      { limit: 20 },
      async () => ({ feed: [feedPost('at://post/2')] }),
    )

    fireSentinel()
    fireSentinel()
    fireSentinel()
    await settle()

    expect(loadFeed).toHaveBeenCalledTimes(1)
  })

  it('chains the next page while the sentinel stays in view', async () => {
    const pages: FeedPage[] = [
      { feed: [feedPost('at://post/2')], cursor: 'page-2' },
      { feed: [feedPost('at://post/3')], cursor: 'page-3' },
      { feed: [], cursor: undefined },
    ]

    // A short first page under a tall viewport never leaves the sentinel, so
    // the observer reports no further change — the re-arm has to carry it.
    rect = IN_VIEW
    const { props, loadFeed } = await mountFeed(
      [feedPost('at://post/1')],
      { limit: 20 },
      async () => pages.shift() ?? { feed: [] },
    )

    fireSentinel()
    await settle()

    expect(loadFeed).toHaveBeenCalledTimes(3)
    expect(props.posts.map((p) => p.post.uri)).toEqual([
      'at://post/1',
      'at://post/2',
      'at://post/3',
    ])
  })

  it('does not re-arm after a failed request', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    rect = IN_VIEW
    const { loadFeed } = await mountFeed(
      [feedPost('at://post/1')],
      { limit: 20 },
      async () => {
        throw new Error('network down')
      },
    )

    fireSentinel()
    await settle()

    // The error UI replaces the sentinel; retrying is the user's call.
    expect(loadFeed).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalled()
    expect(sentinelObserver()).toBeUndefined()
  })

  it('replaces stale Discover Hot posts once after an expired cursor', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const requestedCursors: Array<string | undefined> = []
    const { props, loadFeed } = await mountFeed(
      [feedPost('at://post/stale-only'), feedPost('at://post/overlap')],
      { listing: 'discover', sort: 'hot', limit: 20, cursor: 'expired' },
      async (params) => {
        requestedCursors.push(params.cursor)
        if (requestedCursors.length === 1) {
          throw new XrpcError(400, 'InvalidCursor', 'cursor expired')
        }
        return {
          feed: [
            feedPost('at://post/overlap'),
            feedPost('at://post/fresh'),
            feedPost('at://post/overlap'),
            feedPost('at://post/fresh'),
          ],
          cursor: 'fresh-page-2',
        }
      },
    )

    fireSentinel()
    await flushEffects()

    expect(loadFeed).toHaveBeenCalledTimes(2)
    expect(requestedCursors).toEqual(['expired', undefined])
    expect(props.posts.map((post) => post.post.uri)).toEqual([
      'at://post/overlap',
      'at://post/fresh',
    ])
    expect(props.params.cursor).toBe('fresh-page-2')
    expect(retryButton()).toBeUndefined()
    expect(sentinelObserver()).toBeDefined()
  })

  it('keeps a recovered first page without a cursor exhausted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const requestedCursors: Array<string | undefined> = []
    const { props, loadFeed } = await mountFeed(
      [feedPost('at://post/stale')],
      { listing: 'discover', sort: 'hot', limit: 20, cursor: 'expired' },
      async (params) => {
        requestedCursors.push(params.cursor)
        if (requestedCursors.length === 1) {
          throw new XrpcError(400, 'InvalidCursor', 'cursor expired')
        }
        return { feed: [feedPost('at://post/replacement')] }
      },
    )

    rect = IN_VIEW
    fireSentinel()
    await flushEffects()

    expect(loadFeed).toHaveBeenCalledTimes(2)
    expect(requestedCursors).toEqual(['expired', undefined])
    expect(props.posts.map((post) => post.post.uri)).toEqual([
      'at://post/replacement',
    ])
    expect(props.params.cursor).toBeUndefined()
    expect(retryButton()).toBeUndefined()
    expect(sentinelObserver()).toBeUndefined()
  })

  it('keeps a recovered page-one result when bindable values are state proxies', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const stalePosts = [feedPost('at://post/stale')]
    const initialParams = {
      listing: 'discover' as const,
      sort: 'hot',
      limit: 20,
      cursor: 'expired',
    }
    const replacement = [feedPost('at://post/replacement')]
    const requestedCursors: Array<string | undefined> = []
    const { props, loadFeed } = await mountFeed(
      stalePosts,
      initialParams,
      async (requestParams) => {
        requestedCursors.push(requestParams.cursor)
        if (requestedCursors.length === 1) {
          throw new XrpcError(400, 'InvalidCursor', 'cursor expired')
        }
        return { feed: replacement }
      },
      { stateProxy: true },
    )

    expect(props.posts).not.toBe(stalePosts)
    expect(props.params).not.toBe(initialParams)

    rect = IN_VIEW
    fireSentinel()
    await flushEffects()

    const finalPosts = props.posts
    const finalParams = props.params
    expect(loadFeed).toHaveBeenCalledTimes(2)
    expect(requestedCursors).toEqual(['expired', undefined])
    expect(finalPosts.map((post) => post.post.uri)).toEqual([
      'at://post/replacement',
    ])
    expect(finalParams.cursor).toBeUndefined()
    expect(sentinelObserver()).toBeUndefined()

    await flushEffects()
    expect(props.posts).toBe(finalPosts)
    expect(props.params).toBe(finalParams)
    expect(loadFeed).toHaveBeenCalledTimes(2)
    expect(sentinelObserver()).toBeUndefined()
  })

  it.each([
    [
      'another InvalidCursor',
      () => new XrpcError(400, 'InvalidCursor', 'still expired'),
    ],
    ['an ordinary error', () => new Error('network down')],
  ] satisfies Array<[string, () => Error]>)(
    'keeps stale posts and retries page one manually after %s',
    async (_case, recoveryError) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const requestedCursors: Array<string | undefined> = []
      const { props, loadFeed } = await mountFeed(
        [feedPost('at://post/stale')],
        { listing: 'discover', sort: 'hot', limit: 20, cursor: 'expired' },
        async (params) => {
          requestedCursors.push(params.cursor)
          if (requestedCursors.length === 1) {
            throw new XrpcError(400, 'InvalidCursor', 'cursor expired')
          }
          if (requestedCursors.length === 2) throw recoveryError()
          return { feed: [feedPost('at://post/replacement')] }
        },
      )

      fireSentinel()
      await flushEffects()

      expect(loadFeed).toHaveBeenCalledTimes(2)
      expect(requestedCursors).toEqual(['expired', undefined])
      expect(props.posts.map((post) => post.post.uri)).toEqual([
        'at://post/stale',
      ])
      expect(props.params.cursor).toBeUndefined()

      const retry = retryButton()
      if (!retry) throw new Error('Missing retry button')
      retry.click()
      await flushEffects()

      expect(loadFeed).toHaveBeenCalledTimes(3)
      expect(requestedCursors).toEqual(['expired', undefined, undefined])
    },
  )

  it.each([
    {
      case: 'Discover New',
      params: { listing: 'discover', sort: 'new', cursor: 'expired' },
      error: new XrpcError(400, 'InvalidCursor', 'cursor expired'),
    },
    {
      case: 'the timeline',
      params: { listing: 'timeline', sort: 'hot', cursor: 'expired' },
      error: new XrpcError(400, 'InvalidCursor', 'cursor expired'),
    },
    {
      case: 'a community feed',
      params: {
        community: 'news.coves.social',
        sort: 'hot',
        cursor: 'expired',
      },
      error: new XrpcError(400, 'InvalidCursor', 'cursor expired'),
    },
    {
      case: 'a feed without a listing',
      params: { sort: 'hot', cursor: 'expired' },
      error: new XrpcError(400, 'InvalidCursor', 'cursor expired'),
    },
    {
      case: 'Discover Hot without a cursor',
      params: { listing: 'discover', sort: 'hot' },
      error: new XrpcError(400, 'InvalidCursor', 'cursor expired'),
    },
    {
      case: 'the wrong status',
      params: { listing: 'discover', sort: 'hot', cursor: 'expired' },
      error: new XrpcError(503, 'InvalidCursor', 'backend unavailable'),
    },
    {
      case: 'the wrong error name',
      params: { listing: 'discover', sort: 'hot', cursor: 'expired' },
      error: new XrpcError(400, 'InvalidRequest', 'bad request'),
    },
  ] satisfies Array<{
    case: string
    params: TestFeedPaginationParams
    error: XrpcError
  }>)(
    'does not automatically recover $case',
    async ({ params, error: requestError }) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const requestedCursors: Array<string | undefined> = []
      const { props, loadFeed } = await mountFeed(
        [feedPost('at://post/stale')],
        params,
        async (requestParams) => {
          requestedCursors.push(requestParams.cursor)
          throw requestError
        },
      )

      fireSentinel()
      await flushEffects()

      expect(loadFeed).toHaveBeenCalledTimes(1)
      expect(requestedCursors).toEqual([params.cursor])
      expect(props.params.cursor).toBe(params.cursor)
      expect(props.posts.map((post) => post.post.uri)).toEqual([
        'at://post/stale',
      ])
    },
  )

  it('discards InvalidCursor from an original request after a feed switch', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original = deferred<FeedPage>()
    const { props, loadFeed } = await mountFeed(
      [feedPost('at://a/1')],
      { listing: 'discover', sort: 'hot', cursor: 'a-expired' },
      async () => original.promise,
    )

    fireSentinel()
    await flushEffects(2)
    expect(loadFeed).toHaveBeenCalledTimes(1)

    const feedB = [feedPost('at://b/1')]
    props.posts = feedB
    props.params = {
      listing: 'discover',
      sort: 'hot',
      cursor: 'b-page-2',
    }
    client.flushSync()

    original.reject(new XrpcError(400, 'InvalidCursor', 'cursor expired'))
    await flushEffects()

    expect(loadFeed).toHaveBeenCalledTimes(1)
    expect(props.posts).toBe(feedB)
    expect(props.params.cursor).toBe('b-page-2')
    expect(retryButton()).toBeUndefined()
    expect(sentinelObserver()).toBeDefined()
  })

  it('discards a recovered page that settles after a feed switch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const recovery = deferred<FeedPage>()
    const requestedCursors: Array<string | undefined> = []
    const { props, loadFeed } = await mountFeed(
      [feedPost('at://a/1')],
      { listing: 'discover', sort: 'hot', cursor: 'a-expired' },
      async (params) => {
        requestedCursors.push(params.cursor)
        if (requestedCursors.length === 1) {
          throw new XrpcError(400, 'InvalidCursor', 'cursor expired')
        }
        return recovery.promise
      },
    )

    fireSentinel()
    await flushEffects()
    expect(loadFeed).toHaveBeenCalledTimes(2)
    expect(requestedCursors).toEqual(['a-expired', undefined])

    const feedB = [feedPost('at://b/1')]
    props.posts = feedB
    props.params = {
      listing: 'discover',
      sort: 'hot',
      cursor: 'b-page-2',
    }
    client.flushSync()

    recovery.resolve({
      feed: [feedPost('at://a/recovered')],
      cursor: 'a-fresh-page-2',
    })
    await flushEffects()

    expect(loadFeed).toHaveBeenCalledTimes(2)
    expect(props.posts).toBe(feedB)
    expect(props.posts.map((post) => post.post.uri)).toEqual(['at://b/1'])
    expect(props.params.cursor).toBe('b-page-2')
    expect(retryButton()).toBeUndefined()
  })

  it.each([
    {
      transition: 'viewer A changes to viewer B',
      initialSession: viewerSession('viewer-a'),
      nextSession: viewerSession('viewer-b'),
      pendingStage: 'pagination' as const,
    },
    {
      transition: 'viewer A signs out',
      initialSession: viewerSession('viewer-a'),
      nextSession: undefined,
      pendingStage: 'InvalidCursor recovery' as const,
    },
  ])(
    'immediately replaces page one and discards $pendingStage started before $transition',
    async ({ initialSession, nextSession, pendingStage }) => {
      const { profile } = await import('$lib/app/state/auth.svelte')
      profile.syncFromServer(initialSession)
      client.flushSync()

      const staleResponse = deferred<FeedPage>()
      const currentViewerResponse = deferred<FeedPage>()
      const requestedCursors: Array<string | undefined> = []
      const initialPosts = [feedPost('at://old-viewer/existing')]
      const { props, loadFeed } = await mountFeed(
        initialPosts,
        {
          listing: 'discover',
          sort: 'hot',
          cursor:
            pendingStage === 'InvalidCursor recovery'
              ? 'old-viewer-expired'
              : 'old-viewer-page-2',
        },
        async (requestParams) => {
          requestedCursors.push(requestParams.cursor)
          if (
            pendingStage === 'InvalidCursor recovery' &&
            requestedCursors.length === 1
          ) {
            throw new XrpcError(400, 'InvalidCursor', 'cursor expired')
          }
          if (
            requestedCursors.length ===
            (pendingStage === 'InvalidCursor recovery' ? 2 : 1)
          ) {
            return staleResponse.promise
          }
          return currentViewerResponse.promise
        },
      )

      fireSentinel()
      await flushEffects()
      expect(loadFeed).toHaveBeenCalledTimes(
        pendingStage === 'InvalidCursor recovery' ? 2 : 1,
      )

      profile.syncFromServer(nextSession)
      await flushEffects()

      expect.soft(props.posts).not.toBe(initialPosts)
      expect.soft(props.posts).toEqual([])
      expect.soft(props.params.cursor).toBeUndefined()
      expect
        .soft(loadFeed)
        .toHaveBeenCalledTimes(
          pendingStage === 'InvalidCursor recovery' ? 3 : 2,
        )
      expect(requestedCursors.at(-1)).toBeUndefined()

      staleResponse.resolve({
        feed: [feedPost('at://old-viewer/late')],
        cursor: 'old-viewer-late-cursor',
      })
      await flushEffects()

      expect(props.posts).toEqual([])
      expect(props.params.cursor).toBeUndefined()
      expect(retryButton()).toBeUndefined()

      currentViewerResponse.resolve({
        feed: [feedPost('at://new-viewer/page-one')],
        cursor: 'new-viewer-page-2',
      })
      await flushEffects()

      expect(props.posts.map((post) => post.post.uri)).toEqual([
        'at://new-viewer/page-one',
      ])
      expect(props.params.cursor).toBe('new-viewer-page-2')
    },
  )

  it.each(['original pagination', 'InvalidCursor recovery'] as const)(
    'does not commit a successful %s response after unmount',
    async (pendingStage) => {
      const pending = deferred<FeedPage>()
      const requestedCursors: Array<string | undefined> = []
      const initialPosts = [feedPost('at://post/existing')]
      const { props, loadFeed } = await mountFeed(
        initialPosts,
        {
          listing: 'discover',
          sort: 'hot',
          cursor:
            pendingStage === 'InvalidCursor recovery'
              ? 'expired-page-2'
              : 'page-2',
        },
        async (requestParams) => {
          requestedCursors.push(requestParams.cursor)
          if (
            pendingStage === 'InvalidCursor recovery' &&
            requestedCursors.length === 1
          ) {
            throw new XrpcError(400, 'InvalidCursor', 'cursor expired')
          }
          return pending.promise
        },
      )

      fireSentinel()
      await flushEffects()
      const expectedCalls = pendingStage === 'InvalidCursor recovery' ? 2 : 1
      expect(loadFeed).toHaveBeenCalledTimes(expectedCalls)
      const postsBeforeUnmount = props.posts
      const paramsBeforeUnmount = props.params

      client.unmount(mounted, { outro: false })
      mounted = undefined
      pending.resolve({
        feed: [feedPost('at://post/late')],
        cursor: 'late-page-2',
      })
      await flushEffects()

      expect(props.posts).toBe(postsBeforeUnmount)
      expect(props.posts.map((post) => post.post.uri)).toEqual([
        'at://post/existing',
      ])
      expect(props.params).toBe(paramsBeforeUnmount)
      expect(props.params.cursor).toBe(
        pendingStage === 'InvalidCursor recovery' ? undefined : 'page-2',
      )
      expect(loadFeed).toHaveBeenCalledTimes(expectedCalls)
    },
  )

  it('disconnects every IntersectionObserver on unmount', async () => {
    await mountFeed(
      [feedPost('at://post/1')],
      { limit: 20, cursor: 'page-2' },
      async () => ({ feed: [] }),
    )
    await flushEffects()

    expect(observers.length).toBeGreaterThanOrEqual(2)
    expect(observers.some((observer) => !observer.disconnected)).toBe(true)

    client.unmount(mounted, { outro: false })
    mounted = undefined

    expect(observers.every((observer) => observer.disconnected)).toBe(true)
  })

  it('disconnects its MutationObserver on unmount', async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    await mountFeed(
      [feedPost('at://post/1')],
      { limit: 20, cursor: 'page-2' },
      async () => ({ feed: [] }),
    )
    await flushEffects()

    expect(disconnect).not.toHaveBeenCalled()
    client.unmount(mounted, { outro: false })
    mounted = undefined

    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  describe('Discover Hot capacity cooldown', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-13T12:00:00.000Z'))
    })

    it('blocks retries and observer triggers until the absolute deadline', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const firstPage = deferred<FeedPage>()
      const requestedCursors: Array<string | undefined> = []
      const posts = [feedPost('at://post/existing')]
      const { props, loadFeed } = await mountFeed(
        posts,
        {
          listing: 'discover',
          sort: 'hot',
          limit: 20,
          cursor: 'retained-page-2',
        },
        async (params) => {
          requestedCursors.push(params.cursor)
          if (requestedCursors.length === 1) return firstPage.promise
          return { feed: [feedPost('at://post/new')] }
        },
      )

      const observer = sentinelObserver()
      const observedSentinel = observer?.targets[0]
      if (!observer || !observedSentinel) {
        throw new Error('Missing initial sentinel observer')
      }

      fireSentinel()
      // This trigger is remembered while the first request is in flight.
      fireSentinel()
      firstPage.reject(discoverUnavailable(30))
      await flushEffects()

      expect(loadFeed).toHaveBeenCalledTimes(1)
      expect(requestedCursors).toEqual(['retained-page-2'])
      expect(props.posts).toBe(posts)
      expect(props.posts.map((post) => post.post.uri)).toEqual([
        'at://post/existing',
      ])
      expect(props.params.cursor).toBe('retained-page-2')
      expectRetrySeconds(30)

      let retry = retryButton()
      if (!retry) throw new Error('Missing retry button')
      expect(retry.disabled).toBe(true)

      // A callback already delivered by the old observer cannot bypass the
      // cooldown even though its sentinel has since been removed from the DOM.
      observer.callback(
        [
          {
            target: observedSentinel,
            isIntersecting: true,
          } as IntersectionObserverEntry,
        ],
        observer as unknown as IntersectionObserver,
      )
      retry.click()
      await flushEffects()
      expect(loadFeed).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(29_999)
      await flushEffects()
      expectRetrySeconds(1)
      retry = retryButton()
      if (!retry) throw new Error('Missing retry button before deadline')
      expect(retry.disabled).toBe(true)
      retry.click()
      expect(loadFeed).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      await flushEffects()
      retry = retryButton()
      if (!retry) throw new Error('Missing retry button at deadline')
      expect(retry.disabled).toBe(false)
      expect(loadFeed).toHaveBeenCalledTimes(1)

      retry.click()
      await flushEffects()
      expect(loadFeed).toHaveBeenCalledTimes(2)
      expect(requestedCursors).toEqual(['retained-page-2', 'retained-page-2'])
    })

    it('replaces a prior deadline with the delay advertised by a later response', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const secondResponse = deferred<FeedPage>()
      const requestedCursors: Array<string | undefined> = []
      const { loadFeed } = await mountFeed(
        [feedPost('at://post/existing')],
        { listing: 'discover', sort: 'hot', cursor: 'page-2' },
        async (params) => {
          requestedCursors.push(params.cursor)
          if (requestedCursors.length === 1) throw discoverUnavailable(30)
          if (requestedCursors.length === 2) return secondResponse.promise
          return { feed: [feedPost('at://post/new')] }
        },
      )

      fireSentinel()
      await flushEffects()
      expectRetrySeconds(30)

      await vi.advanceTimersByTimeAsync(30_000)
      await flushEffects()
      const retry = retryButton()
      if (!retry) throw new Error('Missing retry button at first deadline')
      expect(retry.disabled).toBe(false)
      retry.click()
      await flushEffects(2)
      expect(loadFeed).toHaveBeenCalledTimes(2)

      // The second server response arrives after the old deadline and starts
      // its own seven-second window at response time.
      await vi.advanceTimersByTimeAsync(2_000)
      secondResponse.reject(discoverUnavailable(7))
      await flushEffects()
      expectRetrySeconds(7)
      expect(retryButton()?.disabled).toBe(true)

      // This is old deadline + seven seconds, but only five seconds after the
      // second response. Extending the old deadline would enable too early.
      await vi.advanceTimersByTimeAsync(5_000)
      await flushEffects()
      expectRetrySeconds(2)
      expect(retryButton()?.disabled).toBe(true)
      expect(loadFeed).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(1_999)
      await flushEffects()
      expectRetrySeconds(1)
      expect(retryButton()?.disabled).toBe(true)

      await vi.advanceTimersByTimeAsync(1)
      await flushEffects()
      expect(retryButton()?.disabled).toBe(false)
      expect(loadFeed).toHaveBeenCalledTimes(2)
    })

    it('announces cooldown updates until retry becomes available', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const { loadFeed } = await mountFeed(
        [feedPost('at://post/existing')],
        { listing: 'discover', sort: 'hot', cursor: 'page-2' },
        async () => {
          throw discoverUnavailable(2)
        },
      )

      fireSentinel()
      await flushEffects()

      const status = retryStatus()
      if (!status) throw new Error('Missing cooldown status/live region')
      expect(status.textContent).toMatch(/\b2\s+seconds?\b/i)
      expect(retryButton()?.disabled).toBe(true)

      await vi.advanceTimersByTimeAsync(1_000)
      await flushEffects()
      expect(retryStatus()).toBe(status)
      expect(status.textContent).toMatch(/\b1\s+second\b/i)
      expect(retryButton()?.disabled).toBe(true)

      await vi.advanceTimersByTimeAsync(1_000)
      await flushEffects()
      expect(retryStatus()).toBe(status)
      expect(status.textContent).not.toMatch(/\b[1-9]\d*\s+seconds?\b/i)
      expect(retryButton()?.disabled).toBe(false)
      expect(loadFeed).toHaveBeenCalledTimes(1)
    })

    it('keeps page-one Retry visible while an identity replacement is empty and unavailable', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { profile } = await import('$lib/app/state/auth.svelte')
      profile.syncFromServer(viewerSession('viewer-a'))
      client.flushSync()
      const requestedCursors: Array<string | undefined> = []
      const { props, loadFeed } = await mountFeed(
        [feedPost('at://viewer-a/post/1')],
        {
          listing: 'discover',
          sort: 'hot',
          cursor: 'viewer-a-page-2',
        },
        async (requestParams) => {
          requestedCursors.push(requestParams.cursor)
          if (requestedCursors.length === 1) throw discoverUnavailable(2)
          return { feed: [feedPost('at://viewer-b/post/1')] }
        },
      )

      profile.syncFromServer(viewerSession('viewer-b'))
      await flushEffects()

      expect(loadFeed).toHaveBeenCalledTimes(1)
      expect(requestedCursors).toEqual([undefined])
      expect(props.posts).toEqual([])
      expect(target.textContent).toContain('Discover is recovering')
      let retry = retryButton()
      if (!retry) throw new Error('Missing page-one replacement Retry button')
      expect(retry.disabled).toBe(true)
      expect(target.textContent).toMatch(/\b2\s+seconds?\b/i)

      await vi.advanceTimersByTimeAsync(1_999)
      await flushEffects()
      expect(loadFeed).toHaveBeenCalledTimes(1)
      retry = retryButton()
      if (!retry) throw new Error('Missing Retry button before deadline')
      expect(retry.disabled).toBe(true)

      await vi.advanceTimersByTimeAsync(1)
      await flushEffects()
      retry = retryButton()
      if (!retry) throw new Error('Missing Retry button at deadline')
      expect(retry.disabled).toBe(false)
      retry.click()
      await flushEffects()

      expect(loadFeed).toHaveBeenCalledTimes(2)
      expect(requestedCursors).toEqual([undefined, undefined])
      expect(props.posts.map((post) => post.post.uri)).toEqual([
        'at://viewer-b/post/1',
      ])
      expect(
        target.querySelector('[data-post-uri="at://viewer-b/post/1"]'),
      ).not.toBeNull()
    })

    it.each([
      ['missing timing', undefined],
      ['negative timing', -1],
      ['non-finite timing', Number.NaN],
      ['zero seconds', 0],
    ] satisfies Array<[string, number | undefined]>)(
      'keeps %s immediately manually retryable',
      async (_case, retryAfterSeconds) => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const requestedCursors: Array<string | undefined> = []
        const { loadFeed } = await mountFeed(
          [feedPost('at://post/existing')],
          { listing: 'discover', sort: 'hot', cursor: 'page-2' },
          async (params) => {
            requestedCursors.push(params.cursor)
            if (requestedCursors.length === 1) {
              throw discoverUnavailable(retryAfterSeconds)
            }
            return { feed: [feedPost('at://post/new')] }
          },
        )

        fireSentinel()
        await flushEffects()

        const retry = retryButton()
        if (!retry) throw new Error('Missing retry button')
        expect(retry.disabled).toBe(false)
        expect(loadFeed).toHaveBeenCalledTimes(1)

        retry.click()
        await flushEffects()
        expect(loadFeed).toHaveBeenCalledTimes(2)
        expect(requestedCursors).toEqual(['page-2', 'page-2'])
      },
    )

    it('cools down page-one retry after InvalidCursor recovery reaches capacity', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const requestedCursors: Array<string | undefined> = []
      const stalePosts = [feedPost('at://post/stale')]
      const { props, loadFeed } = await mountFeed(
        stalePosts,
        {
          listing: 'discover',
          sort: 'hot',
          cursor: 'expired-page-2',
        },
        async (params) => {
          requestedCursors.push(params.cursor)
          if (requestedCursors.length === 1) {
            throw new XrpcError(400, 'InvalidCursor', 'cursor expired')
          }
          if (requestedCursors.length === 2) throw discoverUnavailable(30)
          return { feed: [feedPost('at://post/recovered')] }
        },
      )

      fireSentinel()
      await flushEffects()

      expect(loadFeed).toHaveBeenCalledTimes(2)
      expect(requestedCursors).toEqual(['expired-page-2', undefined])
      expect(props.posts).toBe(stalePosts)
      expect(props.posts.map((post) => post.post.uri)).toEqual([
        'at://post/stale',
      ])
      expect(props.params.cursor).toBeUndefined()
      expectRetrySeconds(30)
      expect(retryButton()?.disabled).toBe(true)

      await vi.advanceTimersByTimeAsync(30_000)
      await flushEffects()
      const retry = retryButton()
      if (!retry) throw new Error('Missing recovery retry button')
      expect(retry.disabled).toBe(false)
      expect(loadFeed).toHaveBeenCalledTimes(2)

      retry.click()
      await flushEffects()
      expect(loadFeed).toHaveBeenCalledTimes(3)
      expect(requestedCursors).toEqual(['expired-page-2', undefined, undefined])
    })

    it.each([
      ['without Retry-After', undefined, 0],
      ['with Retry-After', 30, 30_000],
    ] satisfies Array<[string, number | undefined, number]>)(
      'manually replaces stale posts after page-one recovery fails %s, even when every result overlaps',
      async (_case, retryAfterSeconds, cooldownMilliseconds) => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const requestedCursors: Array<string | undefined> = []
        const { props, loadFeed } = await mountFeed(
          [feedPost('at://post/stale-only'), feedPost('at://post/overlap')],
          {
            listing: 'discover',
            sort: 'hot',
            cursor: 'expired-page-2',
          },
          async (requestParams) => {
            requestedCursors.push(requestParams.cursor)
            if (requestedCursors.length === 1) {
              throw new XrpcError(400, 'InvalidCursor', 'cursor expired')
            }
            if (requestedCursors.length === 2) {
              throw discoverUnavailable(retryAfterSeconds)
            }
            return {
              feed: [feedPost('at://post/overlap')],
              cursor: 'fresh-page-2',
            }
          },
        )

        fireSentinel()
        await flushEffects()
        expect(loadFeed).toHaveBeenCalledTimes(2)
        expect(requestedCursors).toEqual(['expired-page-2', undefined])

        if (cooldownMilliseconds > 0) {
          await vi.advanceTimersByTimeAsync(cooldownMilliseconds)
          await flushEffects()
        }
        const retry = retryButton()
        if (!retry) throw new Error('Missing page-one retry button')
        expect(retry.disabled).toBe(false)
        retry.click()
        await flushEffects()

        expect(loadFeed).toHaveBeenCalledTimes(3)
        expect(requestedCursors).toEqual([
          'expired-page-2',
          undefined,
          undefined,
        ])
        expect(props.posts.map((post) => post.post.uri)).toEqual([
          'at://post/overlap',
        ])
        expect(props.params.cursor).toBe('fresh-page-2')
        expect(sentinelObserver()).toBeDefined()
      },
    )

    it.each([
      ['without Retry-After', undefined, 0],
      ['after Retry-After expires', 1, 1_000],
    ] satisfies Array<[string, number | undefined, number]>)(
      'allows only manual Retry to resume from an error %s',
      async (_case, retryAfterSeconds, cooldownMilliseconds) => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const requestedCursors: Array<string | undefined> = []
        const { loadFeed } = await mountFeed(
          [feedPost('at://post/existing')],
          { listing: 'discover', sort: 'hot', cursor: 'page-2' },
          async (requestParams) => {
            requestedCursors.push(requestParams.cursor)
            if (requestedCursors.length === 1) {
              throw discoverUnavailable(retryAfterSeconds)
            }
            return { feed: [feedPost('at://post/new')] }
          },
        )
        const observer = sentinelObserver()
        const observedSentinel = observer?.targets[0]
        if (!observer || !observedSentinel) {
          throw new Error('Missing initial sentinel observer')
        }

        fireSentinel()
        await flushEffects()
        expect(loadFeed).toHaveBeenCalledTimes(1)

        if (cooldownMilliseconds > 0) {
          await vi.advanceTimersByTimeAsync(cooldownMilliseconds)
          await flushEffects()
        }

        observer.callback(
          [
            {
              target: observedSentinel,
              isIntersecting: true,
            } as IntersectionObserverEntry,
          ],
          observer as unknown as IntersectionObserver,
        )
        await flushEffects()

        expect(loadFeed).toHaveBeenCalledTimes(1)
        expect(requestedCursors).toEqual(['page-2'])

        const retry = retryButton()
        if (!retry) throw new Error('Missing manual retry button')
        expect(retry.disabled).toBe(false)
        retry.click()
        await flushEffects()

        expect(loadFeed).toHaveBeenCalledTimes(2)
        expect(requestedCursors).toEqual(['page-2', 'page-2'])
      },
    )

    it('clears the old cooldown when the feed identity changes', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const requestedCursors: Array<string | undefined> = []
      const { props, loadFeed } = await mountFeed(
        [feedPost('at://a/1')],
        { listing: 'discover', sort: 'hot', cursor: 'a-page-2' },
        async (params) => {
          requestedCursors.push(params.cursor)
          if (requestedCursors.length === 1) throw discoverUnavailable(30)
          return { feed: [feedPost('at://b/2')] }
        },
      )

      fireSentinel()
      await flushEffects()
      expect(retryButton()?.disabled).toBe(true)

      props.posts = [feedPost('at://b/1')]
      props.params = {
        listing: 'discover',
        sort: 'hot',
        cursor: 'b-page-2',
      }
      client.flushSync()
      await flushEffects()

      expect(retryButton()).toBeUndefined()
      expect(sentinelObserver()).toBeDefined()
      fireSentinel()
      await flushEffects()

      expect(loadFeed).toHaveBeenCalledTimes(2)
      expect(requestedCursors).toEqual(['a-page-2', 'b-page-2'])
      expect(props.posts.map((post) => post.post.uri)).toEqual([
        'at://b/1',
        'at://b/2',
      ])
    })

    it('discards a recovery rejection after a feed switch without installing its cooldown', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const recovery = deferred<FeedPage>()
      const requestedCursors: Array<string | undefined> = []
      const { props, loadFeed } = await mountFeed(
        [feedPost('at://a/1')],
        { listing: 'discover', sort: 'hot', cursor: 'a-expired' },
        async (requestParams) => {
          requestedCursors.push(requestParams.cursor)
          if (requestedCursors.length === 1) {
            throw new XrpcError(400, 'InvalidCursor', 'cursor expired')
          }
          return recovery.promise
        },
      )

      fireSentinel()
      await flushEffects()
      expect(loadFeed).toHaveBeenCalledTimes(2)

      const feedB = [feedPost('at://b/1')]
      props.posts = feedB
      props.params = {
        listing: 'discover',
        sort: 'hot',
        cursor: 'b-page-2',
      }
      client.flushSync()
      const baselineTimerCount = vi.getTimerCount()

      recovery.reject(discoverUnavailable(30))
      await flushEffects()

      expect(vi.getTimerCount()).toBe(baselineTimerCount)
      expect(props.posts).toBe(feedB)
      expect(props.params.cursor).toBe('b-page-2')
      expect(retryButton()).toBeUndefined()
      expect(sentinelObserver()).toBeDefined()
    })

    it('clears its cooldown timer when unmounted', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const posts = [feedPost('at://post/existing')]
      const { props, loadFeed } = await mountFeed(
        posts,
        { listing: 'discover', sort: 'hot', cursor: 'page-2' },
        async () => {
          throw discoverUnavailable(30)
        },
      )
      const baselineTimerCount = vi.getTimerCount()

      fireSentinel()
      await flushEffects()
      expect(retryButton()?.disabled).toBe(true)
      expect(vi.getTimerCount()).toBe(baselineTimerCount + 1)

      client.unmount(mounted, { outro: false })
      mounted = undefined
      expect(vi.getTimerCount()).toBe(baselineTimerCount)

      await vi.advanceTimersByTimeAsync(30_000)
      await Promise.resolve()
      expect(loadFeed).toHaveBeenCalledTimes(1)
      expect(props.posts).toBe(posts)
      expect(props.params.cursor).toBe('page-2')
      expect(target.textContent).toBe('')
    })

    it.each(['original pagination', 'InvalidCursor recovery'] as const)(
      'ignores DiscoverUnavailable when %s rejects after unmount',
      async (pendingStage) => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const pending = deferred<FeedPage>()
        const requestedCursors: Array<string | undefined> = []
        const posts = [feedPost('at://post/existing')]
        const { props, loadFeed } = await mountFeed(
          posts,
          {
            listing: 'discover',
            sort: 'hot',
            cursor:
              pendingStage === 'InvalidCursor recovery'
                ? 'expired-page-2'
                : 'page-2',
          },
          async (requestParams) => {
            requestedCursors.push(requestParams.cursor)
            if (
              pendingStage === 'InvalidCursor recovery' &&
              requestedCursors.length === 1
            ) {
              throw new XrpcError(400, 'InvalidCursor', 'cursor expired')
            }
            return pending.promise
          },
        )

        fireSentinel()
        await flushEffects()
        const expectedCalls = pendingStage === 'InvalidCursor recovery' ? 2 : 1
        expect(loadFeed).toHaveBeenCalledTimes(expectedCalls)

        client.unmount(mounted, { outro: false })
        mounted = undefined
        const baselineTimerCount = vi.getTimerCount()
        const mutations: MutationRecord[] = []
        const mutationObserver = new MutationObserver((records) => {
          mutations.push(...records)
        })
        mutationObserver.observe(target, {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        })

        pending.reject(discoverUnavailable(30))
        await flushEffects()

        expect(vi.getTimerCount()).toBe(baselineTimerCount)
        expect(target.textContent).toBe('')
        expect(mutations).toEqual([])
        expect(loadFeed).toHaveBeenCalledTimes(expectedCalls)

        await vi.advanceTimersByTimeAsync(30_000)
        await flushEffects()
        expect(target.textContent).toBe('')
        expect(mutations).toEqual([])
        expect(loadFeed).toHaveBeenCalledTimes(expectedCalls)
        expect(props.posts.map((post) => post.post.uri)).toEqual([
          'at://post/existing',
        ])
        mutationObserver.disconnect()
      },
    )
  })
})
