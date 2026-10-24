// @vitest-environment jsdom
import { get } from 'svelte/store'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest'
import type { NotificationPreferences } from '$lib/api/coves/types'
import {
  alice,
  bob,
  createGenerationFactory,
  createNotificationFetch,
  createSessionActions,
  json,
  session,
  settle,
  type Account,
  type NotificationRequest as HarnessNotificationRequest,
} from './notification-test-harness'
import type { NotificationPreferencesStore } from './preferences.svelte'

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
    url: new URL('http://localhost/settings'),
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

/** `store.values` read (untracked) at the moment the request was sent. */
interface ValuesAtSend {
  valuesAtSend: NotificationPreferences | undefined
}

type NotificationRequest = HarnessNotificationRequest & ValuesAtSend

const nextGeneration = createGenerationFactory('generation')

let svelte: typeof import('svelte')
let profile: (typeof import('$lib/app/state/auth.svelte'))['profile']
let createNotificationPreferences: (typeof import('./preferences.svelte'))['createNotificationPreferences']
let store: NotificationPreferencesStore | undefined
let stop: (() => void) | undefined
let toasts: (typeof import('$lib/ui/kit/toast/toasts'))['toasts']

const notificationFetch = createNotificationFetch<ValuesAtSend>(() => ({
  valuesAtSend: svelte.untrack(() => store?.values),
}))
const requests = notificationFetch.requests
const { signIn, expireAndReviveSameGeneration } = createSessionActions(
  () => ({ profile, svelte }),
  nextGeneration,
)

const fetchSpy = vi.fn<typeof fetch>()

function startStore(): NotificationPreferencesStore {
  const created = createNotificationPreferences()
  store = created
  stop = created.start()
  svelte.flushSync()
  return created
}

/** Signs `account` in, starts the store and waits until it is ready with `values`. */
async function readyUnder(
  account: Account,
  values: NotificationPreferences,
  generation = nextGeneration(),
): Promise<NotificationPreferencesStore> {
  signIn(account, generation)
  notificationFetch.answer = (request) => request.resolve(json(200, values))
  const preferences = startStore()
  await vi.waitFor(() => expect(preferences.status).toBe('ready'))
  notificationFetch.answer = undefined
  return preferences
}

const getPreferencesPath =
  /\/xrpc\/social\.coves\.notification\.getPreferences$/

beforeEach(async () => {
  localStorage.clear()
  vi.stubGlobal('__VERSION__', 'test')
  fetchSpy.mockReset().mockImplementation(notificationFetch.handle)
  vi.stubGlobal('fetch', fetchSpy)
  notificationLog.logNotificationFailure.mockReset()
  toasts = (await import('$lib/ui/kit/toast/toasts')).toasts
  toasts.set([])
  notificationFetch.reset()
  store = undefined
  stop = undefined
  svelte = await import('svelte')
  profile = (await import('$lib/app/state/auth.svelte')).profile
  createNotificationPreferences = (await import('./preferences.svelte'))
    .createNotificationPreferences
  profile.syncFromServer(undefined)
  svelte.flushSync()
})

afterEach(() => {
  stop?.()
  svelte.flushSync()
  expect(notificationFetch.unexpectedUrls).toEqual([])
})

afterAll(() => {
  profile.mainEffect()
})

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

