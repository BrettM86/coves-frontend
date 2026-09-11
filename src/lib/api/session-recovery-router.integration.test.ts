// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({
  profile: {
    current: { instance: 'https://upstream.internal.example' },
    isAuthenticated: true,
    syncFromServer(session: { authenticated: boolean } | undefined) {
      boundary.profile.isAuthenticated = session?.authenticated === true
    },
  },
}))
vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: false,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$lib/app/state/instance.svelte', () => ({
  DEFAULT_INSTANCE_URL: 'https://upstream.internal.example',
}))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile: boundary.profile }))
const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  return import(
    /* @vite-ignore */ createRequire(import.meta.url)
      .resolve('svelte/package.json')
      .replace('package.json', subpath)
  )
}
vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))
const kitClientState = async () => {
  const { createRequire } = await import('node:module')
  const path = createRequire(import.meta.url)
    .resolve('@sveltejs/kit/package.json')
    .replace('package.json', 'src/runtime/app/state/client.js')
  return import(/* @vite-ignore */ path)
}

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
  // Keep per-scenario Kit isolation while refreshing cached browser mocks.
  vi.doMock('svelte', () => svelteClientEntry('src/index-client.js'))
  vi.doMock('$app/state', kitClientState)
  boundary.profile.isAuthenticated = true
})
afterEach(() => {
  destroyRoot()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

// Real installed Kit router. Manifest, shell and API responses are integration
// fixtures; production recovery lifecycle and fetch wrappers run unchanged.
async function setup(
  initial: 'authenticated' | 'guest' = 'authenticated',
  initialUnauthorized = true,
) {
  vi.stubGlobal('__VERSION__', 'test')
  vi.stubGlobal('__SVELTEKIT_PAYLOAD__', {})
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    },
  )
  history.replaceState({}, '', '/initial')
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({ error: 'ExpiredToken', message: 'Session expired' }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
  )
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
  const Root = (await import('./fixtures/RecoveryRoot.svelte')).default
  const RootClass = asClassComponent(Root)
  const { coves } = await import('./client.svelte')
  const { flushSync, tick } = await import('svelte')
  const sessionAuthenticated = initial === 'authenticated'
  const rootLoad = vi.fn(() => ({
    session: { authenticated: sessionAuthenticated },
  }))
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
    ],
    server_loads: [],
    dictionary: {
      '/initial': [2, []],
      '/protected': [2, []],
      '/held': [3, []],
      '/replacement': [4, []],
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
    transport,
    rootLoad,
    failure,
    destinationEntered,
    destinationRelease,
    receivedError: () => receivedError,
    settle,
    start: async () => {
      await router.start(app, target)
      await settle()
    },
  }
}

it('finishes initial entry then performs one recovery using the production lifecycle', async () => {
  const harness = await setup()
  await harness.start()
  expect(harness.receivedError()).toMatchObject({
    status: 401,
    errorName: 'ExpiredToken',
  })
  expect(harness.target.querySelector('[data-route="/initial"]')).not.toBeNull()
  expect(harness.rootLoad).toHaveBeenCalledTimes(2)
})

it('synchronizes an initial guest session before draining the queued stale-profile 401', async () => {
  const harness = await setup('guest')
  await harness.start()
  expect(harness.target.querySelector('[data-route="/initial"]')).not.toBeNull()
  expect(boundary.profile.isAuthenticated).toBe(false)
  expect(harness.rootLoad).toHaveBeenCalledTimes(1)
})

it('lets an awaited destination 401 render before refreshing that destination', async () => {
  const harness = await setup('authenticated', false)
  await harness.start()
  expect(harness.target.querySelector('[data-route="/initial"]')).not.toBeNull()
  const initialRefreshes = harness.rootLoad.mock.calls.length
  await harness.router.goto('/protected')
  await harness.settle()
  expect(
    harness.target.querySelector('[data-route="/protected"]'),
  ).not.toBeNull()
  expect(harness.rootLoad).toHaveBeenCalledTimes(initialRefreshes + 1)
})

it('delivers concurrent background 401 errors while navigation is held, then refreshes the completed destination once', async () => {
  const harness = await setup('authenticated', false)
  await harness.start()
  const beforeHeld = harness.rootLoad.mock.calls.length
  const navigation = harness.router.goto('/held')
  try {
    await harness.destinationEntered.promise
    const errors = await Promise.all([harness.failure(), harness.failure()])
    for (const error of errors)
      expect(error).toMatchObject({ status: 401, errorName: 'ExpiredToken' })
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

it('recovers on the replacement destination after a navigation is superseded', async () => {
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
