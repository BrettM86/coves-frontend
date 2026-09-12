// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProfileViewDetailed } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import type { PageData } from './$types'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))

const state = vi.hoisted(() => ({
  openModals: [] as string[],
  invalidateAll: vi.fn(async () => {}),
  updateProfile: vi.fn(async () => ({
    uri: 'at://did:plc:alice/social.coves.actor.profile/self',
    cid: 'bafyprofile',
  })),
  getProfile: vi.fn(),
  getActorPosts: vi.fn(),
  getActorComments: vi.fn(),
  profile: {
    meta: { profile: 'alice' },
    isAuthenticated: true,
    current: {
      type: 'authenticated' as const,
      did: 'did:plc:alice',
      handle: 'alice.coves.social',
      jwt: 'authenticated',
    },
    sessionExpired: false,
  },
}))

vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/profile/alice.coves.social'),
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
vi.mock('$lib/app/state/auth.svelte', () => ({ profile: state.profile }))
vi.mock('$lib/api/client.svelte', () => ({
  coves: () => ({
    updateProfile: state.updateProfile,
    getProfile: state.getProfile,
    getActorPosts: state.getActorPosts,
    getActorComments: state.getActorComments,
  }),
}))
vi.mock('$lib/app/state/i18n', () => {
  const translate = (key: string) => key
  return {
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
  }
})

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

const ownedProfile = {
  did: 'did:plc:alice' as DID,
  handle: 'alice.coves.social' as Handle,
  displayName: 'Alice Example',
  description: 'Existing bio',
  avatar: 'https://cdn.coves.test/alice.jpg',
  createdAt: '2026-09-01T00:00:00Z',
} as ProfileViewDetailed

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')

beforeEach(async () => {
  const BrowserURL = URL
  let objectUrl = 0
  vi.stubGlobal(
    'URL',
    class extends BrowserURL {
      static createObjectURL = vi.fn(() => `blob:profile-${++objectUrl}`)
      static revokeObjectURL = vi.fn()
    },
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  client = await import('svelte')
  state.openModals.splice(0)
  state.invalidateAll.mockClear()
  state.updateProfile.mockClear()
  state.getProfile.mockReset().mockResolvedValue(ownedProfile)
  state.getActorPosts.mockReset().mockResolvedValue({ feed: [] })
  state.getActorComments.mockReset().mockResolvedValue({ comments: [] })
  const { feeds } = await import('$lib/feature/feeds/feed.svelte')
  feeds.clear()
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    state.openModals.splice(0)
  })
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
  const { feeds } = await import('$lib/feature/feeds/feed.svelte')
  feeds.clear()
  vi.unstubAllGlobals()
})

function button(
  label: string,
  scope: ParentNode = document,
): HTMLButtonElement {
  const element = [...scope.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!element) throw new Error(`Missing button: ${label}`)
  return element
}

async function selectAvatar(
  editor: ParentNode,
  file: File,
): Promise<HTMLElement> {
  const avatar = editor.querySelector<HTMLInputElement>('#profile-avatar')
  if (!avatar) throw new Error('Missing avatar input')
  Object.defineProperty(avatar, 'files', { value: [file], configurable: true })
  avatar.dispatchEvent(new Event('change', { bubbles: true }))
  await client.tick()
  client.flushSync()

  const cropDialog = [
    ...document.querySelectorAll<HTMLElement>('[role="dialog"]'),
  ].find((dialog) =>
    dialog
      .querySelector('h1')
      ?.textContent?.includes('form.profile.cropAvatar'),
  )
  if (!cropDialog) throw new Error('Missing avatar crop dialog')
  return cropDialog
}

