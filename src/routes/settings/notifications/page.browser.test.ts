// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('$app/navigation', () => ({
  invalidate: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
}))
const appState = vi.hoisted(() => ({
  page: {
    url: new URL('http://localhost/settings/notifications'),
    data: {},
    params: {},
    route: { id: '/settings/notifications' },
    status: 200,
    state: {},
  },
}))
vi.mock('$app/state', () => ({
  page: appState.page,
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
//
// The page drives the app-lifetime `notificationPreferences` singleton, so
// every test resets the module registry and imports svelte, the profile, the
// store and the page afresh: the page, the test and the store share one
// instance set. Resetting modules does not dispose effects, so the real stop
// from the first `start()` call and every profile instance's `mainEffect` are
// disposed after each test.
// ---------------------------------------------------------------------------

const nextGeneration = createGenerationFactory('page-generation')

const getPreferencesPath =
  '/api/proxy/xrpc/social.coves.notification.getPreferences'
const putPreferencesPath =
  '/api/proxy/xrpc/social.coves.notification.putPreferences'
const loginLink = '/login?redirect=%2Fsettings%2Fnotifications'

const allOn: NotificationPreferences = {
  postReply: true,
  commentReply: true,
  mention: true,
  upvote: true,
}

let svelte: typeof import('svelte')
let profile: (typeof import('$lib/app/state/auth.svelte'))['profile']
let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
/** Every profile instance imported this test; each one's effect is disposed. */
let profiles: (typeof profile)[]
/** What every `start()` call returned; only the first is the real stop. */
let stops: (() => void)[]

const fetchSpy = vi.fn<typeof fetch>()

const notificationFetch = createNotificationFetch()
const requests = notificationFetch.requests
const { signIn } = createSessionActions(
  () => ({ profile, svelte }),
  nextGeneration,
)

/** Every notification request sent so far, as `[method, path, body]`. */
const sent = () =>
  requests.map((request) => [request.method, request.path, request.body])

/**
 * Imports svelte, the profile and the store from the current module registry
 * and spies (calling through) on the singleton's `start()` to keep its stop.
 */
async function importInstances() {
  // `vi.resetModules()` keeps a mock factory's cached result, so the hoisted
  // svelte mocks would hand back the previous runtime while the components
  // load a fresh `svelte/internal/client` (`effect_orphan`). Re-register them.
  vi.doMock('svelte', () => svelteClientEntry('src/index-client.js'))
  vi.doMock('svelte/reactivity', () =>
    svelteClientEntry('src/reactivity/index-client.js'),
  )
  svelte = await import('svelte')
  profile = (await import('$lib/app/state/auth.svelte')).profile
  profiles.push(profile)
  const { notificationPreferences } =
    await import('$lib/feature/notification/preferences.svelte')
  const start = notificationPreferences.start
  vi.spyOn(notificationPreferences, 'start').mockImplementation(() => {
    const stop = start()
    stops.push(stop)
    return stop
  })
}

async function mountPage() {
  const Page = (await import('./+page.svelte')).default
  mounted = svelte.mount(Page, { target, intro: false })
  svelte.flushSync()
}

async function unmountPage() {
  if (mounted) await svelte.unmount(mounted, { outro: false })
  mounted = undefined
  svelte.flushSync()
}

/** Signs `account` in, mounts the page and answers its GET with `values`. */
async function mountLoaded(account: Account, values: NotificationPreferences) {
  signIn(account)
  notificationFetch.answer = (request) => request.resolve(json(200, values))
  await mountPage()
  await settle(svelte)
  notificationFetch.answer = undefined
}

const checkboxes = () => [
  ...target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
]

/** Every toggle the page shows, as `[label, checked]` in page order. */
const toggles = () =>
  checkboxes().map((input) => [
    input.closest('label')?.textContent?.trim(),
    input.checked,
  ])

/** The toggle whose label text is `label`; throws if the page shows none. */
function checkbox(label: string): HTMLInputElement {
  const input = checkboxes().find(
    (candidate) => candidate.closest('label')?.textContent?.trim() === label,
  )
  if (!input) throw new Error(`No checkbox labelled "${label}"`)
  return input
}

const spinner = () => target.querySelector('[role="status"]')

/** The text of every live status region the page shows. */
const statusTexts = () =>
  [...target.querySelectorAll('[role="status"]')].map((element) =>
    element.textContent?.trim(),
  )

const retryButton = () =>
  [...target.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Retry',
  )

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  vi.stubGlobal('__VERSION__', 'test')
  fetchSpy.mockReset().mockImplementation(notificationFetch.handle)
  vi.stubGlobal('fetch', fetchSpy)
  notificationLog.logNotificationFailure.mockReset()
  notificationFetch.reset()
  profiles = []
  stops = []
  await importInstances()
  profile.syncFromServer(undefined)
  svelte.flushSync()
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  await unmountPage()
  for (const stop of stops) stop()
  svelte.flushSync()
  for (const instance of profiles) instance.mainEffect()
  target.remove()
  vi.unstubAllGlobals()
  expect(notificationFetch.unexpectedUrls).toEqual([])
})

// ---------------------------------------------------------------------------
// Behaviors
// ---------------------------------------------------------------------------

describe('notification settings page', () => {
  it.each([
    {
      state: 'signed out at mount',
      arrange: async () => {
        profile.syncFromServer(undefined)
        svelte.flushSync()
        await mountPage()
        await settle(svelte)
      },
      expectedRequests: [],
    },
    {
      state: 'expired while mounted after a successful load',
      arrange: async () => {
        await mountLoaded(alice, allOn)
        expect(checkboxes(), 'the page loaded before the expiry').toHaveLength(
          4,
        )
        profile.expireSession(profile.sessionGeneration)
        svelte.flushSync()
        await settle(svelte)
      },
      expectedRequests: [['GET', getPreferencesPath, undefined]],
    },
  ])(
    'shows a login link and no toggle or spinner, sending no preference request, when $state',
    async ({ arrange, expectedRequests }) => {
      await arrange()

      expect(target.querySelector(`a[href="${loginLink}"]`)).not.toBeNull()
      expect(checkboxes()).toHaveLength(0)
      expect(spinner()).toBeNull()
      expect(sent()).toEqual(expectedRequests)
    },
  )

  it('shows a spinner and no toggle while the load is pending', async () => {
    signIn(alice)

    await mountPage()
    await settle(svelte)

    expect(spinner()).not.toBeNull()
    expect(statusTexts()).toContain('Loading notification settings…')
    expect(checkboxes()).toHaveLength(0)
    expect(sent()).toEqual([['GET', getPreferencesPath, undefined]])
  })

  it('sends exactly one GET when the profile was restored from storage before the session sync (hard load)', async () => {
    const generation = signIn(alice)
    // A hard load: the profile comes back authenticated from localStorage,
    // with no session generation until the root layout syncs the session.
    vi.resetModules()
    await importInstances()
    expect(profile.isAuthenticated).toBe(true)
    expect(profile.sessionGeneration).toBeUndefined()

    await mountPage()
    await settle(svelte)
    // What the root layout's effect does once its data arrives.
    profile.syncFromServer(session(alice, generation))
    svelte.flushSync()
    await settle(svelte)

    expect(sent()).toEqual([['GET', getPreferencesPath, undefined]])
  })

  it('shows the four toggles with their labels and the loaded values', async () => {
    await mountLoaded(alice, {
      postReply: true,
      commentReply: false,
      mention: true,
      upvote: false,
    })

    expect(toggles()).toEqual([
      ['Replies to your posts', true],
      ['Replies to your comments', false],
      ['Mentions', true],
      ['Likes', false],
    ])
    expect(spinner()).toBeNull()
  })

  it('shows the load error and a Retry button that loads again', async () => {
    signIn(alice)
    notificationFetch.answer = (request) =>
      request.resolve(json(500, { error: 'InternalServerError', message: 'x' }))
    await mountPage()
    await settle(svelte)
    notificationFetch.answer = undefined

    expect(target.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Could not load notification settings.',
    )
    const retry = retryButton()
    expect(retry).toBeDefined()
    expect(checkboxes()).toHaveLength(0)

    retry?.click()
    svelte.flushSync()
    await settle(svelte)

    expect(sent()).toEqual([
      ['GET', getPreferencesPath, undefined],
      ['GET', getPreferencesPath, undefined],
    ])
    requests[1].resolve(json(200, allOn))
    await settle(svelte)

    expect(toggles()).toEqual([
      ['Replies to your posts', true],
      ['Replies to your comments', true],
      ['Mentions', true],
      ['Likes', true],
    ])
  })

  const failure = () =>
    json(500, { error: 'InternalServerError', message: 'x' })

  /**
   * Signs `account` in, fails the first load, focuses Retry and presses it.
   * The retry GET (`requests[1]`) is held until the test answers it.
   */
  async function pressRetryAfterFailedLoad(account: Account) {
    signIn(account)
    notificationFetch.answer = (request) => request.resolve(failure())
    await mountPage()
    await settle(svelte)
    notificationFetch.answer = undefined
    const retry = retryButton()
    retry?.focus()
    expect(document.activeElement, 'Retry took focus').toBe(retry)

    retry?.click()
    svelte.flushSync()
    await settle(svelte)
    expect(sent()).toHaveLength(2)
  }

  const retryOutcomes = [
    {
      outcome: 'the first toggle when the retry loads',
      response: () => json(200, allOn),
      focused: () => checkbox('Replies to your posts'),
    },
    {
      outcome: 'the new Retry button when the retry fails again',
      response: failure,
      focused: retryButton,
    },
  ]

  it.each(retryOutcomes)(
    'moves keyboard focus from Retry to $outcome',
    async ({ response, focused }) => {
      await pressRetryAfterFailedLoad(alice)
      requests[1].resolve(response())
      await settle(svelte)

      const expected = focused()
      expect(expected).toBeDefined()
      expect(document.activeElement).toBe(expected)
    },
  )

  it.each(retryOutcomes)(
    'leaves focus where the user moved it during the retry instead of moving it to $outcome',
    async ({ response }) => {
      const elsewhere = document.createElement('button')
      document.body.appendChild(elsewhere)
      try {
        await pressRetryAfterFailedLoad(alice)
        elsewhere.focus()
        expect(document.activeElement, 'the user moved focus').toBe(elsewhere)

        requests[1].resolve(response())
        await settle(svelte)

        expect(document.activeElement).toBe(elsewhere)
      } finally {
        elsewhere.remove()
      }
    },
  )

  it.each(retryOutcomes)(
    'does not move focus to $outcome for the next account when the account switches during the retry',
    async ({ response }) => {
      await pressRetryAfterFailedLoad(alice)
      expect(document.activeElement, 'Retry unmounted').toBe(document.body)

      signIn(bob)
      await settle(svelte)
      expect(sent(), "bob's load went out").toHaveLength(3)
      requests[1].resolve(json(200, allOn))
      requests[2].resolve(response())
      await settle(svelte)

      expect(
        checkboxes().length + (retryButton() ? 1 : 0),
        "bob's load settled",
      ).toBeGreaterThan(0)
      expect(document.activeElement).toBe(document.body)
    },
  )

  it.each([
    { outcome: 'loads', response: () => json(200, allOn) },
    { outcome: 'fails', response: failure },
  ])(
    'does not move focus when the first load $outcome',
    async ({ response }) => {
      signIn(alice)
      notificationFetch.answer = (request) => request.resolve(response())
      await mountPage()
      await settle(svelte)
      notificationFetch.answer = undefined

      expect(
        checkboxes().length + (retryButton() ? 1 : 0),
        'the load settled',
      ).toBeGreaterThan(0)
      expect(document.activeElement).toBe(document.body)
    },
  )

  const switches = [
    { key: 'postReply', label: 'Replies to your posts' },
    { key: 'commentReply', label: 'Replies to your comments' },
    { key: 'mention', label: 'Mentions' },
    { key: 'upvote', label: 'Likes' },
  ] as const
  it.each(
    switches.flatMap(({ key, label }) =>
      [false, true].map((value) => ({
        key,
        label,
        value,
        action: value ? 'checks' : 'unchecks',
      })),
    ),
  )(
    '$action $label at once and sends one put with only its key',
    async ({ key, label, value }) => {
      // Every switch starts opposite to the value the click sets.
      await mountLoaded(alice, {
        postReply: !value,
        commentReply: !value,
        mention: !value,
        upvote: !value,
      })
      const expected = switches.map((entry) => [
        entry.label,
        entry.key === key ? value : !value,
      ])

      checkbox(label).click()
      svelte.flushSync()

      // Before any put response: the put is held until the test answers.
      expect(toggles()).toEqual(expected)
      await settle(svelte)
      expect(toggles()).toEqual(expected)
      expect(sent()).toEqual([
        ['GET', getPreferencesPath, undefined],
        ['POST', putPreferencesPath, { [key]: value }],
      ])
    },
  )

  it('keeps sending queued saves across an unmount and shows them when mounted again', async () => {
    await mountLoaded(alice, allOn)
    checkbox('Mentions').click()
    svelte.flushSync()
    await settle(svelte)
    checkbox('Likes').click()
    svelte.flushSync()
    await settle(svelte)
    expect(sent(), 'put 2 waits for put 1').toEqual([
      ['GET', getPreferencesPath, undefined],
      ['POST', putPreferencesPath, { mention: false }],
    ])

    await unmountPage()
    requests[1].resolve(
      json(200, {
        postReply: true,
        commentReply: true,
        mention: false,
        upvote: true,
      }),
    )
    await settle(svelte)

    expect(sent()).toEqual([
      ['GET', getPreferencesPath, undefined],
      ['POST', putPreferencesPath, { mention: false }],
      ['POST', putPreferencesPath, { upvote: false }],
    ])

    await mountPage()
    await settle(svelte)

    expect(toggles()).toEqual([
      ['Replies to your posts', true],
      ['Replies to your comments', true],
      ['Mentions', false],
      ['Likes', false],
    ])
    expect(sent()).toEqual([
      ['GET', getPreferencesPath, undefined],
      ['POST', putPreferencesPath, { mention: false }],
      ['POST', putPreferencesPath, { upvote: false }],
    ])
  })
})
