// @vitest-environment jsdom
import type { AfterNavigate, BeforeNavigate } from '@sveltejs/kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationListSnapshot } from '$lib/feature/notification/list.svelte'
import type { DID } from '$lib/types/atproto'
import {
  alice,
  createNotificationFetch,
  createSessionActions,
  json,
  session,
  settleWithFakeTimers,
} from '$lib/feature/notification/notification-test-harness'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$lib/app/state/instance/env', () => ({
  DEFAULT_INSTANCE_URL: 'http://localhost:8081',
  LINKED_INSTANCE_URL: undefined,
}))
/** Every `afterNavigate`/`beforeNavigate` callback the mounted layout tree registered. */
const navigation = vi.hoisted(() => ({
  afterNavigate: [] as ((navigation: AfterNavigate) => void)[],
  beforeNavigate: [] as ((navigation: BeforeNavigate) => void)[],
}))
vi.mock('$app/navigation', () => ({
  invalidate: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
  goto: vi.fn(),
  afterNavigate: vi.fn((callback: (navigation: AfterNavigate) => void) => {
    navigation.afterNavigate.push(callback)
  }),
  beforeNavigate: vi.fn((callback: (navigation: BeforeNavigate) => void) => {
    navigation.beforeNavigate.push(callback)
  }),
  onNavigate: vi.fn(),
  preloadData: vi.fn(),
}))
const appState = vi.hoisted(() => ({
  page: {
    url: new URL('http://localhost/'),
    data: {} as Record<string, unknown>,
    params: {},
    route: { id: '/' },
    status: 200,
    state: {},
    error: null,
  },
}))
vi.mock('$app/state', () => ({
  page: appState.page,
  navigating: { to: null },
  updated: { current: false, check: async () => false },
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
// SessionRecovery adds its own `visibilitychange` and `focus` listeners, which
// would be counted with the unread store's; it is outside this wiring.
vi.mock('$lib/feature/shell/SessionRecovery.svelte', () => ({
  default: () => {},
}))
// Observed, not exercised: log.test.ts owns what the helper writes.
vi.mock('$lib/feature/notification/log', () => ({
  logNotificationFailure: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Harness
//
// The unread store is an app-lifetime singleton, so every test resets the
// module registry and imports svelte, the profile, the store and the layout
// afresh. Within one test the layout's mounts share that one store instance.
// The layout never stops the store, so each test stops it through the real
// stop its first `start()` returned.
// ---------------------------------------------------------------------------

const getUnreadCountPath =
  /\/xrpc\/social\.coves\.notification\.getUnreadCount$/

let svelte: typeof import('svelte')
let profile: (typeof import('$lib/app/state/auth.svelte'))['profile']
let unreadNotifications: (typeof import('$lib/feature/notification/unread.svelte'))['unreadNotifications']
let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
/** Every profile instance imported in this file; each one's effect is disposed. */
const profiles: (typeof profile)[] = []
/** What every `start()` call returned; only the first is the real stop. */
let stops: (() => void)[]

const notificationFetch = createNotificationFetch()
const requests = notificationFetch.requests
const fetchSpy = vi.fn<typeof fetch>()

/** The getUnreadCount requests sent so far. */
const unreadCountRequests = () =>
  requests.filter((request) => getUnreadCountPath.test(request.path))

async function importInstances() {
  // `vi.resetModules()` keeps a mock factory's cached result; re-register the
  // svelte mocks so the components and the test share one runtime.
  vi.doMock('svelte', () => svelteClientEntry('src/index-client.js'))
  vi.doMock('svelte/reactivity', () =>
    svelteClientEntry('src/reactivity/index-client.js'),
  )
  svelte = await import('svelte')
  profile = (await import('$lib/app/state/auth.svelte')).profile
  profiles.push(profile)
  unreadNotifications = (
    await import('$lib/feature/notification/unread.svelte')
  ).unreadNotifications
  const start = unreadNotifications.start
  vi.spyOn(unreadNotifications, 'start').mockImplementation(() => {
    const stop = start()
    stops.push(stop)
    return stop
  })
  const { loadTranslations, locale } = await import('$lib/app/state/i18n')
  await loadTranslations('en')
  locale.set('en')
}

async function mountLayout() {
  const Layout = (await import('./+layout.svelte')).default
  mounted = svelte.mount(Layout, { target, intro: false })
  svelte.flushSync()
}

async function unmountLayout() {
  if (mounted) await svelte.unmount(mounted, { outro: false })
  mounted = undefined
  svelte.flushSync()
}

const settle = () =>
  settleWithFakeTimers(svelte, (ms) => vi.advanceTimersByTimeAsync(ms))

/** Runs every captured `afterNavigate` callback for a link click from `/` to `pathname`. */
function navigateTo(pathname: string) {
  const to = new URL(`http://localhost${pathname}`)
  for (const callback of navigation.afterNavigate) {
    callback({
      from: {
        url: new URL('http://localhost/'),
        params: {},
        route: { id: '/' },
      },
      to: { url: to, params: {}, route: { id: pathname } },
      type: 'link',
      willUnload: false,
      complete: Promise.resolve(),
    } as AfterNavigate)
  }
  svelte.flushSync()
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  vi.stubGlobal('__VERSION__', 'test')
  fetchSpy.mockReset().mockImplementation(notificationFetch.handle)
  vi.stubGlobal('fetch', fetchSpy)
  // jsdom has no matchMedia; the layout's theme reads the colour scheme.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  // Nor IntersectionObserver; this one never reports, so the sidebar's
  // lazy community load stays off.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    },
  )
  notificationFetch.reset()
  // Every getUnreadCount is answered as sent, so each request has resolved
  // before the next trigger.
  notificationFetch.answer = (request) =>
    request.resolve(json(200, { count: 3 }))
  navigation.afterNavigate.length = 0
  navigation.beforeNavigate.length = 0
  stops = []
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  })
  appState.page.url = new URL('http://localhost/')
  appState.page.data = {
    session: session(alice, 'g1'),
    sessionGeneration: 'g1',
    sessionExpired: false,
  }
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  })
  await importInstances()
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  await unmountLayout()
  for (const stop of stops) stop()
  svelte.flushSync()
  for (const instance of profiles.splice(0)) instance.mainEffect()
  target.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  expect(notificationFetch.unexpectedUrls).toEqual([])
})

