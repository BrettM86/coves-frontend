// @vitest-environment jsdom
/**
 * The "Import from Bluesky" button on /profile/settings: a short message
 * when there is nothing to bring over, otherwise the dialog with every field;
 * after an import the editor reseeds from the reloaded profile.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { XrpcError } from '$lib/api/coves/xrpc'
import type {
  BlueskyProfileImportField,
  ProfileViewDetailed,
} from '$lib/api/coves/types'
import type { DID, Handle, InstanceURL } from '$lib/types/atproto'
import { toasts } from '$lib/ui/kit/toast/toasts'
import type { PageData } from './$types'

type PageState = { openModals?: string[] }

const mocks = vi.hoisted(() => ({
  api: {
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    getBlueskyProfileImport: vi.fn(),
    importBlueskyProfile: vi.fn(),
  },
  dismiss: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
  invalidate: vi.fn(async () => {}),
  clearFeeds: vi.fn(),
  reactive: {
    read: (_key: 'state' | 'data'): unknown => undefined,
    write: (_key: 'state' | 'data', _value: unknown) => {},
  },
  profile: {
    meta: {},
    current: {
      type: 'authenticated',
      did: 'did:plc:alice',
      handle: 'alice.coves.social',
      jwt: 'authenticated',
    },
    isAuthenticated: true,
    sessionExpired: false,
  },
}))

function readState(): PageState {
  return (mocks.reactive.read('state') as PageState | undefined) ?? {}
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
    url: new URL('http://localhost/profile/settings'),
  },
}))
vi.mock('$app/navigation', () => ({
  invalidateAll: mocks.invalidateAll,
  invalidate: mocks.invalidate,
  goto: vi.fn(async () => {}),
  pushState: (_url: string, state: PageState) =>
    mocks.reactive.write('state', state),
  replaceState: (_url: string, state: PageState) =>
    mocks.reactive.write('state', state),
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
  feeds: { clear: mocks.clearFeeds },
}))
vi.mock('$lib/app/state/auth.svelte', () => ({ profile: mocks.profile }))

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

const existingProfile: ProfileViewDetailed = {
  did: 'did:plc:alice' as DID,
  handle: 'alice.coves.social' as Handle,
  createdAt: '2026-09-01T00:00:00Z',
  displayName: 'Alice Example',
  description: 'Existing bio',
}

const reloadedProfile: ProfileViewDetailed = {
  ...existingProfile,
  description: 'Kites and tides',
  avatar: 'https://cdn.coves.test/alice-from-bluesky.jpg',
}

const parentData = {
  lang: 'en',
  sessionExpired: false,
  sessionGeneration: undefined,
  authError: null,
  my_user: undefined,
  session: {
    authenticated: true as const,
    activeAccountId: 'did:plc:alice',
    account: {
      id: 'did:plc:alice',
      did: 'did:plc:alice' as DID,
      handle: 'alice.coves.social' as Handle,
      instance: 'https://coves.test' as InstanceURL,
    },
  },
}

const fields: BlueskyProfileImportField[] = [
  { field: 'displayName', bluesky: 'Alice', covesIsEmpty: false },
  { field: 'description', bluesky: 'Kites and tides', covesIsEmpty: false },
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

beforeEach(async () => {
  client = await import('svelte')
  const { SvelteMap } = await import('svelte/reactivity')
  const values = new SvelteMap<string, unknown>([['state', {}]])
  mocks.reactive.read = (key) => values.get(key)
  mocks.reactive.write = (key, value) => {
    values.set(key, value)
  }
  vi.spyOn(window.history, 'back').mockImplementation(() =>
    mocks.reactive.write('state', {}),
  )
  mocks.api.getProfile.mockReset().mockResolvedValue(reloadedProfile)
  mocks.api.updateProfile.mockReset().mockResolvedValue({
    uri: 'at://did:plc:alice/social.coves.actor.profile/self',
    cid: 'bafyprofile',
  })
  mocks.api.getBlueskyProfileImport
    .mockReset()
    .mockResolvedValue({ status: 'dismissed', fields })
  mocks.api.importBlueskyProfile.mockReset().mockResolvedValue({
    uri: 'at://did:plc:alice/social.coves.actor.profile/self',
    cid: 'bafyimported',
    imported: ['description', 'avatar'],
  })
  mocks.dismiss.mockClear()
  mocks.invalidateAll.mockClear()
  mocks.invalidate.mockClear()
  mocks.clearFeeds.mockClear()
  toasts.set([])
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  toasts.set([])
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

/** Mounts the settings page once; later data arrives through its data prop. */
async function mountPage(profile: ProfileViewDetailed): Promise<void> {
  mocks.reactive.write('data', { ...parentData, profile })
  const Page = (await import('./+page.svelte')).default
  mounted = client.mount(Page, {
    target,
    intro: false,
    props: {
      get data() {
        return mocks.reactive.read('data') as PageData
      },
    },
  })
  await settle()
}

