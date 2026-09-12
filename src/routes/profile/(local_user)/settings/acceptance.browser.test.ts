// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { XrpcError } from '$lib/api/coves/xrpc'
import type { DID, Handle, InstanceURL } from '$lib/types/atproto'
import type { PageData } from './$types'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))

const api = vi.hoisted(() => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}))
const coves = vi.hoisted(() => vi.fn(() => api))
const state = vi.hoisted(() => ({
  openModals: [] as string[],
  invalidateAll: vi.fn(async () => {}),
  toast: vi.fn(),
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

vi.mock('$lib/api/client.svelte', () => ({
  coves,
  getClient: vi.fn(),
  site: { data: undefined },
}))
vi.mock('$app/state', () => ({
  page: {
    state: {
      get openModals() {
        return state.openModals
      },
    },
  },
}))
vi.mock('$app/navigation', () => ({
  invalidateAll: state.invalidateAll,
  pushState: (_url: string, next: { openModals?: string[] }) => {
    state.openModals.splice(
      0,
      state.openModals.length,
      ...(next.openModals ?? []),
    )
  },
  replaceState: (_url: string, next: { openModals?: string[] }) => {
    state.openModals.splice(
      0,
      state.openModals.length,
      ...(next.openModals ?? []),
    )
  },
}))
vi.mock('$lib/ui/kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/ui/kit')>()),
  toast: state.toast,
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

vi.mock('$lib/app/state/auth.svelte', () => ({ profile: state.profile }))

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

import { load } from './+page'

const existingProfile = {
  did: 'did:plc:alice' as DID,
  handle: 'alice.coves.social' as Handle,
  createdAt: '2026-09-01T00:00:00Z',
  displayName: 'Alice Example',
  description: 'Existing bio',
  avatar: 'https://cdn.coves.test/alice.jpg',
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

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')

beforeEach(async () => {
  state.openModals.splice(0)
  api.getProfile.mockReset().mockResolvedValue(existingProfile)
  api.updateProfile.mockReset().mockResolvedValue({
    uri: 'at://did:plc:alice/social.coves.actor.profile/self',
    cid: 'bafyprofile',
  })
  coves.mockClear()
  state.invalidateAll.mockClear()
  state.toast.mockClear()
  state.profile.sessionExpired = false
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    state.openModals.splice(0)
  })
  client = await import('svelte')
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  vi.restoreAllMocks()
})

function input(selector: string): HTMLInputElement {
  const element = target.querySelector<HTMLInputElement>(selector)
  if (!element) throw new Error(`Missing input ${selector}`)
  return element
}

function setValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  client.flushSync()
}

async function mountPage(data: PageData): Promise<void> {
  const Page = (await import('./+page.svelte')).default
  mounted = client.mount(Page, { target, props: { data }, intro: false })
  client.flushSync()
}

