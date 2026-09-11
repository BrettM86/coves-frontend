// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ServerSession } from '$lib/app/state/auth.svelte'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: false,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$lib/app/state/instance/env', () => ({
  DEFAULT_INSTANCE_URL: 'https://upstream.internal.example',
  LINKED_INSTANCE_URL: undefined,
}))
vi.mock('$lib/app/state/instance.svelte', () => ({
  DEFAULT_INSTANCE_URL: 'https://upstream.internal.example',
  instance: { data: 'https://upstream.internal.example' },
}))
const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  return import(
    /* @vite-ignore */ createRequire(import.meta.url)
      .resolve('svelte/package.json')
      .replace('package.json', subpath)
  )
}
vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))
vi.mock('svelte/reactivity', () =>
  svelteClientEntry('src/reactivity/index-client.js'),
)
const kitClientState = async () => {
  const { createRequire } = await import('node:module')
  const path = createRequire(import.meta.url)
    .resolve('@sveltejs/kit/package.json')
    .replace('package.json', 'src/runtime/app/state/client.js')
  return import(/* @vite-ignore */ path)
}

const generation = 'validated-cookie-generation'
const session: ServerSession = {
  authenticated: true,
  activeAccountId: 'did:plc:abcdefghijklmnopqrstuvwx',
  sessionGeneration: generation,
  account: {
    id: 'did:plc:abcdefghijklmnopqrstuvwx',
    did: 'did:plc:abcdefghijklmnopqrstuvwx',
    handle: 'alice.test',
    instance: 'https://upstream.internal.example',
  },
} as ServerSession

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((fulfill) => {
    resolve = fulfill
  })
  return { promise, resolve }
}

