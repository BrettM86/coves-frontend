// @vitest-environment jsdom
import { get } from 'svelte/store'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  alice,
  bob,
  createGenerationFactory,
  createNotificationFetch,
  createSessionActions,
  json,
  session,
  settle,
  settleWithFakeTimers,
  storedProfileData,
  type Account,
  type NotificationRequest,
} from './notification-test-harness'
import type {
  AcceptedUnreadRefresh,
  UnreadNotificationStore,
} from './unread.svelte'

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
vi.mock('$app/navigation', () => ({
  invalidate: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
}))
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/'),
    data: {},
    params: {},
    route: { id: null },
    status: 200,
    state: {},
  },
  navigating: { to: null },
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
// Observed, not exercised: log.test.ts owns what the helper writes.
const notificationLog = vi.hoisted(() => ({
  logNotificationFailure: vi.fn<(nsid: string, error: unknown) => void>(),
}))
vi.mock('$lib/feature/notification/log', () => notificationLog)

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const nextGeneration = createGenerationFactory('unread-generation')

let svelte: typeof import('svelte')
let profile: (typeof import('$lib/app/state/auth.svelte'))['profile']
let createUnreadNotifications: (typeof import('./unread.svelte'))['createUnreadNotifications']
let toasts: (typeof import('$lib/ui/kit/toast/toasts'))['toasts']
let store: UnreadNotificationStore | undefined
let stop: (() => void) | undefined
/** Every profile instance imported in this file; each one's effect is disposed. */
const profiles = new Set<typeof profile>()

const notificationFetch = createNotificationFetch()
const requests = notificationFetch.requests
const { signIn, expireAndReviveSameGeneration } = createSessionActions(
  () => ({ profile, svelte }),
  nextGeneration,
)

const fetchSpy = vi.fn<typeof fetch>()

const getUnreadCountNsid = 'social.coves.notification.getUnreadCount'
const getUnreadCountPath =
  /\/xrpc\/social\.coves\.notification\.getUnreadCount$/

/** Imports svelte, the profile, the toasts and the store factory from the current module registry. */
async function importInstances() {
  svelte = await import('svelte')
  profile = (await import('$lib/app/state/auth.svelte')).profile
  profiles.add(profile)
  toasts = (await import('$lib/ui/kit/toast/toasts')).toasts
  createUnreadNotifications = (await import('./unread.svelte'))
    .createUnreadNotifications
}

function startStore(): UnreadNotificationStore {
  const created = createUnreadNotifications()
  store = created
  stop = created.start()
  svelte.flushSync()
  return created
}

/** Signs `account` in (under `generation`), starts the store and answers its adoption GET with `count`. */
async function countUnder(
  account: Account,
  count: number,
  generation = nextGeneration(),
): Promise<UnreadNotificationStore> {
  signIn(account, generation)
  notificationFetch.answer = (request) => request.resolve(json(200, { count }))
  const unread = startStore()
  await settle(svelte)
  notificationFetch.answer = undefined
  expect(unread.count, `the adoption GET set the count to ${count}`).toBe(count)
  return unread
}

/** Signs `account` in (under `generation`), starts the store and confirms its adoption GET is held. */
async function adoptionInFlight(
  account: Account,
  generation = nextGeneration(),
): Promise<UnreadNotificationStore> {
  signIn(account, generation)
  const unread = startStore()
  await settle(svelte)
  expect(
    requests,
    `${account.handle}'s adoption GET is in flight`,
  ).toHaveLength(1)
  return unread
}

/**
 * Key changes that leave alice's GET (sent under `generation`) in flight under
 * the old epoch; each adopts a new authenticated key and returns it, built
 * from the test's own literals.
 */
const oldEpochTransitions = [
  {
    transition: 'another account signs in',
    adopt: (): string => {
      const generation = signIn(bob)
      return `${bob.did}|${generation}`
    },
  },
  {
    transition: 'the session expires and is revived with the same generation',
    adopt: (generation: string): string => {
      expireAndReviveSameGeneration(alice, generation)
      return `${alice.did}|${generation}`
    },
  },
]