async function applyCrop(cropDialog: HTMLElement): Promise<void> {
  const cropSource = cropDialog.querySelector<HTMLImageElement>(
    'img[alt="form.profile.cropSource"]',
  )
  if (!cropSource) throw new Error('Missing crop source image')
  cropSource.dispatchEvent(new Event('load'))

  const selection = await vi.waitFor(() => {
    const element = cropDialog.querySelector<
      HTMLElement & {
        $toCanvas: () => Promise<{
          toBlob: (callback: (blob: Blob | null) => void) => void
        }>
      }
    >('cropper-selection')
    expect(element).not.toBeNull()
    return element
  })
  if (!selection) throw new Error('Missing crop selection')
  selection.$toCanvas = vi.fn(async () => ({
    toBlob: (callback: (blob: Blob | null) => void) =>
      callback(new Blob(['cropped-avatar'], { type: 'image/webp' })),
  }))

  button('form.profile.applyCrop', cropDialog).click()
  await vi.waitFor(() => expect(cropDialog.isConnected).toBe(false))
}

function deferred<T>() {
  let resolve = (_value: T) => {}
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function cropSelection(cropDialog: HTMLElement): Promise<
  HTMLElement & {
    $toCanvas: () => Promise<{
      toBlob: (
        callback: (blob: Blob | null) => void,
        type?: string,
        quality?: number,
      ) => void
    }>
  }
> {
  const cropSource = cropDialog.querySelector<HTMLImageElement>(
    'img[alt="form.profile.cropSource"]',
  )
  if (!cropSource) throw new Error('Missing crop source image')
  cropSource.dispatchEvent(new Event('load'))

  const selection = await vi.waitFor(() => {
    const element = cropDialog.querySelector<
      HTMLElement & {
        $toCanvas: () => Promise<{
          toBlob: (
            callback: (blob: Blob | null) => void,
            type?: string,
            quality?: number,
          ) => void
        }>
      }
    >('cropper-selection')
    expect(element).not.toBeNull()
    return element
  })
  if (!selection) throw new Error('Missing crop selection')
  return selection
}

async function mountCropper(
  oncropped: (file: File) => void,
): Promise<HTMLElement> {
  const AvatarCropper = (await import('../AvatarCropper.svelte')).default
  mounted = client.mount(AvatarCropper, {
    target,
    intro: false,
    props: {
      file: new File(['source-avatar'], 'portrait.png', { type: 'image/png' }),
      oncancel: vi.fn(),
      oncropped,
    },
  })
  client.flushSync()
  const cropDialog = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!cropDialog) throw new Error('Missing avatar crop dialog')
  return cropDialog
}