// ---------------------------------------------------------------------------
// Behaviors
// ---------------------------------------------------------------------------

describe('root layout unread notification wiring', () => {
  it('starts one unread store, with one 30 s timer and one listener set, across an unmount and a second mount', async () => {
    // Active 30 s intervals: registered and not yet cleared.
    const activeRefreshTimers = new Set<unknown>()
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const windowListeners = vi.spyOn(window, 'addEventListener')
    const documentListeners = vi.spyOn(document, 'addEventListener')

    await mountLayout()
    await settle()

    expect(unreadCountRequests()).toHaveLength(1)

    await unmountLayout()
    await mountLayout()
    await settle()

    expect(unreadCountRequests()).toHaveLength(1)
    setIntervalSpy.mock.calls.forEach(([, delay], index) => {
      if (delay === 30_000)
        activeRefreshTimers.add(setIntervalSpy.mock.results[index]?.value)
    })
    for (const [id] of clearIntervalSpy.mock.calls)
      activeRefreshTimers.delete(id)
    expect(activeRefreshTimers.size).toBe(1)
    expect(
      windowListeners.mock.calls.filter(([type]) => type === 'focus'),
    ).toHaveLength(1)
    expect(
      documentListeners.mock.calls.filter(
        ([type]) => type === 'visibilitychange',
      ),
    ).toHaveLength(1)
  })

  it('forwards each client navigation pathname to the unread store', async () => {
    const noteNavigation = vi.spyOn(unreadNotifications, 'noteNavigation')

    await mountLayout()
    await settle()

    navigateTo('/notifications')
    await settle()

    expect(noteNavigation).toHaveBeenLastCalledWith('/notifications')
    expect(unreadCountRequests()).toHaveLength(2)

    navigateTo('/settings/notifications')
    await settle()

    expect(noteNavigation).toHaveBeenLastCalledWith('/settings/notifications')
    expect(unreadCountRequests()).toHaveLength(2)
  })
})