let destroyRoot = () => {}
beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  // Keep per-scenario Kit isolation while refreshing cached browser mocks.
  vi.doMock('svelte', () => svelteClientEntry('src/index-client.js'))
  vi.doMock('svelte/reactivity', () =>
    svelteClientEntry('src/reactivity/index-client.js'),
  )
  vi.doMock('$app/state', kitClientState)
})
afterEach(() => {
  destroyRoot()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

// Real installed Kit router and real browser profile. Manifest, shell and API
// responses are integration fixtures; the generation-token expiration in the
// fetch wrappers and the SessionRecovery revalidation run unchanged.
async function setup(
  initial: 'authenticated' | 'guest' = 'authenticated',
  initialUnauthorized = true,
) {
  vi.stubGlobal('__VERSION__', 'test')
  vi.stubGlobal('__SVELTEKIT_PAYLOAD__', {})
  vi.stubGlobal('scrollTo', vi.fn())
  // jsdom lacks SVGAElement; the router inspects rendered links after navigating.
  vi.stubGlobal('SVGAElement', class {})
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    },
  )
  history.replaceState({}, '', '/initial')
  // The backend answers every XRPC call with 401. Whether the cookie is
  // really dead decides what the root load (the server's own session check)
  // reports once a 401 has been seen: with `cookieDead` false the 401 was a
  // transient fault and the server keeps authenticating the same generation.
  // `cookieRemoved` is what the server sees once the dead cookie has been
  // deleted: no cookie at all, so neither a generation nor an expiration.
  const state = { cookieDead: true, cookieRemoved: false }
  const isExpireCall = (input: RequestInfo | URL) =>
    String(input) === '/api/auth/expire'
  const transport = vi.fn<typeof fetch>(async (input) => {
    if (isExpireCall(input)) return new Response(null, { status: 204 })
    return new Response(
      JSON.stringify({ error: 'ExpiredToken', message: 'Session expired' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )
  })
  const expireCalls = () =>
    transport.mock.calls
      .filter(([input]) => isExpireCall(input))
      .map(([, init]) => JSON.parse(String(init?.body)) as unknown)
  const unauthorizedSeen = () =>
    transport.mock.calls.some(([input]) => !isExpireCall(input))
  vi.stubGlobal('fetch', transport)
  const { createRequire } = await import('node:module')
  const kitClientPath = createRequire(import.meta.url)
    .resolve('@sveltejs/kit/package.json')
    .replace('package.json', 'src/runtime/client/client.js')
  vi.doMock(createRequire(kitClientPath).resolve('esm-env'), () => ({
    BROWSER: true,
    DEV: false,
    BUILDING: false,
  }))
  const router = await import(/* @vite-ignore */ kitClientPath)
  const { asClassComponent } = await import('svelte/legacy')
  const { loadTranslations, locale } = await import('$lib/app/state/i18n')
  await loadTranslations('en')
  locale.set('en')
  const { profile } = await import('$lib/app/state/auth.svelte')
  const Root = (await import('./fixtures/RecoveryRoot.svelte')).default
  const RootClass = asClassComponent(Root)
  const { coves } = await import('$lib/api/client.svelte')
  const { load: accountGuard } =
    await import('../../../routes/profile/(local_user)/+layout')
  const { flushSync, tick } = await import('svelte')
  const sessionAuthenticated = initial === 'authenticated'
  // A returning visitor carries the persisted authenticated profile before the
  // root data confirms it, so an initial 401 is an expiration report.
  if (sessionAuthenticated) profile.syncFromServer(session)
  const rootLoad = vi.fn(({ depends }: { depends: (dep: string) => void }) => {
    depends('app:session')
    if (!sessionAuthenticated || state.cookieRemoved)
      return {
        session: null,
        sessionGeneration: undefined,
        sessionExpired: false,
      }
    if (state.cookieDead && unauthorizedSeen())
      return {
        session: null,
        sessionGeneration: generation,
        sessionExpired: true,
      }
    return { session, sessionGeneration: generation, sessionExpired: false }
  })
  const destinationEntered = deferred()
  const destinationRelease = deferred()
  let receivedError: unknown
  const failure = () =>
    coves({ func: transport })
      .getBlockedUsers()
      .catch((error: unknown) => error)
  const protectedLoad = async ({ url }: { url: URL }) => {
    if (url.pathname === '/initial' && !initialUnauthorized) return {}
    receivedError = await failure()
    return {}
  }
  const target = document.createElement('div')
  document.body.append(target)
  const app = {
    root: class extends RootClass {
      constructor(options: ConstructorParameters<typeof RootClass>[0]) {
        super(options)
        destroyRoot = () => this.$destroy()
      }
    },
    nodes: [
      async () => ({ component: Root, universal: { load: rootLoad } }),
      async () => ({ component: Root }),
      async () => ({ component: Root, universal: { load: protectedLoad } }),
      async () => ({
        component: Root,
        universal: {
          load: async () => {
            destinationEntered.resolve()
            await destinationRelease.promise
            return {}
          },
        },
      }),
      async () => ({ component: Root }),
      // The real signed-in-only guard from the profile settings layout.
      async () => ({ component: Root, universal: { load: accountGuard } }),
      async () => ({ component: Root }),
    ],
    server_loads: [],
    dictionary: {
      '/initial': [2, []],
      '/protected': [2, []],
      '/held': [3, []],
      '/replacement': [4, []],
      '/account': [5, []],
      '/login': [6, []],
    },
    matchers: {},
    hooks: {
      handleError: ({ error }: { error: Error }) => ({
        message: error.message,
      }),
      reroute: () => undefined,
      transport: {},
    },
    decoders: {},
    encoders: {},
    hash: false,
  }
  const settle = async () => {
    await tick()
    flushSync()
    await tick()
  }
  return {
    router,
    app,
    target,
    profile,
    state,
    transport,
    expireCalls,
    rootLoad,
    failure,
    destinationEntered,
    destinationRelease,
    receivedError: () => receivedError,
    settle,
    prompt: () => target.querySelector('[role=alert]'),
    start: async () => {
      await router.start(app, target)
      await settle()
    },
  }
}

it('finishes initial entry, expires the session, then performs one revalidation whose verdict retires the generation and expires the cookie', async () => {
  const harness = await setup()
  await harness.start()
  expect(harness.receivedError()).toMatchObject({
    status: 401,
    errorName: 'ExpiredToken',
  })
  expect(harness.target.querySelector('[data-route="/initial"]')).not.toBeNull()
  expect(harness.rootLoad).toHaveBeenCalledTimes(2)
  // The initial root data, in flight beside the 401, could not undo it; the
  // revalidation confirmed the expiration.
  expect(harness.profile.isAuthenticated).toBe(false)
  expect(harness.profile.sessionExpired).toBe(true)
  await vi.waitFor(() =>
    expect(harness.profile.sessionExpirationConfirmed).toBe(true),
  )
  expect(harness.prompt()?.textContent).toMatch(/session.*expired/i)
  await vi.waitFor(() =>
    expect(harness.expireCalls()).toEqual([{ generation }]),
  )
  // A confirmed generation cannot come back through later root data.
  harness.state.cookieDead = false
  await harness.router.invalidate('app:session')
  await harness.settle()
  expect(harness.profile.isAuthenticated).toBe(false)
  expect(harness.prompt()).not.toBeNull()
})

it('a transient 401 is undone by a revalidation that re-authenticates the same generation', async () => {
  const harness = await setup()
  harness.state.cookieDead = false
  await harness.start()
  expect(harness.receivedError()).toMatchObject({ status: 401 })
  expect(harness.rootLoad).toHaveBeenCalledTimes(2)
  await vi.waitFor(() => expect(harness.profile.isAuthenticated).toBe(true))
  expect(harness.profile.sessionExpired).toBe(false)
  await harness.settle()
  expect(harness.prompt()).toBeNull()
  expect(harness.expireCalls()).toEqual([])
})

it('does not treat a guest 401 as expiration or revalidate', async () => {
  const harness = await setup('guest')
  await harness.start()
  expect(harness.target.querySelector('[data-route="/initial"]')).not.toBeNull()
  expect(harness.profile.isAuthenticated).toBe(false)
  expect(harness.profile.sessionExpired).toBe(false)
  expect(harness.rootLoad).toHaveBeenCalledTimes(1)
  expect(harness.prompt()).toBeNull()
})

it('lets an awaited destination 401 render before revalidating that destination', async () => {
  const harness = await setup('authenticated', false)
  await harness.start()
  expect(harness.target.querySelector('[data-route="/initial"]')).not.toBeNull()
  expect(harness.prompt()).toBeNull()
  const initialRefreshes = harness.rootLoad.mock.calls.length
  await harness.router.goto('/protected')
  await harness.settle()
  expect(
    harness.target.querySelector('[data-route="/protected"]'),
  ).not.toBeNull()
  expect(harness.rootLoad).toHaveBeenCalledTimes(initialRefreshes + 1)
  expect(harness.prompt()).not.toBeNull()
})

it('delivers concurrent background 401 errors while navigation is held, then revalidates the completed destination once', async () => {
  const harness = await setup('authenticated', false)
  await harness.start()
  const beforeHeld = harness.rootLoad.mock.calls.length
  const navigation = harness.router.goto('/held')
  try {
    await harness.destinationEntered.promise
    const errors = await Promise.all([harness.failure(), harness.failure()])
    for (const error of errors)
      expect(error).toMatchObject({ status: 401, errorName: 'ExpiredToken' })
    expect(harness.profile.sessionExpired).toBe(true)
    expect(harness.rootLoad).toHaveBeenCalledTimes(beforeHeld)
    harness.destinationRelease.resolve()
    await navigation
    await harness.settle()
    expect(harness.target.querySelector('[data-route="/held"]')).not.toBeNull()
    expect(harness.rootLoad).toHaveBeenCalledTimes(beforeHeld + 1)
  } finally {
    harness.destinationRelease.resolve()
    await navigation.catch(() => undefined)
  }
})

it('revalidates on the replacement destination after a navigation is superseded', async () => {
  const harness = await setup('authenticated', false)
  await harness.start()
  expect(harness.target.querySelector('[data-route="/initial"]')).not.toBeNull()
  const beforeHeld = harness.rootLoad.mock.calls.length
  const olderNavigation = harness.router.goto('/held')
  await harness.destinationEntered.promise
  expect(await harness.failure()).toMatchObject({ status: 401 })
  await harness.router.goto('/replacement')
  harness.destinationRelease.resolve()
  await olderNavigation.catch(() => undefined)
  await harness.settle()
  expect(
    harness.target.querySelector('[data-route="/replacement"]'),
  ).not.toBeNull()
  expect(harness.rootLoad).toHaveBeenCalledTimes(beforeHeld + 1)
})

it('keeps a signed-in-only page mounted when focus revalidates after the dead cookie was deleted', async () => {
  const harness = await setup()
  await harness.start()
  await vi.waitFor(() =>
    expect(harness.profile.sessionExpirationConfirmed).toBe(true),
  )
  await vi.waitFor(() =>
    expect(harness.expireCalls()).toEqual([{ generation }]),
  )
  // The reader moves to a signed-in-only page while the prompt is open.
  await harness.router.goto('/account')
  await harness.settle()
  expect(harness.target.querySelector('[data-route="/account"]')).not.toBeNull()
  expect(harness.prompt()).not.toBeNull()
  // The deletion succeeded, so the next server check sees a plain guest.
  harness.state.cookieRemoved = true
  const refreshes = harness.rootLoad.mock.calls.length
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() =>
    expect(harness.rootLoad.mock.calls.length).toBeGreaterThan(refreshes),
  )
  await harness.settle()
  expect(harness.target.querySelector('[data-route="/account"]')).not.toBeNull()
  expect(harness.target.querySelector('[data-route="/login"]')).toBeNull()
  expect(harness.profile.sessionExpired).toBe(true)
  expect(harness.prompt()).not.toBeNull()
})
