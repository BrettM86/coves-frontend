// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isHttpError } from '@sveltejs/kit'

const boundary = vi.hoisted(() => ({
  environment: { browser: true, dev: false, building: false, version: 'test' },
  profile: {
    current: { instance: 'https://upstream.internal.example' },
    isAuthenticated: true,
    syncFromServer(session: { authenticated: boolean } | undefined) {
      boundary.profile.isAuthenticated = session?.authenticated === true
    },
  },
  invalidateAll: vi.fn<() => Promise<void>>(),
  afterNavigate: vi.fn<(callback: () => void) => void>(),
  error: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('$app/environment', () => boundary.environment)
vi.mock('$app/navigation', () => ({
  invalidateAll: boundary.invalidateAll,
  afterNavigate: boundary.afterNavigate,
}))
vi.mock('$app/state', () => import('./fixtures/RecoverySignals.svelte'))
const svelteClientEntry = async (): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  return import(
    /* @vite-ignore */ createRequire(import.meta.url)
      .resolve('svelte/package.json')
      .replace('package.json', 'src/index-client.js')
  )
}
vi.mock('svelte', () => svelteClientEntry())
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let svelte: typeof import('svelte')
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$lib/app/state/instance.svelte', () => ({
  DEFAULT_INSTANCE_URL: 'https://upstream.internal.example',
}))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile: boundary.profile }))
vi.mock('$lib/app/util/log', () => ({
  log: { error: boundary.error, warn: boundary.warn },
}))

type Wrapper = 'coves' | 'client'
const wrappers: Wrapper[] = ['coves', 'client']
const message = 'Expired session response with private account details'
const responseBody = JSON.stringify({ error: 'ExpiredToken', message })

function deferred() {
  let resolve = () => {}
  let reject = (_reason: unknown) => {}
  const promise = new Promise<void>((fulfill, fail) => {
    resolve = fulfill
    reject = fail
  })
  return { promise, resolve, reject }
}