describe('profile settings acceptance', () => {
  it('opens the avatar picker and announces the selected file', async () => {
    await mountPage({ ...parentData, profile: existingProfile } as PageData)

    const avatar = input('#profile-avatar')
    const openPicker = [...target.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'form.post.selectFile',
    )

    expect(avatar.classList).toContain('sr-only')
    expect(openPicker).toBeDefined()
    const click = vi.spyOn(avatar, 'click')
    openPicker?.click()
    expect(click).toHaveBeenCalledOnce()

    const file = new File(['avatar'], 'new-avatar.png', { type: 'image/png' })
    Object.defineProperty(avatar, 'files', { value: [file] })
    avatar.dispatchEvent(new Event('change', { bubbles: true }))
    client.flushSync()

    const selection = target.querySelector('#profile-avatar-selection')
    expect(selection?.textContent).toContain('new-avatar.png')
    expect(selection?.getAttribute('aria-live')).toBe('polite')
    expect(openPicker?.getAttribute('aria-describedby')).toBe(
      'profile-avatar-selection',
    )
  })

  it('loads, edits, and saves display name, bio, and avatar', async () => {
    const routeFetch = vi.fn<typeof fetch>()
    const data = await load({
      fetch: routeFetch,
      parent: vi.fn().mockResolvedValue(parentData),
    } as unknown as Parameters<typeof load>[0])

    expect(coves).toHaveBeenCalledWith({ func: routeFetch })
    expect(api.getProfile).toHaveBeenCalledWith({ actor: 'did:plc:alice' })
    if (!data) throw new Error('Profile settings load returned no data')

    await mountPage({ ...parentData, ...data } as PageData)

    const displayName = input('#profile-display-name')
    const bio = target.querySelector<HTMLTextAreaElement>('#profile-bio')
    const avatar = input('#profile-avatar')
    expect(displayName.value).toBe('Alice Example')
    expect(displayName.placeholder).toBe('form.profile.optional')
    expect(bio?.value).toBe('Existing bio')
    expect(displayName.getAttribute('maxlength')).toBeNull()
    expect(bio?.getAttribute('maxlength')).toBeNull()
    expect(displayName.classList).toContain('text-base')
    expect(bio?.classList).toContain('text-base')
    expect(avatar.classList).toContain('text-base')
    expect(target.querySelector<HTMLImageElement>('img')?.src).toBe(
      existingProfile.avatar,
    )

    setValue(displayName, 'Alice Updated')
    if (!bio) throw new Error('Missing bio textarea')
    setValue(bio, 'Updated bio')

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    Object.defineProperty(avatar, 'files', { value: [file] })
    avatar.dispatchEvent(new Event('change', { bubbles: true }))

    const form = target.querySelector('form')
    if (!form) throw new Error('Missing profile form')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await vi.waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith({
        displayName: 'Alice Updated',
        bio: 'Updated bio',
        avatarBlob: 'YXZhdGFy',
        avatarMimeType: 'image/png',
      }),
    )
    await vi.waitFor(() => expect(state.invalidateAll).toHaveBeenCalledOnce())
    expect(state.toast).toHaveBeenCalledWith({
      content: 'toast.profileUpdated',
      type: 'success',
    })

    api.updateProfile.mockClear()
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith({
        displayName: 'Alice Updated',
        bio: 'Updated bio',
      }),
    )
  })

  it('lets global session recovery own expired-session feedback', async () => {
    state.profile.sessionExpired = true
    api.updateProfile.mockRejectedValue(
      new XrpcError(401, 'AuthExpired', 'expired'),
    )
    await mountPage({ ...parentData, profile: existingProfile } as PageData)

    const form = target.querySelector('form')
    const button = target.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )
    if (!form || !button) throw new Error('Missing profile form controls')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    client.flushSync()
    expect(button.disabled).toBe(true)
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    expect(state.toast).not.toHaveBeenCalled()
  })

  it('blocks duplicate saves and remains retryable after an error', async () => {
    let rejectUpdate: ((reason: unknown) => void) | undefined
    api.updateProfile.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectUpdate = reject
        }),
    )
    await mountPage({ ...parentData, profile: existingProfile } as PageData)

    const form = target.querySelector('form')
    const button = target.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )
    if (!form || !button) throw new Error('Missing profile form controls')

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    client.flushSync()

    await vi.waitFor(() => expect(api.updateProfile).toHaveBeenCalledOnce())
    expect(button.disabled).toBe(true)

    rejectUpdate?.(new Error('offline'))
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    expect(state.toast).toHaveBeenCalledWith({
      content: 'offline',
      type: 'error',
    })

    api.updateProfile.mockResolvedValueOnce({
      uri: 'at://did:plc:alice/social.coves.actor.profile/self',
      cid: 'bafyretried',
    })
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => expect(api.updateProfile).toHaveBeenCalledTimes(2))
  })

  it('disables editable fields and both ways to choose an avatar while a profile save is pending', async () => {
    let finishUpdate: (() => void) | undefined
    api.updateProfile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpdate = () =>
            resolve({
              uri: 'at://did:plc:alice/social.coves.actor.profile/self',
              cid: 'bafypending',
            })
        }),
    )
    await mountPage({ ...parentData, profile: existingProfile } as PageData)

    const form = target.querySelector('form')
    const displayName = input('#profile-display-name')
    const bio = target.querySelector<HTMLTextAreaElement>('#profile-bio')
    const avatar = input('#profile-avatar')
    const openPicker = [
      ...target.querySelectorAll<HTMLButtonElement>('button'),
    ].find(
      (candidate) => candidate.textContent?.trim() === 'form.post.selectFile',
    )
    if (!form || !bio || !openPicker)
      throw new Error('Missing profile form controls')

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(api.updateProfile).toHaveBeenCalledOnce())

    expect.soft(displayName.disabled).toBe(true)
    expect.soft(bio.disabled).toBe(true)
    expect.soft(avatar.disabled).toBe(true)
    expect.soft(openPicker.disabled).toBe(true)

    finishUpdate?.()
    await vi.waitFor(() => expect(state.invalidateAll).toHaveBeenCalledOnce())
  })

  it('explains why profile fields are unavailable', async () => {
    await mountPage({ ...parentData, profile: undefined } as PageData)

    expect(target.textContent).toContain('toast.sessionExpired')
  })
})