function reloadPageData(profile: ProfileViewDetailed): void {
  mocks.reactive.write('data', { ...parentData, profile })
}

function buttonIn(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

function importButton(): HTMLButtonElement {
  return buttonIn(target, 'form.profile.importFromBluesky')
}

function importDialog(): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
      (candidate) => candidate.querySelector('input[type="checkbox"]') !== null,
    ) ?? null
  )
}

function dialogCheckboxes(): HTMLInputElement[] {
  return [
    ...(importDialog()?.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    ) ?? []),
  ]
}

/** A short message reaches the user as a toast or as text on the page. */
function messageShown(key: string): boolean {
  return (
    get(toasts).some((entry) => entry.content === key) ||
    (document.body.textContent ?? '').includes(key)
  )
}

function bio(): HTMLTextAreaElement {
  const element = target.querySelector<HTMLTextAreaElement>('#profile-bio')
  if (!element) throw new Error('Missing bio textarea')
  return element
}

function saveButton(): HTMLButtonElement {
  const button = target.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )
  if (!button) throw new Error('Missing Save button')
  return button
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

/**
 * Edits the bio, stages an avatar, and imports the description and avatar;
 * returns once the import request has resolved and the refresh has begun.
 */
async function editThenImport(): Promise<void> {
  const bioInput = bio()
  bioInput.value = 'Half-typed bio'
  bioInput.dispatchEvent(new Event('input', { bubbles: true }))
  const avatar = target.querySelector<HTMLInputElement>('#profile-avatar')
  if (!avatar) throw new Error('Missing avatar input')
  const file = new File(['avatar'], 'staged.png', { type: 'image/png' })
  Object.defineProperty(avatar, 'files', { value: [file] })
  avatar.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()

  importButton().click()
  await vi.waitFor(() => expect(importDialog()).not.toBeNull())
  const description = dialogCheckboxes().find(
    (box) => box.value === 'description',
  )
  if (!description) throw new Error('Missing description checkbox')
  description.click()
  await settle()
  const dialog = importDialog()
  if (!dialog) throw new Error('The import dialog closed early')
  buttonIn(dialog, 'form.profile.blueskyImport.importProfile').click()

  await vi.waitFor(() =>
    expect(mocks.api.importBlueskyProfile).toHaveBeenCalledWith({
      fields: ['description', 'avatar'],
    }),
  )
  await vi.waitFor(() => expect(mocks.invalidateAll).toHaveBeenCalled())
  await settle()
}