describe('notification preferences load', () => {
  it('sends one GET getPreferences when signed in and becomes ready with the returned values', async () => {
    signIn(alice)
    notificationFetch.answer = (request) =>
      request.resolve(
        json(200, {
          postReply: true,
          commentReply: false,
          mention: true,
          upvote: false,
        }),
      )

    const preferences = startStore()

    await vi.waitFor(() => expect(preferences.status).toBe('ready'))
    expect(preferences.values).toEqual({
      postReply: true,
      commentReply: false,
      mention: true,
      upvote: false,
    })
    await settle(svelte)
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('GET')
    expect(requests[0].path).toMatch(getPreferencesPath)
  })

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
  ])('sends nothing and is signed-out when $state', async ({ arrange }) => {
    arrange()
    notificationFetch.answer = (request) =>
      request.resolve(
        json(200, {
          postReply: true,
          commentReply: true,
          mention: true,
          upvote: true,
        }),
      )

    const preferences = startStore()
    await settle(svelte)

    expect(preferences.status).toBe('signed-out')
    expect(preferences.values).toBeUndefined()
    expect(requests).toHaveLength(0)
  })

  const networkError = new TypeError('Failed to fetch')

  it.each([
    {
      failure: 'a 500',
      answer: (request: NotificationRequest) =>
        request.resolve(json(500, { error: 'InternalServerError' })),
      logged: expect.objectContaining({
        name: 'XrpcError',
        status: 500,
        errorName: 'InternalServerError',
      }),
    },
    {
      failure: 'a network error',
      answer: (request: NotificationRequest) => request.reject(networkError),
      logged: networkError,
    },
  ])(
    'is error with no values and logs the failure after $failure',
    async ({ answer: fail, logged }) => {
      signIn(alice)
      notificationFetch.answer = fail

      const preferences = startStore()

      await vi.waitFor(() => expect(preferences.status).toBe('error'))
      expect(preferences.values).toBeUndefined()
      expect(notificationLog.logNotificationFailure.mock.calls).toEqual([
        ['social.coves.notification.getPreferences', logged],
      ])
    },
  )

  it('retry() from error sends one more GET getPreferences and becomes ready', async () => {
    signIn(alice)
    notificationFetch.answer = (request) =>
      request.resolve(json(500, { error: 'InternalServerError' }))
    const preferences = startStore()
    await settle(svelte)
    const statusBeforeRetry = preferences.status

    notificationFetch.answer = (request) =>
      request.resolve(
        json(200, {
          postReply: false,
          commentReply: true,
          mention: false,
          upvote: true,
        }),
      )
    preferences.retry()

    await vi.waitFor(() => expect(preferences.status).toBe('ready'))
    expect(statusBeforeRetry).toBe('error')
    expect(preferences.values).toEqual({
      postReply: false,
      commentReply: true,
      mention: false,
      upvote: true,
    })
    await settle(svelte)
    expect(requests).toHaveLength(2)
    expect(requests[1].method).toBe('GET')
    expect(requests[1].path).toMatch(getPreferencesPath)
  })
})

// ---------------------------------------------------------------------------
// Owner changes
// ---------------------------------------------------------------------------

