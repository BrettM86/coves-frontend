// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerSession } from '$lib/app/state/auth.svelte'
import { XrpcError } from '$lib/api/coves/xrpc'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))

const state = vi.hoisted(() => ({
  api: {
    getDiscover: vi.fn(),
    getTimeline: vi.fn(),
  },
  goto: vi.fn().mockResolvedValue(undefined),
  page: {
    url: new URL('https://coves.test/?type=discover&sort=hot'),
  },
  settings: {
    defaultSort: { feed: 'discover', sort: 'hot', timeframe: 'all' },
    infiniteScroll: false,
    posts: { compactFeatured: false, noVirtualize: true },
    view: 'card',
  },
}))

vi.mock('$app/navigation', () => ({ goto: state.goto }))
vi.mock('$app/state', () => ({ page: state.page }))
vi.mock('$lib/api/client.svelte', () => ({ coves: () => state.api }))
vi.mock('$lib/app/state/settings.svelte', () => ({ settings: state.settings }))
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

vi.mock('$lib/feature/filter/FeedTabs.svelte', () => ({ default: () => {} }))
vi.mock('$lib/feature/filter/SortMenu.svelte', () => ({ default: () => {} }))
vi.mock('$lib/feature/filter/ViewSelect.svelte', () => ({ default: () => {} }))
vi.mock('$lib/ui/generic/Skeleton.svelte', () => ({ default: () => {} }))
vi.mock('$lib/ui/info/Placeholder.svelte', () => ({ default: () => {} }))
vi.mock('$lib/ui/layout', () => ({
  Header: () => {},
  Pageination: () => {},
}))
vi.mock('$lib/ui/kit/icon', () => ({
  Archive: {},
  ChevronsUp: {},
  ExternalLink: {},
  Icon: () => {},
  Plus: {},
  TriangleAlert: {},
}))
vi.mock('$lib/ui/kit', async () => ({
  Button: (await import('./HomePageButton.test.svelte')).default,
  Expandable: () => {},
  Material: () => {},
  Spinner: () => {},
}))
vi.mock('$lib/feature/post', async () => ({
  Post: (await import('./HomePagePost.test.svelte')).default,
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

interface FeedPage {
  feed: Array<{ post: { uri: string } }>
  cursor?: string
}

interface SvelteClient {
  mount: (
    component: unknown,
    options: { target: Element; props: unknown; intro?: boolean },
  ) => unknown
  unmount: (component: unknown, options?: { outro?: boolean }) => void
  flushSync: (fn?: () => void) => void
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
      instance: 'https://coves.test',
    },
  }) as ServerSession

const feedPage = (viewer: string, cursor?: string): FeedPage => ({
  feed: [{ post: { uri: `at://did:plc:${viewer}/post/1` } }],
  cursor,
})

let client: SvelteClient
let mounted: unknown
let target: HTMLDivElement

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds: ReadonlyArray<number> = []

  constructor(
    _callback: IntersectionObserverCallback,
    _options?: IntersectionObserverInit,
  ) {}

  disconnect(): void {}
  observe(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  unobserve(): void {}
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

beforeEach(async () => {
  const { feeds } = await import('$lib/feature/feeds/feed.svelte')
  const { profile } = await import('$lib/app/state/auth.svelte')
  feeds.clear()
  profile.syncFromServer(undefined)
  state.api.getDiscover.mockReset()
  state.api.getTimeline.mockReset()
  state.goto.mockReset().mockResolvedValue(undefined)
  state.page.url = new URL('https://coves.test/?type=discover&sort=hot')
  state.settings.infiniteScroll = false
  state.settings.posts.noVirtualize = true
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  Object.assign(Element.prototype, {
    animate: () => new FakeAnimation(),
    getAnimations: () => [],
  })
  client = (await import('svelte')) as unknown as SvelteClient
  target = document.createElement('div')
  document.body.appendChild(target)
  client.flushSync()
})

afterEach(async () => {
  if (mounted) client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  const { feeds } = await import('$lib/feature/feeds/feed.svelte')
  const { profile } = await import('$lib/app/state/auth.svelte')
  feeds.clear()
  profile.syncFromServer(undefined)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function loadArgs(
  url = state.page.url,
): Parameters<typeof import('./+page').load>[0] {
  return {
    url,
    fetch: vi.fn() as unknown as typeof globalThis.fetch,
    route: { id: '/' },
  } as Parameters<typeof import('./+page').load>[0]
}

async function mountHome(
  data: Awaited<ReturnType<typeof import('./+page').load>>,
) {
  const HomePage = (await import('./+page.svelte')).default
  mounted = client.mount(HomePage, { target, props: { data }, intro: false })
  client.flushSync()
}

async function flushEffects(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index++) {
    await Promise.resolve()
    client.flushSync()
  }
}

const renderedPostUris = (): string[] =>
  [...target.querySelectorAll<HTMLElement>('[data-testid="home-page-post"]')].map(
    (post) => post.dataset.postUri ?? '',
  )

const retryButton = (): HTMLButtonElement | undefined =>
  [...target.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'message.retry',
  )

describe('home route viewer ownership', () => {
  it.each([
    ['viewer B', 'viewer-b', 'viewer-b'],
    ['an anonymous viewer', undefined, 'anonymous'],
  ] as const)(
    'replaces a pending viewer-A initial page in the real virtual feed after identity becomes %s',
    async (_case, nextViewer, expectedViewer) => {
      const { profile } = await import('$lib/app/state/auth.svelte')
      profile.syncFromServer(viewerSession('viewer-a'))
      state.settings.infiniteScroll = true
      state.settings.posts.noVirtualize = false
      const oldViewerPage = deferred<FeedPage>()
      const currentViewerPage = deferred<FeedPage>()
      state.api.getDiscover
        .mockReturnValueOnce(oldViewerPage.promise)
        .mockReturnValueOnce(currentViewerPage.promise)

      const { load } = await import('./+page')
      const data = await load(loadArgs())
      await mountHome(data)
      await flushEffects()
      expect(state.api.getDiscover).toHaveBeenCalledTimes(1)

      profile.syncFromServer(
        nextViewer === undefined ? undefined : viewerSession(nextViewer),
      )
      await flushEffects()

      expect(renderedPostUris()).toEqual([])

      oldViewerPage.resolve(feedPage('viewer-a', 'viewer-a-page-2'))
      await flushEffects()
      expect(renderedPostUris()).toEqual([])
      expect(state.api.getDiscover).toHaveBeenCalledTimes(2)
      expect(state.api.getDiscover.mock.calls[1]?.[0]).toMatchObject({
        cursor: undefined,
      })

      currentViewerPage.resolve(
        feedPage(expectedViewer, `${expectedViewer}-page-2`),
      )
      await flushEffects()
      expect(renderedPostUris()).toEqual([
        `at://did:plc:${expectedViewer}/post/1`,
      ])
    },
  )

  it('removes a non-virtual feed and starts current-viewer page one immediately on identity change', async () => {
    const { profile } = await import('$lib/app/state/auth.svelte')
    profile.syncFromServer(viewerSession('viewer-a'))
    state.api.getDiscover.mockResolvedValueOnce(
      feedPage('viewer-a', 'viewer-a-page-2'),
    )
    const currentViewerPage = deferred<FeedPage>()

    const { load } = await import('./+page')
    const data = await load(loadArgs())
    await mountHome(data)
    await flushEffects()
    expect(renderedPostUris()).toEqual(['at://did:plc:viewer-a/post/1'])

    state.api.getDiscover.mockReturnValueOnce(currentViewerPage.promise)
    profile.syncFromServer(viewerSession('viewer-b'))
    await flushEffects()

    expect.soft(renderedPostUris()).toEqual([])
    expect.soft(state.api.getDiscover).toHaveBeenCalledTimes(2)
    expect.soft(state.api.getDiscover.mock.calls[1]?.[0]).toMatchObject({
      cursor: undefined,
    })

    currentViewerPage.resolve(feedPage('viewer-b', 'viewer-b-page-2'))
    await flushEffects()
    expect(renderedPostUris()).toEqual(['at://did:plc:viewer-b/post/1'])
  })

  it.each([
    ['viewer B', 'viewer-b', 'viewer-b'],
    ['an anonymous viewer', undefined, 'anonymous'],
  ] as const)(
    'does not publish a late viewer-A route result after identity becomes %s',
    async (_case, nextViewer, expectedViewer) => {
      const { profile } = await import('$lib/app/state/auth.svelte')
      profile.syncFromServer(viewerSession('viewer-a'))
      const oldViewerPage = deferred<FeedPage>()
      const currentViewerPage = deferred<FeedPage>()
      state.api.getDiscover
        .mockReturnValueOnce(oldViewerPage.promise)
        .mockReturnValueOnce(currentViewerPage.promise)

      const { load } = await import('./+page')
      const data = await load(loadArgs())
      await mountHome(data)
      await flushEffects()
      expect(state.api.getDiscover).toHaveBeenCalledTimes(1)

      profile.syncFromServer(
        nextViewer === undefined ? undefined : viewerSession(nextViewer),
      )
      await flushEffects()

      expect.soft(renderedPostUris()).toEqual([])
      expect.soft(state.api.getDiscover).toHaveBeenCalledTimes(2)
      expect.soft(state.api.getDiscover.mock.calls[1]?.[0]).toMatchObject({
        cursor: undefined,
      })

      oldViewerPage.resolve(feedPage('viewer-a', 'viewer-a-page-2'))
      await flushEffects()
      expect(renderedPostUris()).toEqual([])

      currentViewerPage.resolve(
        feedPage(expectedViewer, `${expectedViewer}-page-2`),
      )
      await flushEffects()
      expect(renderedPostUris()).toEqual([
        `at://did:plc:${expectedViewer}/post/1`,
      ])
    },
  )
})

describe('home route stale-cursor Retry', () => {
  it('keeps the recovered page-one target through Retry-After cooldown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T12:00:00.000Z'))
    state.page.url = new URL(
      'https://coves.test/?type=discover&sort=hot&timeframe=week&cursor=expired-page-2',
    )
    const capacityResponse = deferred<FeedPage>()
    state.api.getDiscover
      .mockRejectedValueOnce(
        new XrpcError(400, 'InvalidCursor', 'cursor expired'),
      )
      .mockReturnValueOnce(capacityResponse.promise)

    const { load } = await import('./+page')
    const data = await load(loadArgs())
    await mountHome(data)
    await flushEffects()
    expect(
      state.api.getDiscover.mock.calls.map((call) => call[0]?.cursor),
    ).toEqual(['expired-page-2', undefined])

    capacityResponse.reject(
      new XrpcError(503, 'DiscoverUnavailable', 'Discover is recovering', 30),
    )
    await flushEffects()

    let retry = retryButton()
    if (!retry) throw new Error('Missing route Retry button')
    expect.soft(retry.disabled).toBe(true)
    retry.click()
    expect.soft(state.goto).not.toHaveBeenCalled()
    state.goto.mockClear()

    await vi.advanceTimersByTimeAsync(29_999)
    await flushEffects()
    retry = retryButton()
    if (!retry) throw new Error('Missing route Retry before deadline')
    expect.soft(retry.disabled).toBe(true)
    expect.soft(state.goto).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await flushEffects()
    retry = retryButton()
    if (!retry) throw new Error('Missing route Retry at deadline')
    expect(retry.disabled).toBe(false)
    retry.click()

    expect(state.goto).toHaveBeenCalledTimes(1)
    const retryTarget = new URL(String(state.goto.mock.calls[0]?.[0]))
    expect(retryTarget.searchParams.get('cursor')).toBeNull()
    expect(retryTarget.searchParams.get('type')).toBe('discover')
    expect(retryTarget.searchParams.get('sort')).toBe('hot')
    expect(retryTarget.searchParams.get('timeframe')).toBe('week')
    expect(state.goto.mock.calls[0]?.[1]).toEqual({ invalidateAll: true })
  })
})
