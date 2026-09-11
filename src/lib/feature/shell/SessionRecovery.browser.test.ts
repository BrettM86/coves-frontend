// @vitest-environment jsdom
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { ServerSession } from '$lib/app/state/auth.svelte'

vi.mock('$app/environment', () => ({
  browser: true,
  dev: true,
  building: false,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$lib/app/state/instance/env', () => ({
  DEFAULT_INSTANCE_URL: 'http://localhost:8081',
  LINKED_INSTANCE_URL: undefined,
}))
const navigation = vi.hoisted(() => ({
  invalidate: vi.fn(async (_dependency: string) => {}),
  goto: vi.fn(),
  afterNavigate: vi.fn<(callback: () => void) => void>(),
}))
vi.mock('$app/navigation', () => navigation)
vi.mock('$app/state', () => import('./fixtures/NavigationSignals.svelte'))
const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */ require_
      .resolve('svelte/package.json')
      .replace('package.json', subpath)
  )
}
vi.mock('svelte', () => svelteClientEntry('src/index-client.js'))
vi.mock('svelte/reactivity', () =>
  svelteClientEntry('src/reactivity/index-client.js'),
)

const session = (generation: string) =>
  ({
    authenticated: true,
    activeAccountId: 'did:plc:abcdefghijklmnopqrstuvwx',
    sessionGeneration: generation,
    account: {
      id: 'did:plc:abcdefghijklmnopqrstuvwx',
      did: 'did:plc:abcdefghijklmnopqrstuvwx',
      handle: 'alice.test',
      instance: 'http://localhost:8081',
    },
  }) as ServerSession

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let svelte: typeof import('svelte')
let profile: (typeof import('$lib/app/state/auth.svelte'))['profile']
let navigating: (typeof import('./fixtures/NavigationSignals.svelte'))['navigating']
let Component: (typeof import('./SessionRecovery.svelte'))['default']

/** Completes initial entry the way the router does once the page has rendered. */
function finishInitialNavigation() {
  navigation.afterNavigate.mock.calls.forEach(([callback]) => callback())
  svelte.flushSync()
}

async function mountRecovery() {
  if (mounted) await svelte.unmount(mounted, { outro: false })
  navigation.afterNavigate.mockClear()
  mounted = svelte.mount(Component, { target, intro: false })
  svelte.flushSync()
}

let generationSequence = 0
let initialGeneration: string

/** Stand-in for POST /api/auth/expire: 204 deleted, 409 replaced, 400 bad. */
let expireStatus: number
/** When set, the expire response waits until the test releases it. */
let expireRelease: Promise<void> | undefined
const expireCalls = () =>
  fetchMock.mock.calls
    .filter(([input]) => String(input) === '/api/auth/expire')
    .map(([, init]) => ({
      method: init?.method,
      body: JSON.parse(String(init?.body)) as { generation: string },
    }))
const expireSignals = () =>
  fetchMock.mock.calls
    .filter(([input]) => String(input) === '/api/auth/expire')
    .map(([, init]) => init?.signal ?? undefined)
const fetchMock = vi.fn<typeof fetch>(async (input) => {
  if (String(input) === '/api/auth/expire') {
    await expireRelease
    return new Response(null, { status: expireStatus })
  }
  throw new Error(`Unexpected fetch ${String(input)}`)
})
vi.stubGlobal('fetch', fetchMock)

async function settleFetches() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
  svelte.flushSync()
}

beforeEach(async () => {
  localStorage.clear()
  expireStatus = 204
  expireRelease = undefined
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  })
  fetchMock.mockClear()
  navigation.invalidate.mockReset().mockResolvedValue(undefined)
  navigation.goto.mockReset()
  navigation.afterNavigate.mockReset()
  svelte = await import('svelte')
  navigating = (await import('./fixtures/NavigationSignals.svelte')).navigating
  navigating.to = null
  profile = (await import('$lib/app/state/auth.svelte')).profile
  initialGeneration = `initial-generation-${++generationSequence}`
  profile.syncFromServer(session(initialGeneration))
  const { loadTranslations, locale } = await import('$lib/app/state/i18n')
  await loadTranslations('en')
  locale.set('en')
  Component = (await import('./SessionRecovery.svelte')).default
  target = document.createElement('div')
  document.body.appendChild(target)
  await mountRecovery()
  finishInitialNavigation()
})