describe('notification preferences across owner changes', () => {
  /** Holds the store's first GET under alice in flight; returns it. */
  async function loadingUnderAlice(): Promise<{
    preferences: NotificationPreferencesStore
    staleRequest: NotificationRequest
    aliceGeneration: string
  }> {
    const aliceGeneration = signIn(alice)
    const preferences = startStore()
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(preferences.status).toBe('loading')
    return { preferences, staleRequest: requests[0], aliceGeneration }
  }

  it.each([
    {
      transition: 'bob is adopted',
      apply: () => {
        signIn(bob)
      },
    },
    {
      transition: 'alice expires and signs in again with a new generation',
      apply: () => {
        profile.expireSession(profile.sessionGeneration)
        svelte.flushSync()
        signIn(alice)
      },
    },
    {
      transition: 'alice stays signed in and adopts a fresh generation',
      apply: () => {
        signIn(alice)
      },
    },
  ])(
    'when $transition, sends one new GET with no values held and becomes ready with the new values',
    async ({ apply }) => {
      const preferences = await readyUnder(alice, {
        postReply: true,
        commentReply: false,
        mention: true,
        upvote: false,
      })

      apply()
      await settle(svelte)

      expect(requests).toHaveLength(2)
      expect(requests[1].method).toBe('GET')
      expect(requests[1].path).toMatch(getPreferencesPath)
      expect(requests[1].valuesAtSend).toBeUndefined()

      requests[1].resolve(
        json(200, {
          postReply: false,
          commentReply: true,
          mention: false,
          upvote: true,
        }),
      )

      await vi.waitFor(() => expect(preferences.status).toBe('ready'))
      expect(preferences.values).toEqual({
        postReply: false,
        commentReply: true,
        mention: false,
        upvote: true,
      })
      await settle(svelte)
      expect(requests).toHaveLength(2)
    },
  )

  it.each([
    {
      transition: 'the session expires',
      apply: async () => {
        profile.expireSession(profile.sessionGeneration)
        svelte.flushSync()
      },
    },
    {
      transition: 'the account is removed',
      apply: async () => {
        await profile.remove(profile.current.id)
        svelte.flushSync()
      },
    },
  ])(
    'when $transition, drops the values, is signed-out and sends nothing',
    async ({ apply }) => {
      const preferences = await readyUnder(alice, {
        postReply: true,
        commentReply: false,
        mention: true,
        upvote: false,
      })

      await apply()
      await settle(svelte)

      expect(preferences.values).toBeUndefined()
      expect(preferences.status).toBe('signed-out')
      expect(requests).toHaveLength(1)
    },
  )

  describe.each([
    {
      transition: 'alice to bob',
      apply: () => {
        signIn(bob)
      },
    },
    {
      transition: 'expiry then same-generation revival',
      apply: (aliceGeneration: string) => {
        expireAndReviveSameGeneration(alice, aliceGeneration)
      },
    },
  ])('after $transition with the first GET in flight', ({ apply }) => {
    async function transitionToSecondRequest(
      aliceGeneration: string,
    ): Promise<NotificationRequest> {
      apply(aliceGeneration)
      await settle(svelte)
      expect(requests).toHaveLength(2)
      expect(requests[1].method).toBe('GET')
      expect(requests[1].path).toMatch(getPreferencesPath)
      return requests[1]
    }

    it('ignores a stale success that lands before the new GET and becomes ready with the new values', async () => {
      const { preferences, staleRequest, aliceGeneration } =
        await loadingUnderAlice()
      const currentRequest = await transitionToSecondRequest(aliceGeneration)

      staleRequest.resolve(
        json(200, {
          postReply: true,
          commentReply: true,
          mention: true,
          upvote: false,
        }),
      )
      await settle(svelte)

      expect(preferences.values).toBeUndefined()
      expect(preferences.status).toBe('loading')

      currentRequest.resolve(
        json(200, {
          postReply: false,
          commentReply: false,
          mention: false,
          upvote: true,
        }),
      )

      await vi.waitFor(() => expect(preferences.status).toBe('ready'))
      expect(preferences.values).toEqual({
        postReply: false,
        commentReply: false,
        mention: false,
        upvote: true,
      })
    })

    it.each([
      {
        stale: 'success',
        answer: (request: NotificationRequest) =>
          request.resolve(
            json(200, {
              postReply: true,
              commentReply: true,
              mention: true,
              upvote: false,
            }),
          ),
      },
      {
        stale: '500',
        answer: (request: NotificationRequest) =>
          request.resolve(json(500, { error: 'InternalServerError' })),
      },
    ])(
      'stays ready with the new values when a stale $stale lands after the new GET succeeded',
      async ({ answer: answerStale }) => {
        const { preferences, staleRequest, aliceGeneration } =
          await loadingUnderAlice()
        const currentRequest = await transitionToSecondRequest(aliceGeneration)

        currentRequest.resolve(
          json(200, {
            postReply: false,
            commentReply: false,
            mention: false,
            upvote: true,
          }),
        )
        await vi.waitFor(() => expect(preferences.status).toBe('ready'))

        answerStale(staleRequest)
        await settle(svelte)

        expect(notificationLog.logNotificationFailure).not.toHaveBeenCalled()
        expect(preferences.status).toBe('ready')
        expect(preferences.values).toEqual({
          postReply: false,
          commentReply: false,
          mention: false,
          upvote: true,
        })
      },
    )
  })
})