describe('edit profile from the profile header', () => {
  it('places the owner edit control inside the profile banner', async () => {
    const ProfilePage = (await import('./+page.svelte')).default
    mounted = client.mount(ProfilePage, {
      target,
      props: {
        data: {
          data: {
            value: {
              profile: ownedProfile,
              posts: { feed: [] },
              comments: { comments: [] },
            },
          },
        } as unknown as PageData,
      },
      intro: false,
    })
    client.flushSync()

    const banner = target.querySelector('[data-profile-banner]')
    expect(banner).not.toBeNull()
    if (!banner) return
    expect(banner.querySelector('button')?.textContent).toContain(
      'routes.profile.edit',
    )
  })

  it('opens a prefilled editor and closes it after a successful save', async () => {
    const UserActions = (await import('./UserActions.svelte')).default
    mounted = client.mount(UserActions, {
      target,
      props: { profile: ownedProfile },
      intro: false,
    })
    client.flushSync()

    button('routes.profile.edit', target).click()
    await client.tick()
    client.flushSync()

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.querySelector('h1')?.textContent?.trim()).toBe(
      'routes.profile.edit',
    )
    const displayName = dialog?.querySelector<HTMLInputElement>(
      '#profile-display-name',
    )
    const bio = dialog?.querySelector<HTMLTextAreaElement>('#profile-bio')
    expect(displayName?.value).toBe('Alice Example')
    expect(bio?.value).toBe('Existing bio')

    if (!displayName) throw new Error('Missing display name input')
    displayName.value = 'Alice Updated'
    displayName.dispatchEvent(new Event('input', { bubbles: true }))
    client.flushSync()
    button('common.save', dialog ?? document).click()

    await vi.waitFor(() =>
      expect(state.updateProfile).toHaveBeenCalledWith({
        displayName: 'Alice Updated',
        bio: 'Existing bio',
      }),
    )
    await vi.waitFor(() => expect(state.invalidateAll).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    )
  })

  it('crops a selected avatar and previews it in the edit modal', async () => {
    const UserActions = (await import('./UserActions.svelte')).default
    mounted = client.mount(UserActions, {
      target,
      props: { profile: ownedProfile },
      intro: false,
    })
    client.flushSync()

    button('routes.profile.edit', target).click()
    await client.tick()
    client.flushSync()
    const editor = [
      ...document.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ].find((dialog) =>
      dialog.querySelector('h1')?.textContent?.includes('routes.profile.edit'),
    )
    if (!editor) throw new Error('Missing profile editor dialog')

    const file = new File(['source-avatar'], 'portrait.png', {
      type: 'image/png',
    })
    const cropDialog = await selectAvatar(editor, file)
    expect(editor.querySelector<HTMLImageElement>('img')?.src).toBe(
      ownedProfile.avatar,
    )
    await applyCrop(cropDialog)

    expect(editor.querySelector<HTMLImageElement>('img')?.src).toBe(
      'blob:profile-2',
    )
    expect(
      editor.querySelector('#profile-avatar-selection')?.textContent,
    ).toContain('portrait-cropped.webp')
  })

  it('reports an unreadable avatar and lets the user cancel cropping', async () => {
    const ProfileEditor = (await import('../ProfileEditor.svelte')).default
    mounted = client.mount(ProfileEditor, {
      target,
      props: { profile: ownedProfile },
      intro: false,
    })
    client.flushSync()

    const cropDialog = await selectAvatar(
      target,
      new File(['unreadable'], 'unreadable.png', { type: 'image/png' }),
    )
    const cropSource = cropDialog.querySelector<HTMLImageElement>(
      'img[alt="form.profile.cropSource"]',
    )
    if (!cropSource) throw new Error('Missing crop source image')
    cropSource.dispatchEvent(new Event('error'))
    client.flushSync()

    expect
      .soft(cropDialog.querySelector('[role="alert"]')?.textContent ?? '')
      .toContain('form.profile.cropFailed')
    expect
      .soft(button('form.profile.applyCrop', cropDialog).disabled)
      .toBe(true)

    button('common.cancel', cropDialog).click()
    await vi.waitFor(() => expect(cropDialog.isConnected).toBe(false))
    expect(target.querySelector('#profile-display-name')).not.toBeNull()
  })

  it('releases a submitted avatar preview after a persistent editor saves it', async () => {
    const ProfileEditor = (await import('../ProfileEditor.svelte')).default
    mounted = client.mount(ProfileEditor, {
      target,
      props: { profile: ownedProfile },
      intro: false,
    })
    client.flushSync()

    const cropDialog = await selectAvatar(
      target,
      new File(['first-avatar'], 'first.png', { type: 'image/png' }),
    )
    await applyCrop(cropDialog)
    expect(target.querySelector<HTMLImageElement>('img')?.src).toBe(
      'blob:profile-2',
    )
    vi.mocked(URL.revokeObjectURL).mockClear()

    button('common.save', target).click()
    await vi.waitFor(() => expect(state.invalidateAll).toHaveBeenCalledOnce())

    expect.soft(URL.revokeObjectURL).toHaveBeenCalledWith('blob:profile-2')
    expect
      .soft(target.querySelector<HTMLImageElement>('img')?.src)
      .toBe(ownedProfile.avatar)
  })

  it('does not call onsaved when a pending save resolves after the editor is destroyed', async () => {
    const request = deferred<{ uri: string; cid: string }>()
    const refresh = deferred<void>()
    state.updateProfile.mockImplementationOnce(() => request.promise)
    state.invalidateAll.mockImplementationOnce(() => refresh.promise)
    const onsaved = vi.fn()
    const ProfileEditor = (await import('../ProfileEditor.svelte')).default
    mounted = client.mount(ProfileEditor, {
      target,
      props: { profile: ownedProfile, onsaved },
      intro: false,
    })
    client.flushSync()

    button('common.save', target).click()
    await vi.waitFor(() => expect(state.updateProfile).toHaveBeenCalledOnce())
    if (mounted) await client.unmount(mounted, { outro: false })
    mounted = undefined

    request.resolve({
      uri: 'at://did:plc:alice/social.coves.actor.profile/self',
      cid: 'bafylate',
    })
    await vi.waitFor(() => expect(state.invalidateAll).toHaveBeenCalledOnce())
    refresh.resolve()
    await refresh.promise
    await client.tick()
    client.flushSync()

    expect(onsaved).not.toHaveBeenCalled()
  })

  it('keeps a newer avatar preview when an earlier save completes', async () => {
    let finishUpdate: (() => void) | undefined
    state.updateProfile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpdate = () =>
            resolve({
              uri: 'at://did:plc:alice/social.coves.actor.profile/self',
              cid: 'bafyearlier',
            })
        }),
    )
    const ProfileEditor = (await import('../ProfileEditor.svelte')).default
    mounted = client.mount(ProfileEditor, {
      target,
      props: { profile: ownedProfile },
      intro: false,
    })
    client.flushSync()

    await applyCrop(
      await selectAvatar(
        target,
        new File(['first-avatar'], 'first.png', { type: 'image/png' }),
      ),
    )
    button('common.save', target).click()
    await vi.waitFor(() => expect(state.updateProfile).toHaveBeenCalledOnce())

    await applyCrop(
      await selectAvatar(
        target,
        new File(['newer-avatar'], 'newer.png', { type: 'image/png' }),
      ),
    )
    expect(target.querySelector<HTMLImageElement>('img')?.src).toBe(
      'blob:profile-4',
    )
    vi.mocked(URL.revokeObjectURL).mockClear()

    finishUpdate?.()
    await vi.waitFor(() => expect(state.invalidateAll).toHaveBeenCalledOnce())

    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:profile-4')
    expect(target.querySelector<HTMLImageElement>('img')?.src).toBe(
      'blob:profile-4',
    )
  })

  it('refreshes the cached profile route before the editor closes after save', async () => {
    const { load } = await import('./+page')
    const routeEvent = () =>
      ({
        params: { handle: ownedProfile.handle },
        url: new URL(`https://coves.test/profile/${ownedProfile.handle}`),
        fetch: vi.fn<typeof fetch>(),
        route: { id: '/profile/[handle=actor]' },
      }) as unknown as Parameters<typeof load>[0]

    const initial = await load(routeEvent())
    expect(initial.data.value?.profile.displayName).toBe('Alice Example')

    const updatedProfile = { ...ownedProfile, displayName: 'Alice Updated' }
    state.updateProfile.mockImplementationOnce(async () => {
      state.getProfile.mockResolvedValue(updatedProfile)
      return {
        uri: 'at://did:plc:alice/social.coves.actor.profile/self',
        cid: 'bafyupdated',
      }
    })
    let refreshed: Awaited<ReturnType<typeof load>> | undefined
    state.invalidateAll.mockImplementationOnce(async () => {
      refreshed = await load(routeEvent())
    })

    const ProfileEditor = (await import('../ProfileEditor.svelte')).default
    mounted = client.mount(ProfileEditor, {
      target,
      props: { profile: ownedProfile },
      intro: false,
    })
    client.flushSync()
    const displayName = target.querySelector<HTMLInputElement>(
      '#profile-display-name',
    )
    if (!displayName) throw new Error('Missing display name input')
    displayName.value = 'Alice Updated'
    displayName.dispatchEvent(new Event('input', { bubbles: true }))

    button('common.save', target).click()
    await vi.waitFor(() => expect(state.invalidateAll).toHaveBeenCalledOnce())

    expect(state.getProfile).toHaveBeenCalledTimes(2)
    expect(refreshed?.data.value?.profile.displayName).toBe('Alice Updated')
  })
})