afterEach(async () => {
  if (mounted) await svelte.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

afterAll(() => {
  profile.mainEffect()
})

function expire() {
  profile.expireSession(profile.sessionGeneration)
  svelte.flushSync()
}

describe('persistent session recovery', () => {
  it('renders one accessible persistent prompt, opening login separately so this page keeps its draft', async () => {
    expect(target.querySelector('[role=alert]')).toBeNull()
    expire()
    const prompt = target.querySelector('[role=alert]')
    expect(prompt).not.toBeNull()
    expect(prompt?.textContent).toMatch(/session.*expired/i)
    const link = prompt?.querySelector('a')
    expect(link?.textContent).toMatch(/log in|sign in/i)
    expect(link?.getAttribute('href')).toMatch(/^\/login(?:\?|$)/)
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.rel.split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer']),
    )
    expect(navigation.goto).not.toHaveBeenCalled()
    // The existing toast disappears after its timer; this prompt remains mounted.
    vi.useFakeTimers()
    try {
      await vi.advanceTimersByTimeAsync(60000)
      expect(target.querySelector('[role=alert]')).toBe(prompt)
    } finally {
      vi.useRealTimers()
    }
  })

  it('displays expiration discovered by root server validation without checking again, and expires the dead cookie once', async () => {
    profile.syncFromServer(undefined, {
      sessionGeneration: initialGeneration,
      sessionExpired: true,
    })
    svelte.flushSync()
    expect(target.querySelector('[role=alert]')?.textContent).toMatch(
      /session.*expired/i,
    )
    // The server's own session check already gave the verdict.
    expect(navigation.invalidate).not.toHaveBeenCalled()
    await settleFetches()
    expect(expireCalls()).toEqual([
      { method: 'POST', body: { generation: initialGeneration } },
    ])
    // The same confirmed generation is not expired twice.
    profile.syncFromServer(undefined, {
      sessionGeneration: initialGeneration,
      sessionExpired: true,
    })
    svelte.flushSync()
    await settleFetches()
    expect(expireCalls()).toHaveLength(1)
    // Focus still retries, so a login from another tab is picked up.
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() =>
      expect(navigation.invalidate).toHaveBeenCalledExactlyOnceWith(
        'app:session',
      ),
    )
  })

  it('a client-side 401 is a suspicion: the revalidation verdict can restore the same generation', async () => {
    expire()
    await Promise.resolve()
    expect(navigation.invalidate).toHaveBeenCalledExactlyOnceWith('app:session')
    profile.syncFromServer(session(initialGeneration))
    svelte.flushSync()
    expect(profile.isAuthenticated).toBe(true)
    expect(target.querySelector('[role=alert]')).toBeNull()
    expect(expireCalls()).toHaveLength(0)
  })

  it('holds automatic cookie expiration while the tab is hidden and sends it once it is visible', async () => {
    // A hidden tab has no reader watching for the prompt, and another tab is
    // the likely place a new login lands. Sending the deletion from here
    // widens the window in which it can remove that login's cookie.
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    profile.syncFromServer(undefined, {
      sessionGeneration: initialGeneration,
      sessionExpired: true,
    })
    svelte.flushSync()
    await settleFetches()
    expect(expireCalls()).toHaveLength(0)
    expect(target.querySelector('[role=alert]')).not.toBeNull()
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    svelte.flushSync()
    await settleFetches()
    expect(expireCalls()).toEqual([
      { method: 'POST', body: { generation: initialGeneration } },
    ])
  })

  it('a replacement login arriving before the 204 aborts the deletion and re-syncs that login', async () => {
    // Response order: the deletion request leaves under the dead generation,
    // another tab logs in and this tab adopts it, then the 204 lands. The
    // Set-Cookie on that 204 may have removed the new login's cookie, so the
    // session is checked again right away.
    let release = () => {}
    expireRelease = new Promise<void>((fulfill) => {
      release = fulfill
    })
    profile.syncFromServer(undefined, {
      sessionGeneration: initialGeneration,
      sessionExpired: true,
    })
    svelte.flushSync()
    await settleFetches()
    expect(expireCalls()).toEqual([
      { method: 'POST', body: { generation: initialGeneration } },
    ])
    const [signal] = expireSignals()
    expect(signal?.aborted).toBe(false)
    navigation.invalidate.mockClear()
    profile.syncFromServer(session(`${initialGeneration}-replacement`))
    svelte.flushSync()
    expect(signal?.aborted).toBe(true)
    expect(target.querySelector('[role=alert]')).toBeNull()
    release()
    await settleFetches()
    await vi.waitFor(() =>
      expect(navigation.invalidate).toHaveBeenCalledExactlyOnceWith(
        'app:session',
      ),
    )
  })

  it('a verdict confirming a client-side 401 expires the dead cookie', async () => {
    expire()
    await Promise.resolve()
    expect(expireCalls()).toHaveLength(0)
    profile.syncFromServer(undefined, {
      sessionGeneration: initialGeneration,
      sessionExpired: true,
    })
    svelte.flushSync()
    await settleFetches()
    expect(expireCalls()).toEqual([
      { method: 'POST', body: { generation: initialGeneration } },
    ])
    expect(target.querySelector('[role=alert]')).not.toBeNull()
  })

  it('dismissing expires the cookie for this generation and hides the prompt', async () => {
    expire()
    const button = target.querySelector('[role=alert] button')
    expect(button?.textContent).toMatch(/dismiss/i)
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settleFetches()
    expect(expireCalls()).toEqual([
      { method: 'POST', body: { generation: initialGeneration } },
    ])
    expect(target.querySelector('[role=alert]')).toBeNull()
    expect(profile.isAuthenticated).toBe(false)
    // Hidden, not resolved: open drafts still belong to an expired session.
    expect(profile.sessionExpired).toBe(true)
    expect(profile.sessionExpirationDismissed).toBe(true)
  })

  it('a dismissed tab still adopts a login made elsewhere on focus', async () => {
    expire()
    target
      .querySelector('[role=alert] button')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settleFetches()
    expect(target.querySelector('[role=alert]')).toBeNull()
    navigation.invalidate.mockClear()
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() =>
      expect(navigation.invalidate).toHaveBeenCalledExactlyOnceWith(
        'app:session',
      ),
    )
    profile.syncFromServer(session(`${initialGeneration}-replacement`))
    svelte.flushSync()
    expect(profile.isAuthenticated).toBe(true)
    expect(profile.sessionExpired).toBe(false)
    expect(profile.sessionExpirationDismissed).toBe(false)
    expect(target.querySelector('[role=alert]')).toBeNull()
  })

  it('dismissing when a newer login owns the cookie adopts that login', async () => {
    expireStatus = 409
    expire()
    await Promise.resolve()
    navigation.invalidate.mockClear()
    target
      .querySelector('[role=alert] button')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settleFetches()
    expect(target.querySelector('[role=alert]')).toBeNull()
    await vi.waitFor(() =>
      expect(navigation.invalidate).toHaveBeenCalledExactlyOnceWith(
        'app:session',
      ),
    )
  })

  it('a replacement login arriving before the dismiss 204 re-syncs that login', async () => {
    let release = () => {}
    expireRelease = new Promise<void>((fulfill) => {
      release = fulfill
    })
    expire()
    await Promise.resolve()
    navigation.invalidate.mockClear()
    target
      .querySelector('[role=alert] button')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settleFetches()
    expect(expireCalls()).toHaveLength(1)
    profile.syncFromServer(session(`${initialGeneration}-replacement`))
    svelte.flushSync()
    expect(profile.isAuthenticated).toBe(true)
    release()
    await settleFetches()
    await vi.waitFor(() =>
      expect(navigation.invalidate).toHaveBeenCalledExactlyOnceWith(
        'app:session',
      ),
    )
  })

  it('dismissing still hides the prompt when the expire request fails', async () => {
    expireStatus = 400
    expire()
    target
      .querySelector('[role=alert] button')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settleFetches()
    expect(expireCalls()).toHaveLength(1)
    expect(target.querySelector('[role=alert]')).toBeNull()
  })

  it('immediately invalidates root session data once for concurrent expiration reports', () => {
    const generation = profile.sessionGeneration
    profile.expireSession(generation)
    profile.expireSession(generation)
    svelte.flushSync()
    expect(navigation.invalidate).toHaveBeenCalledExactlyOnceWith('app:session')
    expect(target.querySelectorAll('[role=alert]')).toHaveLength(1)
  })

  it('revalidates on focus only while expired and removes the prompt after a newer login', async () => {
    window.dispatchEvent(new Event('focus'))
    expect(navigation.invalidate).not.toHaveBeenCalled()
    expire()
    await Promise.resolve()
    navigation.invalidate.mockClear()
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() =>
      expect(navigation.invalidate).toHaveBeenCalledExactlyOnceWith(
        'app:session',
      ),
    )
    profile.syncFromServer(session(`${initialGeneration}-replacement`))
    svelte.flushSync()
    expect(target.querySelector('[role=alert]')).toBeNull()
    navigation.invalidate.mockClear()
    window.dispatchEvent(new Event('focus'))
    expect(navigation.invalidate).not.toHaveBeenCalled()
  })

  it('a failed revalidation leaves the expired prompt and allows a later focus retry', async () => {
    navigation.invalidate.mockRejectedValueOnce(
      new TypeError('Local app unavailable'),
    )
    expire()
    await Promise.resolve()
    await Promise.resolve()
    expect(profile.sessionExpired).toBe(true)
    expect(target.querySelector('[role=alert]')).not.toBeNull()
    navigation.invalidate.mockClear()
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() =>
      expect(navigation.invalidate).toHaveBeenCalledWith('app:session'),
    )
    expect(navigation.goto).not.toHaveBeenCalled()
  })

  it('shows the prompt at once but revalidates only after initial entry has rendered', async () => {
    await mountRecovery()
    expire()
    expect(target.querySelector('[role=alert]')).not.toBeNull()
    expect(navigation.invalidate).not.toHaveBeenCalled()
    finishInitialNavigation()
    expect(navigation.invalidate).toHaveBeenCalledExactlyOnceWith('app:session')
  })

  it('holds revalidation and focus retries while a navigation is in flight, then revalidates once', () => {
    navigating.to = { url: new URL('http://localhost/held') }
    svelte.flushSync()
    expire()
    window.dispatchEvent(new Event('focus'))
    expect(target.querySelector('[role=alert]')).not.toBeNull()
    expect(navigation.invalidate).not.toHaveBeenCalled()
    navigating.to = { url: new URL('http://localhost/replacement') }
    svelte.flushSync()
    expect(navigation.invalidate).not.toHaveBeenCalled()
    navigating.to = null
    svelte.flushSync()
    expect(navigation.invalidate).toHaveBeenCalledExactlyOnceWith('app:session')
    // Later navigations while still expired do not reload the session again.
    navigating.to = { url: new URL('http://localhost/next') }
    svelte.flushSync()
    navigating.to = null
    svelte.flushSync()
    expect(navigation.invalidate).toHaveBeenCalledTimes(1)
  })
})