describe('root layout notification list return wiring', () => {
  it('notes each navigation on the return store and starts its owner watcher', async () => {
    const { notificationListReturn } =
      await import('$lib/feature/notification/return.svelte')
    const { signIn } = createSessionActions(
      () => ({ profile, svelte }),
      () => 'g2',
    )
    const threadPath =
      '/c/gardening.local.coves.dev/post/did%3Aplc%3Aviewer7f3kq2/3kpostpr1'
    const saved: NotificationListSnapshot = {
      owner: alice.did as DID,
      rows: [],
      cursor: 'c2',
      seenAt: '2026-10-12T09:15:30.123456789Z',
      requestedCursors: ['c1'],
      recoveryArmed: true,
      revealed: [],
      scrollY: 1200,
      targetPath: threadPath,
    }
    /** Runs every captured `beforeNavigate` callback for `type` from `from` to `to`. */
    const deliver = (
      type: BeforeNavigate['type'],
      from: string,
      to: string,
    ) => {
      for (const callback of navigation.beforeNavigate)
        callback({
          type,
          from: {
            url: new URL(from, 'http://localhost'),
            params: {},
            route: { id: null },
          },
          to: {
            url: new URL(to, 'http://localhost'),
            params: {},
            route: { id: null },
          },
          willUnload: false,
          cancel() {},
        } as BeforeNavigate)
    }

    await mountLayout()
    await settle()
    expect(profile.isAuthenticated, 'precondition: alice signed in').toBe(true)

    notificationListReturn.save(saved)
    deliver('link', '/notifications', threadPath)
    deliver('popstate', threadPath, '/notifications')

    expect(
      notificationListReturn.take(),
      'the layout marked the save for the return',
    ).toEqual(saved)

    // The row's loader redirects to the handle form; Kit lands there with
    // no second beforeNavigate, and the layout's afterNavigate retargets.
    const canonicalPath = threadPath.replace(
      'did%3Aplc%3Aviewer7f3kq2',
      'viewer.local.coves.dev',
    )
    const postRouteId = '/c/[handle=handle]/post/[owner=actor]/[rkey]'
    notificationListReturn.save(saved)
    for (const callback of navigation.beforeNavigate)
      callback({
        type: 'link',
        from: {
          url: new URL('/notifications', 'http://localhost'),
          params: {},
          route: { id: '/notifications' },
        },
        to: {
          url: new URL(threadPath, 'http://localhost'),
          params: {},
          route: { id: postRouteId },
        },
        willUnload: false,
        cancel() {},
      } as BeforeNavigate)
    for (const callback of navigation.afterNavigate)
      callback({
        type: 'link',
        from: {
          url: new URL('/notifications', 'http://localhost'),
          params: {},
          route: { id: '/notifications' },
        },
        to: {
          url: new URL(canonicalPath, 'http://localhost'),
          params: {},
          route: { id: postRouteId },
        },
        willUnload: false,
        complete: Promise.resolve(),
      } as AfterNavigate)
    deliver('goto', canonicalPath, `${canonicalPath}?sort=new`)
    deliver('link', canonicalPath, '/notifications')

    expect(
      notificationListReturn.take(),
      "the layout's afterNavigate moved the save to the redirected thread",
    ).toEqual({ ...saved, targetPath: canonicalPath })

    notificationListReturn.save(saved)
    deliver('link', '/notifications', threadPath)
    await profile.remove(profile.current.id)
    svelte.flushSync()
    expect(profile.isAuthenticated, 'precondition: signed out').toBe(false)
    signIn(alice)
    await settle()
    deliver('popstate', threadPath, '/notifications')

    expect(
      notificationListReturn.take(),
      "the layout's watcher dropped the save on logout",
    ).toBeUndefined()
  })
})