describe('avatar crop encoding lifecycle', () => {
  it('retries Safari WebP-to-PNG fallback with JPEG and returns an accepted file', async () => {
    const oncropped = vi.fn<(file: File) => void>()
    const cropDialog = await mountCropper(oncropped)
    const selection = await cropSelection(cropDialog)
    const requestedTypes: (string | undefined)[] = []
    const oversizedPng = new Blob([new Uint8Array(1_000_001)], {
      type: 'image/png',
    })
    const acceptedJpeg = new Blob(['jpeg-avatar'], { type: 'image/jpeg' })
    selection.$toCanvas = vi.fn(async () => ({
      toBlob: (callback: (blob: Blob | null) => void, type?: string) => {
        requestedTypes.push(type)
        callback(type === 'image/jpeg' ? acceptedJpeg : oversizedPng)
      },
    }))

    button('form.profile.applyCrop', cropDialog).click()

    await vi.waitFor(() => expect(requestedTypes).toContain('image/jpeg'))
    await vi.waitFor(() => expect(oncropped).toHaveBeenCalledOnce())
    const cropped = oncropped.mock.calls[0]?.[0]
    expect(cropped?.type).toBe('image/jpeg')
    expect(cropped?.size).toBeLessThanOrEqual(1_000_000)
  })

  it('reports failure when every WebP and JPEG encoding remains oversized', async () => {
    const oncropped = vi.fn<(file: File) => void>()
    const cropDialog = await mountCropper(oncropped)
    const selection = await cropSelection(cropDialog)
    const requestedTypes: (string | undefined)[] = []
    selection.$toCanvas = vi.fn(async () => ({
      toBlob: (callback: (blob: Blob | null) => void, type?: string) => {
        requestedTypes.push(type)
        callback(
          new Blob([new Uint8Array(1_000_001)], {
            type: type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
          }),
        )
      },
    }))

    button('form.profile.applyCrop', cropDialog).click()

    await vi.waitFor(() =>
      expect(cropDialog.querySelector('[role="alert"]')?.textContent).toContain(
        'form.profile.cropFailed',
      ),
    )
    expect(requestedTypes).toContain('image/jpeg')
    expect(oncropped).not.toHaveBeenCalled()
    expect(cropDialog.isConnected).toBe(true)
  })

  it('does not deliver a deferred crop after navigation destroys the cropper', async () => {
    const oncropped = vi.fn((file: File) => URL.createObjectURL(file))
    const cropDialog = await mountCropper(oncropped)
    const selection = await cropSelection(cropDialog)
    const canvas = deferred<{
      toBlob: (callback: (blob: Blob | null) => void) => void
    }>()
    const toCanvas = vi.fn(() => canvas.promise)
    selection.$toCanvas = toCanvas

    button('form.profile.applyCrop', cropDialog).click()
    await vi.waitFor(() => expect(toCanvas).toHaveBeenCalledOnce())
    vi.mocked(URL.createObjectURL).mockClear()

    if (mounted) await client.unmount(mounted, { outro: false })
    mounted = undefined
    const toBlob = vi.fn((callback: (blob: Blob | null) => void) =>
      callback(new Blob(['late-avatar'], { type: 'image/webp' })),
    )
    canvas.resolve({ toBlob })
    await vi.waitFor(() => expect(toBlob).toHaveBeenCalledOnce())
    await client.tick()
    client.flushSync()

    expect(oncropped).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})
