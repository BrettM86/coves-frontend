// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeedViewPost, FeedPaginationParams } from '$lib/api/coves/types'

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

// The Post subtree is irrelevant to pagination and would need a fully-formed
// record per fixture; a no-op component is a valid Svelte 5 component.
vi.mock('..', () => ({ Post: () => {} }) as unknown as typeof import('..'))

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

/** Minimal FeedViewPost: only `post.uri` and `reason` are read by the feed. */
const feedPost = (uri: string): FeedViewPost =>
  ({ post: { uri } }) as unknown as FeedViewPost

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
})

/** More pages than any test legitimately loads. */
const RUNAWAY_PAGES = 12

interface Harness {
  /** Live props object; assigning to `posts` is a feed switch. */
  props: { posts: FeedViewPost[]; params: FeedPaginationParams }
  loadFeed: ReturnType<typeof vi.fn>
}

const mountFeed = async (
  posts: FeedViewPost[],
  params: FeedPaginationParams,
  loadFeed: (params: FeedPaginationParams) => Promise<FeedPage>,
): Promise<Harness> => {
  const { SvelteMap } = await import('svelte/reactivity')
  const VirtualFeed = (await import('./VirtualFeed.svelte')).default

  // A runaway pagination loop is one of the bugs under test, and left
  // unbounded it hangs the worker instead of failing. Past the cap every page
  // is empty, which stops the component and leaves the call count — which
  // every test asserts — as the visible failure.
  const spy = vi.fn(async (p: FeedPaginationParams): Promise<FeedPage> => {
    if (spy.mock.calls.length > RUNAWAY_PAGES) return { feed: [] }
    return loadFeed(p)
  })
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
    get params(): FeedPaginationParams {
      return values.get('params') as FeedPaginationParams
    },
    set params(value: FeedPaginationParams) {
      values.set('params', value)
    },
    loadFeed: spy,
  }

  target = document.createElement('div')
  document.body.appendChild(target)
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
})