describe('settings "Import from Bluesky"', () => {
  it('shows a message and no dialog when there is no Bluesky profile', async () => {
    mocks.api.getBlueskyProfileImport.mockResolvedValue({
      status: 'noBlueskyProfile',
      fields: [],
    })
    await mountPage(existingProfile)

    importButton().click()

    await vi.waitFor(() =>
      expect(mocks.api.getBlueskyProfileImport).toHaveBeenCalledOnce(),
    )
    await vi.waitFor(() =>
      expect(messageShown('form.profile.blueskyImport.noBlueskyProfile')).toBe(
        true,
      ),
    )
    expect(importDialog()).toBeNull()
  })

  it('shows an error and no dialog when the check fails', async () => {
    mocks.api.getBlueskyProfileImport.mockRejectedValue(
      new XrpcError(500, 'PDSError', 'unreachable'),
    )
    await mountPage(existingProfile)

    importButton().click()

    await vi.waitFor(() =>
      expect(
        get(toasts).some((entry) => entry.type === 'error') ||
          Boolean(target.querySelector('[role="alert"]')?.textContent?.trim()),
      ).toBe(true),
    )
    expect(importDialog()).toBeNull()
  })

  it('opens the dialog with every field even after the offer was dismissed', async () => {
    await mountPage(existingProfile)

    importButton().click()

    await vi.waitFor(() => expect(importDialog()).not.toBeNull())
    expect(dialogCheckboxes().map((box) => [box.value, box.checked])).toEqual([
      ['displayName', false],
      ['description', false],
      ['avatar', true],
    ])
  })

  it('reseeds the editor from the reloaded profile after an import', async () => {
    await mountPage(existingProfile)

    const bioInput = bio()
    bioInput.value = 'Half-typed bio'
    bioInput.dispatchEvent(new Event('input', { bubbles: true }))
    const avatar = target.querySelector<HTMLInputElement>('#profile-avatar')
    if (!avatar) throw new Error('Missing avatar input')
    const file = new File(['avatar'], 'staged.png', { type: 'image/png' })
    Object.defineProperty(avatar, 'files', { value: [file] })
    avatar.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()

    importButton().click()
    await vi.waitFor(() => expect(importDialog()).not.toBeNull())
    const description = dialogCheckboxes().find(
      (box) => box.value === 'description',
    )
    if (!description) throw new Error('Missing description checkbox')
    description.click()
    await settle()
    const dialog = importDialog()
    if (!dialog) throw new Error('The import dialog closed early')
    buttonIn(dialog, 'form.profile.blueskyImport.importProfile').click()

    await vi.waitFor(() =>
      expect(mocks.api.importBlueskyProfile).toHaveBeenCalledWith({
        fields: ['description', 'avatar'],
      }),
    )
    await vi.waitFor(() => expect(mocks.invalidateAll).toHaveBeenCalled())
    reloadPageData(reloadedProfile)
    await settle()

    expect(bio().value).toBe('Kites and tides')

    const form = target.querySelector('form')
    if (!form) throw new Error('Missing profile form')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() =>
      expect(mocks.api.updateProfile).toHaveBeenCalledWith({
        displayName: 'Alice Example',
        description: 'Kites and tides',
      }),
    )
  })

  it('keeps unsaved edits to fields the import did not touch and shows the imported ones', async () => {
    mocks.api.importBlueskyProfile.mockResolvedValue({
      uri: 'at://did:plc:alice/social.coves.actor.profile/self',
      cid: 'bafyimported',
      imported: ['description'],
    })
    await mountPage(existingProfile)

    const displayName = target.querySelector<HTMLInputElement>(
      '#profile-display-name',
    )
    if (!displayName) throw new Error('Missing display name input')
    displayName.value = 'Alice Typed'
    displayName.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()

    importButton().click()
    await vi.waitFor(() => expect(importDialog()).not.toBeNull())
    for (const field of ['description', 'avatar']) {
      const box = dialogCheckboxes().find(
        (candidate) => candidate.value === field,
      )
      if (!box) throw new Error(`Missing ${field} checkbox`)
      box.click()
    }
    await settle()
    const dialog = importDialog()
    if (!dialog) throw new Error('The import dialog closed early')
    buttonIn(dialog, 'form.profile.blueskyImport.importProfile').click()

    await vi.waitFor(() =>
      expect(mocks.api.importBlueskyProfile).toHaveBeenCalledWith({
        fields: ['description'],
      }),
    )
    await vi.waitFor(() => expect(mocks.invalidateAll).toHaveBeenCalled())
    reloadPageData({ ...existingProfile, description: 'Kites and tides' })
    await settle()

    expect(bio().value).toBe('Kites and tides')
    expect(
      target.querySelector<HTMLInputElement>('#profile-display-name')?.value,
    ).toBe('Alice Typed')
  })

  it('keeps Save unavailable until the reloaded profile arrives after the dialog is closed mid-refresh', async () => {
    const refresh = deferred<void>()
    mocks.invalidateAll.mockImplementation(() => refresh.promise)
    await mountPage(existingProfile)
    await editThenImport()

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
    )
    await settle()
    expect(importDialog()).toBeNull()

    expect(saveButton().disabled).toBe(true)
    saveButton().click()
    await settle()
    expect(mocks.api.updateProfile).not.toHaveBeenCalled()

    refresh.resolve()
    await settle()
    reloadPageData(reloadedProfile)
    await settle()

    await vi.waitFor(() => expect(saveButton().disabled).toBe(false))
    expect(bio().value).toBe('Kites and tides')
    saveButton().click()
    await vi.waitFor(() =>
      expect(mocks.api.updateProfile).toHaveBeenCalledWith({
        displayName: 'Alice Example',
        description: 'Kites and tides',
      }),
    )
    expect(mocks.api.updateProfile).toHaveBeenCalledOnce()
  })

  it('keeps Save unavailable and tells the user when the refresh after an import fails', async () => {
    const refresh = deferred<void>()
    mocks.invalidateAll.mockImplementation(() => refresh.promise)
    await mountPage(existingProfile)
    await editThenImport()

    refresh.reject(new Error('load failed'))
    await vi.waitFor(() =>
      expect(
        get(toasts).some(
          (entry) =>
            entry.type === 'error' &&
            entry.content === 'form.profile.blueskyImport.refreshFailed',
        ),
      ).toBe(true),
    )

    expect(saveButton().disabled).toBe(true)
    saveButton().click()
    await settle()
    expect(mocks.api.updateProfile).not.toHaveBeenCalled()
  })
})
