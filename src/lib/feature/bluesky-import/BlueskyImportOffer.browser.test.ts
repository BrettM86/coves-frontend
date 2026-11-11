// @vitest-environment jsdom
/**
 * The automatic offer mounted in the root layout: after sign-in, off the
 * sign-in, account and settings pages, it checks once and opens the dialog
 * only when the server says there is something to offer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { XrpcError } from '$lib/api/coves/xrpc'
import type { BlueskyProfileImportField } from '$lib/api/coves/types'
import { get } from 'svelte/store'
import { toasts } from '$lib/ui/kit/toast/toasts'

type PageState = { openModals?: string[] }
type Viewer =
  { type: 'guest' } | { type: 'authenticated'; did: string; handle: string }

const mocks = vi.hoisted(() => ({
  api: {
    getBlueskyProfileImport: vi.fn(),
    importBlueskyProfile: vi.fn(),
  },
  dismiss: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
  reactive: {
    read: (_key: 'state' | 'url' | 'viewer'): unknown => undefined,
    write: (_key: 'state' | 'url' | 'viewer', _value: unknown) => {},
  },
}))

function readState(): PageState {
  return (mocks.reactive.read('state') as PageState | undefined) ?? {}
}
function readViewer(): Viewer {
  return (
    (mocks.reactive.read('viewer') as Viewer | undefined) ?? { type: 'guest' }
  )
}

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({
  page: {
    get state() {
      return readState()
    },
    get url() {
      return mocks.reactive.read('url') as URL
    },
  },
}))
vi.mock('$app/navigation', () => ({
  invalidateAll: mocks.invalidateAll,
  invalidate: vi.fn(async () => {}),
  goto: vi.fn(async () => {}),
  pushState: (_url: string, state: PageState) =>
    mocks.reactive.write('state', state),
  replaceState: (_url: string, state: PageState) =>
    mocks.reactive.write('state', state),
}))
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: {
    get current() {
      return readViewer()
    },
    get isAuthenticated() {
      return readViewer().type === 'authenticated'
    },
    sessionExpired: false,
    meta: {},
  },
}))
vi.mock('$lib/api/client.svelte', () => ({
  coves: () => mocks.api,
  getClient: vi.fn(),
  site: { data: undefined },
}))
vi.mock('$lib/feature/bluesky-import/dismiss', () => ({
  dismissBlueskyProfileImport: mocks.dismiss,
}))
vi.mock('$lib/feature/feeds/feed.svelte', () => ({
  feeds: { clear: vi.fn() },
}))

const translate = (key: string) => key
vi.mock('$lib/app/state/i18n', () => ({
  t: {
    get: translate,
    subscribe: (run: (translator: typeof translate) => void) => {
      run(translate)
      return () => {}
    },
  },
  locale: {
    set: () => {},
    subscribe: (run: (locale: string) => void) => {
      run('en')
      return () => {}
    },
  },
}))

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
vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte/transition')>()),
  fade: () => ({ duration: 0 }),
  scale: () => ({ duration: 0 }),
}))
vi.mock('svelte-floating-ui', () => ({
  createFloatingActions: () => [
    () => ({ destroy: () => {} }),
    () => ({ update: () => {}, destroy: () => {} }),
  ],
}))
vi.mock('trap-focus-svelte', () => ({
  trapFocus: () => ({ destroy: () => {} }),
}))

const fields: BlueskyProfileImportField[] = [
  { field: 'displayName', bluesky: 'Alice', covesIsEmpty: false },
  { field: 'description', bluesky: 'Kites and tides', covesIsEmpty: true },
  {
    field: 'avatar',
    blueskyImageUrl:
      'http://localhost:3001/xrpc/com.atproto.sync.getBlob?did=did:plc:alice&cid=bafkreiavatar',
    covesIsEmpty: true,
  },
]

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')
let didCounter = 0
/** A DID unique to the test, so the once-per-session claim starts unclaimed. */
let did: string

beforeEach(async () => {
  client = await import('svelte')
  const { SvelteMap } = await import('svelte/reactivity')
  const values = new SvelteMap<string, unknown>([
    ['state', {}],
    ['url', new URL('http://localhost/')],
    ['viewer', { type: 'guest' }],
  ])
  mocks.reactive.read = (key) => values.get(key)
  mocks.reactive.write = (key, value) => {
    values.set(key, value)
  }
  vi.spyOn(window.history, 'back').mockImplementation(() =>
    mocks.reactive.write('state', {}),
  )
  try {
    sessionStorage.clear()
  } catch {
    // Storage may be unavailable; the claim then lives in memory.
  }
  didCounter++
  did = `did:plc:offer${didCounter}`
  mocks.api.getBlueskyProfileImport
    .mockReset()
    .mockResolvedValue({ status: 'offer', fields })
  mocks.api.importBlueskyProfile.mockReset()
  mocks.dismiss.mockClear()
  toasts.set([])
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  vi.restoreAllMocks()
})

async function settle() {
  for (let round = 0; round < 5; round++) {
    await client.tick()
    await Promise.resolve()
    client.flushSync()
  }
}

function signIn(): void {
  mocks.reactive.write('viewer', {
    type: 'authenticated',
    did,
    handle: 'alice.coves.social',
  })
}

