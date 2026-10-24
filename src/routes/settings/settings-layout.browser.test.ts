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
    url: new URL('http://localhost/settings/app'),
    data: {},
    params: {},
    route: { id: '/settings/app' },
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

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const alice = {
  did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa',
  handle: 'alice.test',
}

const session = (generation: string) =>
  ({
    authenticated: true,
    activeAccountId: alice.did,
    sessionGeneration: generation,
    account: {
      id: alice.did,
      did: alice.did,
      handle: alice.handle,
      instance: 'http://localhost:8081',
    },
  }) as ServerSession

// The profile is module state and retired generations never come back, so
// every login uses a fresh one.
let generationSequence = 0
const nextGeneration = () => `layout-generation-${++generationSequence}`

let svelte: typeof import('svelte')
let profile: (typeof import('$lib/app/state/auth.svelte'))['profile']
let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined

function signIn() {
  profile.syncFromServer(session(nextGeneration()))
  svelte.flushSync()
}

async function mountLayout() {
  const Layout = (await import('./+layout.svelte')).default
  mounted = svelte.mount(Layout, {
    target,
    intro: false,
    props: {
      children: svelte.createRawSnippet(() => ({
        render: () => '<span></span>',
      })),
    },
  })
  svelte.flushSync()
}

/** Every tab link the layout rendered, as `[name, href]`. */
const tabLinks = () =>
  [...target.querySelectorAll('nav a')].map((link) => [
    link.textContent?.trim(),
    link.getAttribute('href'),
  ])

beforeEach(async () => {
  localStorage.clear()
  vi.stubGlobal('__VERSION__', 'test')
  svelte = await import('svelte')
  profile = (await import('$lib/app/state/auth.svelte')).profile
  profile.syncFromServer(undefined)
  svelte.flushSync()
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await svelte.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  profile.syncFromServer(undefined)
  svelte.flushSync()
  vi.unstubAllGlobals()
})

afterAll(() => {
  profile.mainEffect()
})

// ---------------------------------------------------------------------------
// Behaviors
// ---------------------------------------------------------------------------

describe('settings layout notifications tab', () => {
  it('shows a Notifications tab linking to /settings/notifications alongside the existing tabs when signed in', async () => {
    signIn()

    await mountLayout()

    const links = tabLinks()
    expect(links).toEqual(
      expect.arrayContaining([
        ['App', '/settings/app'],
        ['Embeds', '/settings/embeds'],
        ['Notifications', '/settings/notifications'],
      ]),
    )
    expect(
      links.filter(([, href]) => href === '/settings/notifications'),
    ).toEqual([['Notifications', '/settings/notifications']])
  })

  it.each([
    {
      state: 'signed out',
      arrange: async () => {
        profile.syncFromServer(undefined)
        svelte.flushSync()
        await mountLayout()
      },
    },
    {
      state: 'signed in, then expired while the layout is mounted',
      arrange: async () => {
        signIn()
        await mountLayout()
        profile.expireSession(profile.sessionGeneration)
        svelte.flushSync()
      },
    },
  ])(
    'has no link to /settings/notifications when $state',
    async ({ arrange }) => {
      await arrange()

      // The layout rendered its tabs, so the absence below is not vacuous.
      expect(target.querySelector('nav a[href="/settings/app"]')).not.toBeNull()
      expect(
        target.querySelector('a[href="/settings/notifications"]'),
      ).toBeNull()
    },
  )
})
