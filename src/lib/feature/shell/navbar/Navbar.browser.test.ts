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
import {
  alice,
  accessibleName,
  createNotificationFetch,
  json,
  session,
  settle,
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
vi.mock('$lib/feature/notification/log', () => ({
  logNotificationFailure: vi.fn(),
}))

let svelte: typeof import('svelte')
let profile: (typeof import('$lib/app/state/auth.svelte'))['profile']
let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
/** The real stop from the unread singleton's first `start()`, if started. */
let stopUnread: (() => void) | undefined

const notificationFetch = createNotificationFetch()
const fetchSpy = vi.fn<typeof fetch>()

beforeEach(async () => {
  localStorage.clear()
  vi.stubGlobal('__VERSION__', 'test')
  fetchSpy.mockReset().mockImplementation(notificationFetch.handle)
  vi.stubGlobal('fetch', fetchSpy)
  notificationFetch.reset()
  svelte = await import('svelte')
  profile = (await import('$lib/app/state/auth.svelte')).profile
  profile.syncFromServer(undefined)
  svelte.flushSync()
  const { loadTranslations, locale } = await import('$lib/app/state/i18n')
  await loadTranslations('en')
  locale.set('en')
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await svelte.unmount(mounted, { outro: false })
  mounted = undefined
  stopUnread?.()
  stopUnread = undefined
  svelte.flushSync()
  target.remove()
  expect(notificationFetch.unexpectedUrls).toEqual([])
})

afterAll(() => {
  profile.mainEffect()
})

async function mountNavbar() {
  const Navbar = (await import('./Navbar.svelte')).default
  mounted = svelte.mount(Navbar, { target, intro: false })
  svelte.flushSync()
}

/** The bell link; throws when the navbar renders none. */
function bellLink(): HTMLAnchorElement {
  const link = target.querySelector<HTMLAnchorElement>(
    'a[href="/notifications"]',
  )
  if (!link) throw new Error('No bell link to /notifications')
  return link
}

const badge = () => target.querySelector('[data-part="badge"]')

describe('navbar notification bell', () => {
  it('shows the bell between Create and the profile menu with the unread count when signed in', async () => {
    profile.syncFromServer(session(alice, 'g1'), {
      sessionGeneration: 'g1',
      sessionExpired: false,
    })
    svelte.flushSync()
    const { unreadNotifications } =
      await import('$lib/feature/notification/unread.svelte')
    notificationFetch.answer = (request) =>
      request.resolve(json(200, { count: 7 }))
    stopUnread = unreadNotifications.start()
    await mountNavbar()
    await settle(svelte)

    const bell = bellLink()
    expect(bell.getAttribute('title')).toBe('Notifications')
    expect(bell.querySelector('svg.lucide-bell')).not.toBeNull()
    expect(bell.classList.contains('order-3')).toBe(true)

    const create = target.querySelector('a[href="/create"]')
    const profileMenu = target.querySelector('button[title="Profile"]')
    if (!create || !profileMenu)
      throw new Error('Missing Create link or profile menu button')
    expect(create.classList.contains('order-2')).toBe(true)
    expect(profileMenu.classList.contains('order-4')).toBe(true)
    expect(
      create.compareDocumentPosition(bell) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      bell.compareDocumentPosition(profileMenu) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    expect(badge()?.textContent?.trim()).toBe('7')
    expect(accessibleName(bell)).toBe('Notifications, 7 unread')
  })

  it('shows the bell without a badge when signed out', async () => {
    await mountNavbar()
    await settle(svelte)

    expect(bellLink().getAttribute('href')).toBe('/notifications')
    expect(badge()).toBeNull()
    expect(notificationFetch.requests).toEqual([])
  })
})