function navigate(pathname: string): void {
  mocks.reactive.write('url', new URL(pathname, 'http://localhost'))
}

async function mountOffer(): Promise<void> {
  const Offer = (await import('./BlueskyImportOffer.svelte')).default
  mounted = client.mount(Offer, { target, intro: false })
  await settle()
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]')
}

describe('BlueskyImportOffer', () => {
  it('checks once after sign-in and offers only the fields empty on Coves', async () => {
    await mountOffer()
    expect(mocks.api.getBlueskyProfileImport).not.toHaveBeenCalled()

    signIn()
    await settle()

    await vi.waitFor(() =>
      expect(mocks.api.getBlueskyProfileImport).toHaveBeenCalledOnce(),
    )
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    expect(
      [
        ...(dialog()?.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"]',
        ) ?? []),
      ].map((box) => box.value),
    ).toEqual(['description', 'avatar'])

    navigate('/c/foo')
    await settle()
    expect(mocks.api.getBlueskyProfileImport).toHaveBeenCalledOnce()
  })

  it('waits on /profile/settings and checks once the user moves to an allowed page', async () => {
    navigate('/profile/settings')
    signIn()
    await mountOffer()
    expect(mocks.api.getBlueskyProfileImport).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()

    navigate('/')
    await settle()

    await vi.waitFor(() =>
      expect(mocks.api.getBlueskyProfileImport).toHaveBeenCalledOnce(),
    )
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
  })

  it.each(['noBlueskyProfile', 'nothingToImport', 'dismissed', 'complete'])(
    'shows nothing when the status is %s',
    async (status) => {
      mocks.api.getBlueskyProfileImport.mockResolvedValue({ status, fields })
      signIn()
      await mountOffer()

      await vi.waitFor(() =>
        expect(mocks.api.getBlueskyProfileImport).toHaveBeenCalledOnce(),
      )
      await settle()
      expect(dialog()).toBeNull()
    },
  )

  it('stays silent when the check fails and does not retry for the same DID', async () => {
    mocks.api.getBlueskyProfileImport.mockRejectedValue(
      new XrpcError(500, 'PDSError', 'unreachable'),
    )
    signIn()
    await mountOffer()

    await vi.waitFor(() =>
      expect(mocks.api.getBlueskyProfileImport).toHaveBeenCalledOnce(),
    )
    await settle()
    expect(dialog()).toBeNull()

    navigate('/c/foo')
    signIn()
    await settle()
    expect(mocks.api.getBlueskyProfileImport).toHaveBeenCalledOnce()
    expect(dialog()).toBeNull()
    expect(get(toasts)).toEqual([])
  })

  describe('when the viewer or page changes around the check', () => {
    function deferred<T>() {
      let resolve!: (value: T) => void
      const promise = new Promise<T>((settle) => {
        resolve = settle
      })
      return { promise, resolve }
    }

    function viewerChanges(): Record<string, () => void> {
      return {
        'signs out': () => mocks.reactive.write('viewer', { type: 'guest' }),
        'switches to another account': () =>
          mocks.reactive.write('viewer', {
            type: 'authenticated',
            did: `${did}other`,
            handle: 'bob.coves.social',
          }),
      }
    }

    it('opens no dialog when the user reached /profile/settings while the check was in flight', async () => {
      const check = deferred<{
        status: string
        fields: BlueskyProfileImportField[]
      }>()
      mocks.api.getBlueskyProfileImport.mockReturnValueOnce(check.promise)
      signIn()
      await mountOffer()
      await vi.waitFor(() =>
        expect(mocks.api.getBlueskyProfileImport).toHaveBeenCalledOnce(),
      )

      navigate('/profile/settings')
      await settle()
      check.resolve({ status: 'offer', fields })
      await settle()

      expect(dialog()).toBeNull()
    })

    it.each(['signs out', 'switches to another account'])(
      'opens no dialog for the old account when the viewer %s while the check was in flight',
      async (change) => {
        const check = deferred<{
          status: string
          fields: BlueskyProfileImportField[]
        }>()
        mocks.api.getBlueskyProfileImport
          .mockReturnValueOnce(check.promise)
          .mockResolvedValue({ status: 'complete', fields })
        signIn()
        await mountOffer()
        await vi.waitFor(() =>
          expect(mocks.api.getBlueskyProfileImport).toHaveBeenCalledOnce(),
        )

        viewerChanges()[change]?.()
        await settle()
        check.resolve({ status: 'offer', fields })
        await settle()

        expect(dialog()).toBeNull()
      },
    )

    it.each(['signs out', 'switches to another account'])(
      'closes an open offer without a dismissal when the viewer %s',
      async (change) => {
        mocks.api.getBlueskyProfileImport
          .mockResolvedValueOnce({ status: 'offer', fields })
          .mockResolvedValue({ status: 'complete', fields })
        signIn()
        await mountOffer()
        await vi.waitFor(() => expect(dialog()).not.toBeNull())

        viewerChanges()[change]?.()
        await settle()

        expect(dialog()).toBeNull()
        expect(mocks.dismiss).not.toHaveBeenCalled()
      },
    )
  })
})