// ---------------------------------------------------------------------------
// Start and stop
// ---------------------------------------------------------------------------

describe('notification preferences start and stop', () => {
  it('a second start() sends no second GET and its returned function does not stop the store', async () => {
    const preferences = await readyUnder(alice, {
      postReply: true,
      commentReply: false,
      mention: true,
      upvote: false,
    })

    const secondStop = preferences.start()
    svelte.flushSync()
    await settle(svelte)
    expect(requests).toHaveLength(1)

    secondStop()
    svelte.flushSync()
    signIn(bob)
    await settle(svelte)

    expect(requests).toHaveLength(2)
    expect(requests[1].method).toBe('GET')
    expect(requests[1].path).toMatch(getPreferencesPath)
    expect(requests[1].valuesAtSend).toBeUndefined()
  })

  it('stop() from ready drops the values and leaves nothing to follow', async () => {
    const preferences = await readyUnder(alice, {
      postReply: true,
      commentReply: false,
      mention: true,
      upvote: false,
    })

    stop?.()
    svelte.flushSync()

    expect(preferences.values).toBeUndefined()
    expect(preferences.status).toBe('loading')
  })

  it('retry() after stop() from error sends nothing', async () => {
    signIn(alice)
    notificationFetch.answer = (request) =>
      request.resolve(json(500, { error: 'InternalServerError' }))
    const preferences = startStore()
    await vi.waitFor(() => expect(preferences.status).toBe('error'))
    notificationFetch.answer = (request) =>
      request.resolve(
        json(200, {
          postReply: true,
          commentReply: true,
          mention: true,
          upvote: true,
        }),
      )

    stop?.()
    svelte.flushSync()
    preferences.retry()
    await settle(svelte)

    expect(requests).toHaveLength(1)
    expect(preferences.values).toBeUndefined()
    expect(preferences.status).toBe('loading')
  })

  it('a GET in flight when stop() runs changes nothing when it lands', async () => {
    signIn(alice)
    const preferences = startStore()
    await vi.waitFor(() => expect(requests).toHaveLength(1))

    stop?.()
    svelte.flushSync()
    requests[0].resolve(
      json(200, {
        postReply: true,
        commentReply: true,
        mention: true,
        upvote: true,
      }),
    )
    await settle(svelte)

    expect(preferences.values).toBeUndefined()
    expect(preferences.status).toBe('loading')
  })
})

// ---------------------------------------------------------------------------
// Save queue
// ---------------------------------------------------------------------------

const putPreferencesPath =
  /\/xrpc\/social\.coves\.notification\.putPreferences$/

const puts = () =>
  requests.filter((request) => putPreferencesPath.test(request.path))

/** Ready under alice with every switch on. */
const readyAllOn = (generation?: string) =>
  readyUnder(
    alice,
    {
      postReply: true,
      commentReply: true,
      mention: true,
      upvote: true,
    },
    generation,
  )