/** Sets what `document.visibilityState` reports, without an event. */
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  })
}

/** The document becomes `state` and reports it with `visibilitychange`. */
function becomeVisibility(state: DocumentVisibilityState) {
  setVisibility(state)
  document.dispatchEvent(new Event('visibilitychange'))
}

/**
 * Fakes both timer families, so a 30 s timer is driven by the fake clock
 * whether it is an interval or a chained timeout.
 */
function useFakeTimerFunctions() {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  })
}

const settleTimers = () =>
  settleWithFakeTimers(svelte, (ms) => vi.advanceTimersByTimeAsync(ms))

/** Moves the fake clock `ms` forward, then settles. */
async function elapse(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await settleTimers()
}

/** Every GET getUnreadCount the fetch spy has seen, in send order. */
const unreadGets = () =>
  requests.filter(
    (request) =>
      request.method === 'GET' && getUnreadCountPath.test(request.path),
  )

beforeEach(async () => {
  localStorage.clear()
  setVisibility('visible')
  vi.stubGlobal('__VERSION__', 'test')
  fetchSpy.mockReset().mockImplementation(notificationFetch.handle)
  vi.stubGlobal('fetch', fetchSpy)
  notificationLog.logNotificationFailure.mockReset()
  notificationFetch.reset()
  store = undefined
  stop = undefined
  await importInstances()
  toasts.set([])
  profile.syncFromServer(undefined)
  svelte.flushSync()
})

afterEach(() => {
  stop?.()
  svelte.flushSync()
  vi.useRealTimers()
  // Drops the own property so jsdom's prototype getter answers again.
  Reflect.deleteProperty(document, 'visibilityState')
  expect(notificationFetch.unexpectedUrls).toEqual([])
})

afterAll(() => {
  for (const instance of profiles) instance.mainEffect()
})

// ---------------------------------------------------------------------------
// Adoption
// ---------------------------------------------------------------------------