async function setup(ready = true) {
  svelte = await import('svelte')
  const { page } = await import('./fixtures/RecoverySignals.svelte')
  page.data.session = { authenticated: boundary.profile.isAuthenticated }
  const Root = (await import('./fixtures/RecoveryInstaller.svelte')).default
  const target = document.createElement('div')
  document.body.append(target)
  mounted = svelte.mount(Root, { target })
  svelte.flushSync()
  if (ready)
    boundary.afterNavigate.mock.calls.forEach(([callback]) => callback())
  svelte.flushSync()
  const { coves, client } = await import('./client.svelte')
  const { XrpcError } = await import('./coves/xrpc')
  const transport = vi.fn<typeof fetch>()
  const respond = (status: number) => {
    transport.mockImplementation(
      async () =>
        new Response(status === 200 ? '{}' : responseBody, {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    )
  }
  respond(401)
  const request = (wrapper: Wrapper) =>
    wrapper === 'coves'
      ? coves({ func: transport }).getDiscover({ limit: 1 })
      : client({ func: transport }).getSite()
  const failure = (wrapper: Wrapper) =>
    request(wrapper).catch((error: unknown) => error)
  const expectOriginalError = (wrapper: Wrapper, error: unknown) => {
    if (wrapper === 'coves') {
      expect(error).toBeInstanceOf(XrpcError)
      expect(error).toMatchObject({
        status: 401,
        errorName: 'ExpiredToken',
        message,
      })
    } else {
      expect(isHttpError(error, 401)).toBe(true)
      expect(error).toMatchObject({ body: { message: responseBody } })
    }
  }
  return { request, failure, respond, transport, expectOriginalError }
}

beforeEach(() => {
  vi.resetModules()
  // Mock factories are cached separately from resetModules. Re-register the
  // browser entry and reactive signals so they share this test's runtime.
  vi.doMock('svelte', () => svelteClientEntry())
  vi.doMock('$app/state', () => import('./fixtures/RecoverySignals.svelte'))
  vi.clearAllMocks()
  boundary.environment.browser = true
  boundary.profile.isAuthenticated = true
  boundary.invalidateAll.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('__VERSION__', 'test')
})

afterEach(async () => {
  if (mounted) await svelte.unmount(mounted)
  mounted = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe.each(wrappers)(
  '%s session recovery through its public factory',
  (wrapper) => {
    it('starts session invalidation for an authenticated browser 401 without delaying the original error', async () => {
      const pending = deferred()
      boundary.invalidateAll.mockReturnValue(pending.promise)
      const api = await setup()
      try {
        api.expectOriginalError(wrapper, await api.failure(wrapper))
        expect(boundary.invalidateAll).toHaveBeenCalledTimes(1)
      } finally {
        pending.resolve()
      }
    })

    it.each([
      {
        name: 'anonymous browser 401',
        browser: true,
        authenticated: false,
        status: 401,
      },
      {
        name: 'authenticated server 401',
        browser: false,
        authenticated: true,
        status: 401,
      },
      { name: 'browser 403', browser: true, authenticated: true, status: 403 },
      { name: 'browser 500', browser: true, authenticated: true, status: 500 },
      {
        name: 'browser success',
        browser: true,
        authenticated: true,
        status: 200,
      },
    ])(
      'does not invalidate for $name',
      async ({ browser, authenticated, status }) => {
        boundary.environment.browser = browser
        boundary.profile.isAuthenticated = authenticated
        const api = await setup()
        api.respond(status)

        const result = await api.failure(wrapper)

        expect(api.transport).toHaveBeenCalledTimes(1)
        if (status === 200) expect(result).toEqual({})
        else expect(result).toMatchObject({ status })
        expect(boundary.invalidateAll).not.toHaveBeenCalled()
      },
    )

    it('reports a rejected invalidation safely and allows a later 401 to refresh again', async () => {
      const pending = deferred()
      boundary.invalidateAll.mockReturnValueOnce(pending.promise)
      const api = await setup()
      try {
        api.expectOriginalError(wrapper, await api.failure(wrapper))
        expect(boundary.invalidateAll).toHaveBeenCalledTimes(1)

        pending.reject(
          new Error('private-token-and-account: sealed-sensitive-credential'),
        )
        await pending.promise.catch(() => undefined)

        api.expectOriginalError(wrapper, await api.failure(wrapper))
        expect(boundary.invalidateAll).toHaveBeenCalledTimes(2)
        const diagnostics = [
          ...boundary.warn.mock.calls,
          ...boundary.error.mock.calls,
        ]
        expect(diagnostics).toHaveLength(1)
        expect(String(diagnostics[0][0])).toMatch(/invalidat|refresh/i)
        const text = diagnostics
          .flat()
          .map((value) =>
            value instanceof Error
              ? `${value.message} ${value.stack}`
              : JSON.stringify(value),
          )
          .join(' ')
        expect(text).not.toContain('sealed-sensitive-credential')
        expect(text).not.toContain('private-token-and-account')
        expect(text).not.toContain(message)
        expect(text).not.toContain(responseBody)
      } finally {
        pending.resolve()
      }
    })
  },
)

it('coalesces concurrent 401 responses across both public wrappers until invalidation finishes', async () => {
  const pending = deferred()
  boundary.invalidateAll.mockReturnValueOnce(pending.promise)
  const api = await setup()
  try {
    const failures = await Promise.all(wrappers.map(api.failure))
    wrappers.forEach((wrapper, index) =>
      api.expectOriginalError(wrapper, failures[index]),
    )
    expect(boundary.invalidateAll).toHaveBeenCalledTimes(1)

    api.expectOriginalError('coves', await api.failure('coves'))
    expect(boundary.invalidateAll).toHaveBeenCalledTimes(1)

    pending.resolve()
    await pending.promise
    api.expectOriginalError('client', await api.failure('client'))
    expect(boundary.invalidateAll).toHaveBeenCalledTimes(2)
  } finally {
    pending.resolve()
  }
})

it('allows a load started by invalidation to receive 401 without deadlocking or starting another refresh', async () => {
  const api = await setup()
  let nested: Promise<unknown> | undefined
  boundary.invalidateAll.mockImplementation(() => {
    nested = api.failure('client')
    return nested.then(() => undefined)
  })

  api.expectOriginalError('coves', await api.failure('coves'))
  expect(nested).toBeDefined()
  api.expectOriginalError('client', await nested)
  expect(api.transport).toHaveBeenCalledTimes(2)
  expect(boundary.invalidateAll).toHaveBeenCalledTimes(1)
})

describe('queued recovery lifecycle', () => {
  it('waits for initial afterNavigate readiness, then drains one queued request', async () => {
    await setup(false)
    const { requestSessionRecovery } =
      await import('$lib/app/state/session-recovery.svelte')
    requestSessionRecovery()
    requestSessionRecovery()
    svelte.flushSync()
    expect(boundary.invalidateAll).not.toHaveBeenCalled()
    boundary.afterNavigate.mock.calls.forEach(([callback]) => callback())
    svelte.flushSync()
    await svelte.tick()
    expect(boundary.invalidateAll).toHaveBeenCalledTimes(1)
  })

  it('keeps queued recovery through replacement navigations until the router is idle', async () => {
    await setup()
    const { navigating } = await import('./fixtures/RecoverySignals.svelte')
    const { requestSessionRecovery } =
      await import('$lib/app/state/session-recovery.svelte')
    navigating.to = { url: new URL('http://localhost/first') }
    svelte.flushSync()
    requestSessionRecovery()
    requestSessionRecovery()
    svelte.flushSync()
    navigating.to = { url: new URL('http://localhost/replacement') }
    boundary.afterNavigate.mock.calls.forEach(([callback]) => callback())
    svelte.flushSync()
    expect(boundary.invalidateAll).not.toHaveBeenCalled()
    navigating.to = null
    svelte.flushSync()
    await svelte.tick()
    expect(boundary.invalidateAll).toHaveBeenCalledTimes(1)
  })

  it('does not drain queued recovery after its root lifecycle is destroyed', async () => {
    await setup()
    const { navigating } = await import('./fixtures/RecoverySignals.svelte')
    const { requestSessionRecovery } =
      await import('$lib/app/state/session-recovery.svelte')
    navigating.to = { url: new URL('http://localhost/pending') }
    svelte.flushSync()
    requestSessionRecovery()
    svelte.flushSync()
    if (!mounted) throw new Error('Expected mounted lifecycle fixture')
    await svelte.unmount(mounted)
    mounted = undefined
    navigating.to = null
    requestSessionRecovery()
    svelte.flushSync()
    await svelte.tick()
    expect(boundary.invalidateAll).not.toHaveBeenCalled()
  })

  it('clears queued recovery when server session synchronization has already made the user a guest', async () => {
    await setup(false)
    const { page } = await import('./fixtures/RecoverySignals.svelte')
    const { requestSessionRecovery } =
      await import('$lib/app/state/session-recovery.svelte')
    requestSessionRecovery()
    page.data.session = undefined
    boundary.afterNavigate.mock.calls.forEach(([callback]) => callback())
    svelte.flushSync()
    await svelte.tick()
    expect(boundary.profile.isAuthenticated).toBe(false)
    expect(boundary.invalidateAll).not.toHaveBeenCalled()
    page.data.session = { authenticated: true }
    svelte.flushSync()
    await svelte.tick()
    expect(boundary.profile.isAuthenticated).toBe(true)
    expect(boundary.invalidateAll).not.toHaveBeenCalled()
    requestSessionRecovery()
    svelte.flushSync()
    await svelte.tick()
    expect(boundary.invalidateAll).toHaveBeenCalledTimes(1)
  })
})