describe('notification preferences save queue', () => {
  const putBodies = () => puts().map((request) => request.body)
  const toastContents = () => get(toasts).map((toast) => toast.content)

  it('set() sends exactly one POST putPreferences whose body is only the changed key', async () => {
    const preferences = await readyAllOn()

    preferences.set('mention', false)
    await settle(svelte)

    expect(puts()).toHaveLength(1)
    expect(puts()[0].method).toBe('POST')
    expect(puts()[0].path).toMatch(putPreferencesPath)
    expect(puts()[0].body).toEqual({ mention: false })
  })

  it('takes the full object a successful put returns as the values', async () => {
    const preferences = await readyAllOn()
    notificationFetch.answer = (request) => {
      if (putPreferencesPath.test(request.path))
        request.resolve(
          json(200, {
            postReply: false,
            commentReply: true,
            mention: false,
            upvote: true,
          }),
        )
    }

    preferences.set('mention', false)
    await settle(svelte)

    expect(preferences.values).toEqual({
      postReply: false,
      commentReply: true,
      mention: false,
      upvote: true,
    })
  })

  it('sends one put at a time in call order without coalescing, and sends at once again after the queue drains', async () => {
    const preferences = await readyAllOn()

    preferences.set('mention', false)
    preferences.set('upvote', false)
    preferences.set('mention', true)
    await settle(svelte)
    expect(putBodies()).toEqual([{ mention: false }])

    puts()[0].resolve(
      json(200, {
        postReply: true,
        commentReply: true,
        mention: false,
        upvote: true,
      }),
    )
    await settle(svelte)
    expect(putBodies()).toEqual([{ mention: false }, { upvote: false }])

    puts()[1].resolve(
      json(200, {
        postReply: true,
        commentReply: true,
        mention: false,
        upvote: false,
      }),
    )
    await settle(svelte)
    expect(putBodies()).toEqual([
      { mention: false },
      { upvote: false },
      { mention: true },
    ])

    puts()[2].resolve(
      json(200, {
        postReply: true,
        commentReply: true,
        mention: true,
        upvote: false,
      }),
    )
    await settle(svelte)
    expect(putBodies()).toHaveLength(3)

    preferences.set('postReply', false)
    await settle(svelte)
    expect(putBodies()).toEqual([
      { mention: false },
      { upvote: false },
      { mention: true },
      { postReply: false },
    ])
  })

  it('shows every pending value on top of the stored object at once, and keeps the still-pending ones on top of a successful put result', async () => {
    const preferences = await readyAllOn()

    preferences.set('mention', false)
    expect(preferences.values).toEqual({
      postReply: true,
      commentReply: true,
      mention: false,
      upvote: true,
    })

    preferences.set('upvote', false)
    preferences.set('mention', true)
    expect(preferences.values).toEqual({
      postReply: true,
      commentReply: true,
      mention: true,
      upvote: false,
    })

    await settle(svelte)
    puts()[0].resolve(
      json(200, {
        postReply: false,
        commentReply: true,
        mention: false,
        upvote: true,
      }),
    )
    await settle(svelte)

    expect(preferences.values).toEqual({
      postReply: false,
      commentReply: true,
      mention: true,
      upvote: false,
    })
  })

  const networkError = new TypeError('Failed to fetch')

  it.each([
    {
      failure: 'a 500',
      fail: (request: NotificationRequest) =>
        request.resolve(
          json(500, { error: 'InternalServerError', message: 'x' }),
        ),
      logged: expect.objectContaining({
        name: 'XrpcError',
        status: 500,
        errorName: 'InternalServerError',
      }),
    },
    {
      failure: 'a network error',
      fail: (request: NotificationRequest) => request.reject(networkError),
      logged: networkError,
    },
  ])(
    'after $failure on the first put, reverts that key, keeps and sends the later changes, toasts and logs',
    async ({ fail, logged }) => {
      const preferences = await readyAllOn()
      notificationFetch.answer = (request) => {
        if (puts().length === 1 && request === puts()[0]) fail(request)
      }

      preferences.set('mention', false)
      preferences.set('mention', true)
      preferences.set('upvote', false)
      await settle(svelte)

      expect(preferences.values).toEqual({
        postReply: true,
        commentReply: true,
        mention: true,
        upvote: false,
      })
      expect(putBodies()).toEqual([{ mention: false }, { mention: true }])
      expect(toastContents()).toEqual(['Could not save notification settings.'])
      expect(notificationLog.logNotificationFailure.mock.calls).toEqual([
        ['social.coves.notification.putPreferences', logged],
      ])

      puts()[1].resolve(
        json(200, {
          postReply: true,
          commentReply: true,
          mention: true,
          upvote: true,
        }),
      )
      await settle(svelte)

      expect(putBodies()).toEqual([
        { mention: false },
        { mention: true },
        { upvote: false },
      ])
    },
  )

  it('drops a change refused with AccountNotIndexed, shows the setup toast, logs it and sends the next change', async () => {
    const preferences = await readyAllOn()
    notificationFetch.answer = (request) => {
      if (puts().length === 1 && request === puts()[0])
        request.resolve(json(400, { error: 'AccountNotIndexed', message: 'x' }))
    }

    preferences.set('mention', false)
    preferences.set('upvote', false)
    await settle(svelte)

    expect(preferences.values).toEqual({
      postReply: true,
      commentReply: true,
      mention: true,
      upvote: false,
    })
    expect(toastContents()).toEqual([
      'Your account is still being set up. Try again in a minute.',
    ])
    expect(notificationLog.logNotificationFailure.mock.calls).toEqual([
      [
        'social.coves.notification.putPreferences',
        expect.objectContaining({
          name: 'XrpcError',
          status: 400,
          errorName: 'AccountNotIndexed',
        }),
      ],
    ])
    expect(putBodies()).toEqual([{ mention: false }, { upvote: false }])
  })

  it('after a put answered 401 expires the session, shows no toast and never sends the queued change', async () => {
    const preferences = await readyAllOn()

    preferences.set('mention', false)
    preferences.set('upvote', false)
    await settle(svelte)
    expect(putBodies()).toEqual([{ mention: false }])
    expect(preferences.values).toEqual({
      postReply: true,
      commentReply: true,
      mention: false,
      upvote: false,
    })

    puts()[0].resolve(
      json(401, { error: 'AuthenticationRequired', message: 'expired' }),
    )
    await settle(svelte)
    await settle(svelte)

    expect(profile.sessionExpired).toBe(true)
    expect(toastContents()).toEqual([])
    expect(putBodies()).toEqual([{ mention: false }])
  })

  it.each([
    {
      transition: 'alice to bob',
      apply: async () => {
        signIn(bob)
      },
      sentAfter: [
        {
          method: 'GET',
          path: expect.stringMatching(getPreferencesPath),
          valuesAtSend: undefined,
        },
      ],
      valuesAfter: {
        postReply: true,
        commentReply: false,
        mention: true,
        upvote: true,
      },
    },
    {
      transition: 'the session expires',
      apply: async () => {
        profile.expireSession(profile.sessionGeneration)
        svelte.flushSync()
      },
      sentAfter: [],
      valuesAfter: undefined,
    },
    {
      transition: 'alice logs out',
      apply: async () => {
        await profile.remove(profile.current.id)
        svelte.flushSync()
      },
      sentAfter: [],
      valuesAfter: undefined,
    },
  ])(
    'when $transition with a put in flight and two queued, drops the values and queue at once and never sends another put',
    async ({ apply, sentAfter, valuesAfter }) => {
      const preferences = await readyAllOn()
      preferences.set('mention', false)
      preferences.set('upvote', false)
      preferences.set('postReply', false)
      await settle(svelte)
      expect(putBodies()).toEqual([{ mention: false }])
      expect(preferences.values).toEqual({
        postReply: false,
        commentReply: true,
        mention: false,
        upvote: false,
      })
      const requestsBefore = requests.length

      await apply()

      expect(preferences.values).toBeUndefined()
      await settle(svelte)
      const requestsAfter = requests.slice(requestsBefore)
      expect(
        requestsAfter.map(({ method, path, valuesAtSend }) => ({
          method,
          path,
          valuesAtSend,
        })),
      ).toEqual(sentAfter)
      for (const request of requestsAfter)
        request.resolve(
          json(200, {
            postReply: true,
            commentReply: false,
            mention: true,
            upvote: true,
          }),
        )
      await settle(svelte)
      expect(preferences.values).toEqual(valuesAfter)

      puts()[0].resolve(
        json(200, {
          postReply: true,
          commentReply: true,
          mention: false,
          upvote: true,
        }),
      )
      await settle(svelte)
      await settle(svelte)

      expect(putBodies()).toEqual([{ mention: false }])
      expect(preferences.values).toEqual(valuesAfter)
    },
  )

  const sameGenerationRevival = {
    transition: 'expiry then same-generation revival',
    apply: (generation: string) => {
      expireAndReviveSameGeneration(alice, generation)
    },
  }

  /**
   * Ready under alice with `mention: false` in flight (never answered here),
   * then `apply` changes the owner and the new load becomes ready with
   * `reloaded`. Returns the store.
   */
  async function readyAgainWithOldPutInFlight(
    apply: (generation: string) => void,
    reloaded: NotificationPreferences,
  ): Promise<NotificationPreferencesStore> {
    const generation = nextGeneration()
    const preferences = await readyAllOn(generation)
    preferences.set('mention', false)
    await settle(svelte)
    expect(putBodies()).toEqual([{ mention: false }])

    notificationFetch.answer = (request) => {
      if (getPreferencesPath.test(request.path))
        request.resolve(json(200, reloaded))
    }
    apply(generation)
    await vi.waitFor(() => {
      expect(preferences.status).toBe('ready')
      expect(preferences.values).toEqual(reloaded)
    })
    notificationFetch.answer = undefined
    return preferences
  }

  it.each([
    {
      transition: 'alice to bob',
      apply: () => {
        signIn(bob)
      },
    },
    sameGenerationRevival,
  ])(
    'after $transition, a set on the new load sends its put at once while the old put is still unanswered',
    async ({ apply }) => {
      const preferences = await readyAgainWithOldPutInFlight(apply, {
        postReply: true,
        commentReply: false,
        mention: true,
        upvote: true,
      })

      preferences.set('upvote', false)
      await settle(svelte)

      expect(putBodies()).toEqual([{ mention: false }, { upvote: false }])
    },
  )

  it.each([
    {
      stale: 'success with a differing full object',
      settleStale: (request: NotificationRequest) =>
        request.resolve(
          json(200, {
            postReply: true,
            commentReply: true,
            mention: false,
            upvote: true,
          }),
        ),
    },
    {
      stale: '500',
      settleStale: (request: NotificationRequest) =>
        request.resolve(
          json(500, { error: 'InternalServerError', message: 'x' }),
        ),
    },
  ])(
    'after expiry then same-generation revival, a late old-epoch put $stale changes nothing and releases nothing, and the new queue drains once in order',
    async ({ settleStale }) => {
      const preferences = await readyAgainWithOldPutInFlight(
        sameGenerationRevival.apply,
        {
          postReply: true,
          commentReply: false,
          mention: true,
          upvote: true,
        },
      )
      preferences.set('upvote', false)
      preferences.set('postReply', false)
      await settle(svelte)
      expect(putBodies()).toEqual([{ mention: false }, { upvote: false }])
      expect(preferences.values).toEqual({
        postReply: false,
        commentReply: false,
        mention: true,
        upvote: false,
      })

      settleStale(puts()[0])
      await settle(svelte)

      expect(preferences.values).toEqual({
        postReply: false,
        commentReply: false,
        mention: true,
        upvote: false,
      })
      expect(putBodies()).toEqual([{ mention: false }, { upvote: false }])

      preferences.set('commentReply', true)
      await settle(svelte)

      expect(putBodies()).toEqual([{ mention: false }, { upvote: false }])
      expect(preferences.values).toEqual({
        postReply: false,
        commentReply: true,
        mention: true,
        upvote: false,
      })
      expect(toastContents()).toEqual([])
      expect(notificationLog.logNotificationFailure).not.toHaveBeenCalled()

      notificationFetch.answer = (request) => {
        if (putPreferencesPath.test(request.path))
          request.resolve(
            json(200, {
              postReply: false,
              commentReply: true,
              mention: true,
              upvote: false,
            }),
          )
      }
      puts()[1].resolve(
        json(200, {
          postReply: true,
          commentReply: false,
          mention: true,
          upvote: false,
        }),
      )
      await vi.waitFor(() => expect(puts()).toHaveLength(4))
      await settle(svelte)

      expect(putBodies()).toEqual([
        { mention: false },
        { upvote: false },
        { postReply: false },
        { commentReply: true },
      ])
    },
  )

  it.each([
    {
      transition: 'alice to bob',
      apply: () => {
        profile.syncFromServer(session(bob, nextGeneration()))
      },
      valuesAfter: {
        postReply: false,
        commentReply: true,
        mention: true,
        upvote: false,
      },
    },
    {
      transition: 'the session expires',
      apply: () => {
        profile.expireSession(profile.sessionGeneration)
      },
      valuesAfter: undefined,
    },
  ])(
    'a set made right after $transition, before anything flushes, never sends a put',
    async ({ apply, valuesAfter }) => {
      const preferences = await readyAllOn()
      const requestsBefore = requests.length

      apply()
      preferences.set('mention', false)
      svelte.flushSync()
      await settle(svelte)
      for (const request of requests.slice(requestsBefore))
        if (getPreferencesPath.test(request.path))
          request.resolve(
            json(200, {
              postReply: false,
              commentReply: true,
              mention: true,
              upvote: false,
            }),
          )
      await settle(svelte)
      await settle(svelte)

      expect(puts()).toEqual([])
      expect(preferences.values).toEqual(valuesAfter)
    },
  )
})