describe('unread notification count adoption', () => {
  it.each([
    {
      adoption: 'the store is started while signed in',
      arrange: async () => {
        signIn(alice)
        startStore()
      },
    },
    {
      adoption: 'the login is synced from the server after start',
      arrange: async () => {
        startStore()
        await settle(svelte)
        signIn(alice)
      },
    },
    {
      adoption:
        'the profile was restored from storage before the session sync (hard load)',
      arrange: async () => {
        localStorage.setItem('profileData', storedProfileData(alice))
        vi.resetModules()
        // `vi.resetModules()` keeps a mock factory's cached result, so the
        // hoisted svelte mocks would hand back the previous runtime while
        // fresh modules load a new `svelte/internal/client`. Re-register them.
        vi.doMock('svelte', () => svelteClientEntry('src/index-client.js'))
        vi.doMock('svelte/reactivity', () =>
          svelteClientEntry('src/reactivity/index-client.js'),
        )
        await importInstances()
        expect(profile.isAuthenticated, 'restored signed in').toBe(true)
        expect(profile.sessionGeneration).toBeUndefined()

        const unread = startStore()
        unread.refresh()
        await settle(svelte)
        expect(requests, 'nothing is sent before the session sync').toEqual([])

        // What the root layout's effect does once its data arrives.
        profile.syncFromServer(session(alice, nextGeneration()))
        svelte.flushSync()
      },
    },
  ])(
    'sends exactly one GET getUnreadCount and takes its count when $adoption',
    async ({ arrange }) => {
      await arrange()
      await settle(svelte)

      expect(requests).toHaveLength(1)
      expect(requests[0].method).toBe('GET')
      expect(requests[0].path).toMatch(getUnreadCountPath)

      requests[0].resolve(json(200, { count: 4 }))
      await settle(svelte)

      expect(store?.count).toBe(4)
      expect(requests).toHaveLength(1)
    },
  )

  it('sends nothing and counts 0 when started signed out', async () => {
    const unread = startStore()
    await settle(svelte)

    expect(requests).toEqual([])
    expect(unread.count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Key changes
// ---------------------------------------------------------------------------

describe('unread notification count on a session key change', () => {
  it.each([
    {
      change: 'the session expires',
      transition: async () => {
        profile.expireSession(profile.sessionGeneration)
        svelte.flushSync()
      },
    },
    {
      change: 'the account logs out',
      transition: async () => {
        await profile.remove(profile.current.id)
        svelte.flushSync()
      },
    },
    {
      change: 'another account signs in and its GET is held',
      transition: async () => {
        profile.syncFromServer(session(bob, nextGeneration()))
        svelte.flushSync()
      },
    },
  ])('resets the count to 0 at once when $change', async ({ transition }) => {
    const unread = await countUnder(alice, 7)

    await transition()

    expect(unread.count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

describe('unread notification count refresh failures', () => {
  it.each([
    {
      failure: 'a network error',
      fail: (request: NotificationRequest) =>
        request.reject(new TypeError('Failed to fetch')),
    },
    {
      failure: 'a 500',
      fail: (request: NotificationRequest) =>
        request.resolve(json(500, { error: 'InternalServerError' })),
    },
    {
      failure: 'a 429',
      fail: (request: NotificationRequest) =>
        request.resolve(json(429, { error: 'RateLimitExceeded' })),
    },
    {
      failure: 'a 200 with a body that is not JSON',
      fail: (request: NotificationRequest) =>
        request.resolve(
          new Response('<html>Bad gateway</html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
        ),
    },
    {
      failure: 'a 200 whose count is not a number',
      fail: (request: NotificationRequest) =>
        request.resolve(json(200, { count: 'seven' })),
    },
    {
      failure: 'a 200 whose count is negative',
      fail: (request: NotificationRequest) =>
        request.resolve(json(200, { count: -1 })),
    },
    {
      failure: 'a 200 whose count is not a whole number',
      fail: (request: NotificationRequest) =>
        request.resolve(json(200, { count: 1.5 })),
    },
  ])(
    'keeps the count, shows no toast, logs once and releases the request after $failure',
    async ({ fail }) => {
      const unread = await countUnder(alice, 7)
      notificationFetch.answer = fail

      unread.refresh()
      await settle(svelte)

      expect(requests).toHaveLength(2)
      expect(unread.count).toBe(7)
      expect(get(toasts)).toEqual([])
      expect(
        notificationLog.logNotificationFailure.mock.calls.map(([nsid]) => nsid),
      ).toEqual([getUnreadCountNsid])

      notificationFetch.answer = undefined
      unread.refresh()
      await settle(svelte)

      expect(requests).toHaveLength(3)
      expect(requests[2].method).toBe('GET')
      expect(requests[2].path).toMatch(getUnreadCountPath)
    },
  )
})

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

describe('unread notification count start', () => {
  it('a second start() sends no second GET and its returned function does not stop the store', async () => {
    const unread = await countUnder(alice, 7)

    const secondStop = unread.start()
    svelte.flushSync()
    await settle(svelte)
    expect(requests).toHaveLength(1)

    secondStop()
    svelte.flushSync()
    signIn(bob)
    await settle(svelte)

    expect(requests).toHaveLength(2)
    expect(requests[1].method).toBe('GET')
    expect(requests[1].path).toMatch(getUnreadCountPath)
  })
})

// ---------------------------------------------------------------------------
// Not authenticated
// ---------------------------------------------------------------------------

describe('unread notification count refresh when not authenticated', () => {
  it.each([
    {
      state: 'signed out',
      arrange: () => {
        profile.syncFromServer(undefined)
        svelte.flushSync()
      },
    },
    {
      state: 'expired',
      arrange: () => {
        signIn(alice)
        profile.expireSession(profile.sessionGeneration)
        svelte.flushSync()
      },
    },
  ])('sends nothing when $state', async ({ arrange }) => {
    arrange()
    const unread = startStore()
    await settle(svelte)

    unread.refresh()
    await settle(svelte)

    expect(requests).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Single flight
// ---------------------------------------------------------------------------

describe('unread notification count single flight', () => {
  it.each([
    {
      flight: 'the adoption GET',
      arrange: async () => {
        const unread = await adoptionInFlight(alice)
        return { unread, sent: 1 }
      },
    },
    {
      flight: "B's adoption GET, after A's old GET was answered meanwhile,",
      arrange: async () => {
        const unread = await adoptionInFlight(alice)
        signIn(bob)
        await settle(svelte)
        expect(requests, "B's adoption GET is in flight").toHaveLength(2)

        requests[0].resolve(json(200, { count: 99 }))
        await settle(svelte)
        return { unread, sent: 2 }
      },
    },
    {
      flight: "B's adoption GET, after A's old GET failed meanwhile,",
      arrange: async () => {
        const unread = await adoptionInFlight(alice)
        signIn(bob)
        await settle(svelte)
        expect(requests, "B's adoption GET is in flight").toHaveLength(2)

        requests[0].resolve(json(500, { error: 'InternalServerError' }))
        await settle(svelte)
        expect(
          notificationLog.logNotificationFailure.mock.calls,
          "A's stale failure is not logged",
        ).toEqual([])
        return { unread, sent: 2 }
      },
    },
    {
      flight:
        "B's adoption GET, after refresh() was called before the adoption effect ran,",
      arrange: async () => {
        const unread = await countUnder(alice, 7)
        profile.syncFromServer(session(bob, nextGeneration()))
        unread.refresh()
        svelte.flushSync()
        await settle(svelte)
        expect(
          requests,
          'exactly one GET is sent for B after the flush',
        ).toHaveLength(2)
        expect(requests[1].method).toBe('GET')
        expect(requests[1].path).toMatch(getUnreadCountPath)
        return { unread, sent: 2 }
      },
    },
  ])(
    'absorbs refresh() while $flight is in flight and sends nothing after it settles',
    async ({ arrange }) => {
      const { unread, sent } = await arrange()

      unread.refresh()
      unread.refresh()
      unread.refresh()
      await settle(svelte)

      expect(requests).toHaveLength(sent)

      requests[sent - 1].resolve(json(200, { count: 2 }))
      await settle(svelte)

      expect(requests).toHaveLength(sent)
      expect(notificationLog.logNotificationFailure.mock.calls).toEqual([])
    },
  )
})

// ---------------------------------------------------------------------------
// Request epoch
// ---------------------------------------------------------------------------

describe.each(oldEpochTransitions)(
  'unread notification count when $transition with the old GET in flight',
  ({ adopt }) => {
    it('sends the adoption GET at once without waiting for the old one', async () => {
      const generation = nextGeneration()
      await adoptionInFlight(alice, generation)

      adopt(generation)
      await settle(svelte)

      expect(requests).toHaveLength(2)
      expect(requests[1].method).toBe('GET')
      expect(requests[1].path).toMatch(getUnreadCountPath)
    })

    it.each([
      {
        order: 'before',
        answers: [
          { response: 'old', count: 99, countAfter: 0 },
          { response: 'new', count: 3, countAfter: 3 },
        ],
      },
      {
        order: 'after',
        answers: [
          { response: 'new', count: 3, countAfter: 3 },
          { response: 'old', count: 99, countAfter: 3 },
        ],
      },
    ] as const)(
      'discards the old response and counts only from the new one when the old arrives $order the new',
      async ({ answers }) => {
        const generation = nextGeneration()
        const unread = await adoptionInFlight(alice, generation)
        adopt(generation)
        await settle(svelte)
        expect(
          requests,
          'the old and the new GET are both in flight',
        ).toHaveLength(2)
        const [oldRequest, newRequest] = requests

        for (const { response, count, countAfter } of answers) {
          const request = response === 'old' ? oldRequest : newRequest
          request.resolve(json(200, { count }))
          await settle(svelte)

          expect(unread.count, `after the ${response} response`).toBe(
            countAfter,
          )
        }
      },
    )
  },
)

// ---------------------------------------------------------------------------
// Accepted-refresh signal
// ---------------------------------------------------------------------------

describe('unread notification count accepted-refresh signal', () => {
  it.each([
    {
      accepted: 'a refresh equal to the previous count',
      count: 7,
      sequence: 2,
      arrange: async () => {
        const generation = nextGeneration()
        const unread = await countUnder(alice, 7, generation)
        unread.refresh()
        await settle(svelte)
        expect(requests, 'the refresh GET is in flight').toHaveLength(2)
        return { unread, key: `${alice.did}|${generation}` }
      },
    },
    {
      accepted: 'a refresh of 0 after a failed refresh',
      count: 0,
      sequence: 3,
      arrange: async () => {
        const generation = nextGeneration()
        const unread = await countUnder(alice, 7, generation)
        notificationFetch.answer = (request) =>
          request.resolve(json(500, { error: 'InternalServerError' }))
        unread.refresh()
        await settle(svelte)
        notificationFetch.answer = undefined
        expect(requests, 'the failed refresh was sent').toHaveLength(2)

        unread.refresh()
        await settle(svelte)
        expect(requests, 'the next refresh GET is in flight').toHaveLength(3)
        return { unread, key: `${alice.did}|${generation}` }
      },
    },
    {
      accepted: "B's adoption response, sent while A's GET was in flight,",
      count: 5,
      sequence: 2,
      arrange: async () => {
        const unread = await adoptionInFlight(alice)
        const generation = nextGeneration()
        signIn(bob, generation)
        await settle(svelte)
        expect(requests, "B's adoption GET is in flight").toHaveLength(2)
        return { unread, key: `${bob.did}|${generation}` }
      },
    },
    {
      accepted:
        "the revived session's adoption response, sent while the old GET was in flight,",
      count: 6,
      sequence: 2,
      arrange: async () => {
        const generation = nextGeneration()
        const unread = await adoptionInFlight(alice, generation)
        expireAndReviveSameGeneration(alice, generation)
        await settle(svelte)
        expect(
          requests,
          "the revived session's adoption GET is in flight",
        ).toHaveLength(2)
        return { unread, key: `${alice.did}|${generation}` }
      },
    },
  ])(
    'signals its key, sequence and count once when $accepted is accepted',
    async ({ count, sequence, arrange }) => {
      const { unread, key } = await arrange()
      const listener = vi.fn<(refresh: AcceptedUnreadRefresh) => void>()
      const unsubscribedListener =
        vi.fn<(refresh: AcceptedUnreadRefresh) => void>()
      unread.onAcceptedRefresh(listener)
      const unsubscribe = unread.onAcceptedRefresh(unsubscribedListener)
      unsubscribe()

      requests[requests.length - 1].resolve(json(200, { count }))
      await settle(svelte)

      expect(listener.mock.calls).toEqual([[{ key, sequence, count }]])
      expect(unsubscribedListener.mock.calls).toEqual([])
    },
  )

  it('still signals the next listener and logs only the error name when a listener throws', async () => {
    // The store's own module registry: the hard-load row resets modules.
    const { log } = await import('$lib/app/util/log')
    const logError = vi.spyOn(log, 'error').mockImplementation(() => {})
    try {
      const generation = nextGeneration()
      const key = `${alice.did}|${generation}`
      const unread = await adoptionInFlight(alice, generation)
      class ListenerFailure extends Error {
        override name = 'ListenerFailure'
      }
      const throwingListener = vi.fn<(refresh: AcceptedUnreadRefresh) => void>(
        () => {
          throw new ListenerFailure(`listener failed for ${key}`)
        },
      )
      const nextListener = vi.fn<(refresh: AcceptedUnreadRefresh) => void>()
      unread.onAcceptedRefresh(throwingListener)
      unread.onAcceptedRefresh(nextListener)

      requests[0].resolve(json(200, { count: 3 }))
      await settle(svelte)

      expect(throwingListener).toHaveBeenCalledTimes(1)
      expect(nextListener.mock.calls).toEqual([
        [{ key, sequence: 1, count: 3 }],
      ])
      expect(logError.mock.calls).toEqual([
        [
          'Unread notification listener failed',
          undefined,
          { errorName: 'ListenerFailure' },
        ],
      ])
    } finally {
      logError.mockRestore()
    }
  })

  it.each([
    {
      settlement: 'a failed refresh',
      arrange: async (
        listener: (refresh: AcceptedUnreadRefresh) => void,
      ): Promise<() => void> => {
        signIn(alice)
        const unread = startStore()
        unread.onAcceptedRefresh(listener)
        await settle(svelte)
        expect(requests, "alice's adoption GET is in flight").toHaveLength(1)
        requests[0].resolve(json(200, { count: 7 }))
        await settle(svelte)
        expect(unread.count, 'the adoption GET set the count to 7').toBe(7)

        unread.refresh()
        await settle(svelte)
        expect(requests, 'the refresh GET is in flight').toHaveLength(2)
        return () =>
          requests[1].resolve(json(500, { error: 'InternalServerError' }))
      },
    },
    {
      settlement: "A's stale response after A → B",
      arrange: async (
        listener: (refresh: AcceptedUnreadRefresh) => void,
      ): Promise<() => void> => {
        signIn(alice)
        const unread = startStore()
        unread.onAcceptedRefresh(listener)
        await settle(svelte)
        expect(requests, "A's adoption GET is in flight").toHaveLength(1)
        signIn(bob)
        await settle(svelte)
        expect(requests, "B's adoption GET is in flight").toHaveLength(2)
        return () => requests[0].resolve(json(200, { count: 99 }))
      },
    },
  ])('does not signal when $settlement settles', async ({ arrange }) => {
    const listener = vi.fn<(refresh: AcceptedUnreadRefresh) => void>()
    const settleUnaccepted = await arrange(listener)
    const signalledBefore = [...listener.mock.calls]

    settleUnaccepted()
    await settle(svelte)

    expect(listener.mock.calls).toEqual(signalledBefore)
  })
})

// ---------------------------------------------------------------------------
// Triggers: 30 s timer, visibility, focus, navigation
// ---------------------------------------------------------------------------

/**
 * Under fake timers: signs alice in, starts the store and answers its
 * adoption GET; the fake clock has not moved since the adoption.
 */
async function adoptedUnderFakeTimers(): Promise<UnreadNotificationStore> {
  signIn(alice)
  const unread = startStore()
  await settleTimers()
  expect(unreadGets(), "alice's adoption GET is in flight").toHaveLength(1)
  unreadGets()[0].resolve(json(200, { count: 2 }))
  await settleTimers()
  return unread
}

describe('unread notification count 30 s timer while visible', () => {
  it.each([
    {
      adoption: 'the store is started while signed in',
      arrange: async () => {
        await adoptedUnderFakeTimers()
      },
    },
    {
      adoption:
        'the store is started signed out, 10 000 ms pass, then the login is synced',
      arrange: async () => {
        startStore()
        await settleTimers()
        await elapse(10_000)
        expect(unreadGets(), 'nothing is sent while signed out').toHaveLength(0)
        profile.syncFromServer(session(alice, nextGeneration()))
        svelte.flushSync()
        await settleTimers()
        expect(unreadGets(), "alice's adoption GET is in flight").toHaveLength(
          1,
        )
        unreadGets()[0].resolve(json(200, { count: 2 }))
        await settleTimers()
      },
    },
  ])(
    'sends one GET 30 000 ms after the adoption and one more at 60 000 ms when $adoption',
    async ({ arrange }) => {
      useFakeTimerFunctions()
      await arrange()

      await elapse(29_999)
      expect(unreadGets()).toHaveLength(1)

      await elapse(1)
      expect(unreadGets()).toHaveLength(2)

      unreadGets()[1].resolve(json(200, { count: 3 }))
      await settleTimers()
      await elapse(30_000)
      expect(unreadGets()).toHaveLength(3)
    },
  )
})

describe('unread notification count timer while hidden', () => {
  it('sends nothing during the 60 000 ms after the document becomes hidden', async () => {
    useFakeTimerFunctions()
    await adoptedUnderFakeTimers()
    await elapse(30_000)
    expect(
      unreadGets(),
      'precondition: the 30 s tick sent a GET while visible',
    ).toHaveLength(2)
    unreadGets()[1].resolve(json(200, { count: 3 }))
    await settleTimers()

    becomeVisibility('hidden')
    await settleTimers()
    await elapse(60_000)

    expect(unreadGets()).toHaveLength(2)
  })

  it('sends only the adoption GET during the 60 000 ms after a session is adopted while hidden', async () => {
    useFakeTimerFunctions()
    becomeVisibility('hidden')
    await adoptedUnderFakeTimers()

    await elapse(60_000)
    expect(unreadGets()).toHaveLength(1)

    becomeVisibility('visible')
    await settleTimers()
    expect(unreadGets(), 'one GET at once on becoming visible').toHaveLength(2)
  })
})

describe('unread notification count when the document becomes visible again', () => {
  it('sends one GET at once and restarts the 30 s timer from the return', async () => {
    useFakeTimerFunctions()
    await adoptedUnderFakeTimers()
    await elapse(10_000)
    becomeVisibility('hidden')
    await settleTimers()
    await elapse(35_000)

    becomeVisibility('visible')
    await settleTimers()
    expect(unreadGets(), 'one GET at once on the return').toHaveLength(2)

    unreadGets()[1].resolve(json(200, { count: 3 }))
    await settleTimers()
    await elapse(29_999)
    expect(unreadGets()).toHaveLength(2)

    await elapse(1)
    expect(unreadGets()).toHaveLength(3)

    unreadGets()[2].resolve(json(200, { count: 4 }))
    await settleTimers()
    await elapse(30_000)
    expect(unreadGets(), 'the timer keeps repeating').toHaveLength(4)
  })
})

describe('unread notification count on window focus', () => {
  it('sends exactly one GET getUnreadCount', async () => {
    await countUnder(alice, 2)

    window.dispatchEvent(new Event('focus'))
    await settle(svelte)

    expect(unreadGets()).toHaveLength(2)
  })
})

describe('unread notification count on navigation to the notifications page', () => {
  it("sends exactly one GET getUnreadCount for noteNavigation('/notifications')", async () => {
    const unread = await countUnder(alice, 2)

    unread.noteNavigation('/notifications')
    await settle(svelte)

    expect(unreadGets()).toHaveLength(2)
  })
})

describe('unread notification count on navigation elsewhere', () => {
  it.each(['/', '/settings/notifications'])(
    'sends nothing for noteNavigation(%j)',
    async (pathname) => {
      const unread = await countUnder(alice, 2)

      unread.noteNavigation(pathname)
      await settle(svelte)

      expect(unreadGets()).toHaveLength(1)
    },
  )
})

describe.each([
  {
    state: 'signed out',
    // GETs sent before the state was reached: none.
    baseline: 0,
    arrange: async (): Promise<UnreadNotificationStore> => {
      const unread = startStore()
      await settleTimers()
      return unread
    },
  },
  {
    state: 'expired after a signed-in adoption',
    // GETs sent before the state was reached: the resolved adoption GET.
    baseline: 1,
    arrange: async (): Promise<UnreadNotificationStore> => {
      const unread = await adoptedUnderFakeTimers()
      profile.expireSession(profile.sessionGeneration)
      svelte.flushSync()
      await settleTimers()
      return unread
    },
  },
])(
  'unread notification count triggers when $state',
  ({ baseline, arrange }) => {
    it.each([
      {
        trigger: '30 000 ms elapse',
        fire: async () => {
          await elapse(30_000)
        },
      },
      {
        trigger: 'the window gains focus',
        fire: async () => {
          window.dispatchEvent(new Event('focus'))
          await settleTimers()
        },
      },
      {
        trigger: 'the document becomes hidden then visible',
        fire: async () => {
          becomeVisibility('hidden')
          await settleTimers()
          becomeVisibility('visible')
          await settleTimers()
        },
      },
      {
        trigger: "noteNavigation('/notifications')",
        fire: async (unread: UnreadNotificationStore) => {
          unread.noteNavigation('/notifications')
          await settleTimers()
        },
      },
    ])('sends nothing when $trigger', async ({ fire }) => {
      useFakeTimerFunctions()
      const unread = await arrange()
      expect(
        unreadGets().slice(baseline),
        'nothing is sent after the baseline before the trigger',
      ).toHaveLength(0)

      await fire(unread)

      expect(unreadGets().slice(baseline)).toHaveLength(0)
    })
  },
)