// ---------------------------------------------------------------------------
// Unread count refresh after a save
// ---------------------------------------------------------------------------

describe('notification preferences save and the unread count', () => {
  // The cross-store contract is the call itself: the app-lifetime unread
  // store (never started here) is asked to refresh once per successful put.
  let refresh: MockInstance<() => void>

  beforeEach(async () => {
    const { unreadNotifications } = await import('./unread.svelte')
    refresh = vi.spyOn(unreadNotifications, 'refresh')
  })

  afterEach(() => {
    refresh.mockRestore()
  })

  it('calls unread refresh() once per successful put: 0 before either succeeds, 1 after the first while the second is in flight, 2 after the second', async () => {
    const preferences = await readyAllOn()

    preferences.set('mention', false)
    preferences.set('upvote', false)
    await settle(svelte)
    expect(refresh).toHaveBeenCalledTimes(0)

    puts()[0].resolve(
      json(200, {
        postReply: true,
        commentReply: true,
        mention: false,
        upvote: true,
      }),
    )
    await settle(svelte)
    // Precondition: the second put is in flight, not yet answered.
    expect(puts()).toHaveLength(2)
    expect(refresh).toHaveBeenCalledTimes(1)

    puts()[1].resolve(
      json(200, {
        postReply: true,
        commentReply: true,
        mention: false,
        upvote: false,
      }),
    )
    await settle(svelte)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      failure: 'a 500',
      response: () => json(500, { error: 'InternalServerError' }),
    },
    {
      failure: 'AccountNotIndexed',
      response: () => json(400, { error: 'AccountNotIndexed', message: 'x' }),
    },
    {
      failure: 'an expired-session 401',
      response: () =>
        json(401, { error: 'AuthenticationRequired', message: 'expired' }),
    },
  ])(
    'does not call unread refresh() when the put fails with $failure',
    async ({ response }) => {
      const preferences = await readyAllOn()

      preferences.set('mention', false)
      await settle(svelte)
      puts()[0].resolve(response())
      await settle(svelte)
      await settle(svelte)

      expect(refresh).not.toHaveBeenCalled()
    },
  )
})
