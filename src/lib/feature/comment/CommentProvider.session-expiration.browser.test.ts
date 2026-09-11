// @vitest-environment jsdom
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AtUri, CID, PostView } from '$lib/api/coves/types'
import type { ServerSession } from '$lib/app/state/auth.svelte'
import type { DID, Handle } from '$lib/types/atproto'

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
    url: new URL('http://localhost/c/community/post/author/one'),
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

const post: PostView = {
  uri: 'at://did:plc:author/social.coves.community.post/one' as AtUri,
  rkey: 'one',
  cid: 'bafyreiexample' as CID,
  indexedAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
  author: { did: 'did:plc:author' as DID, handle: 'author.example' as Handle },
  community: { did: 'did:plc:community' as DID, name: 'Community' },
} as PostView

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let svelte: typeof import('svelte')
let profile: (typeof import('$lib/app/state/auth.svelte'))['profile']
// The profile is module state; retired generations never come back, so each
// test logs in under a fresh one.
let generationSequence = 0
let initialGeneration: string

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(async () => {
  localStorage.clear()
  // jsdom has no layout engine; the sort Select measures its label with one.
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  svelte = await import('svelte')
  profile = (await import('$lib/app/state/auth.svelte')).profile
  initialGeneration = `initial-generation-${++generationSequence}`
  profile.syncFromServer(session(initialGeneration))
  const { loadTranslations, locale } = await import('$lib/app/state/i18n')
  await loadTranslations('en')
  locale.set('en')
  const Component = (await import('./CommentProvider.svelte')).default
  target = document.createElement('div')
  document.body.appendChild(target)
  mounted = svelte.mount(Component, {
    target,
    props: { post, comments: [], virtualize: false },
    intro: false,
  })
  svelte.flushSync()
})

afterEach(async () => {
  if (mounted) await svelte.unmount(mounted, { outro: false })
  mounted = undefined
  target.remove()
})

afterAll(() => {
  profile.mainEffect()
})

function editor(): HTMLTextAreaElement | null {
  return target.querySelector('textarea')
}

function openEditor(): HTMLTextAreaElement {
  const button = [...target.querySelectorAll('button')].find((element) =>
    /add a comment/i.test(element.textContent ?? ''),
  )
  if (!button) throw new Error('Missing add-comment button')
  button.click()
  svelte.flushSync()
  const textarea = editor()
  if (!textarea) throw new Error('Editor did not open')
  return textarea
}

it('keeps the comment draft through session expiration and re-login', () => {
  const textarea = openEditor()
  textarea.value = 'Half-written reply'
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  svelte.flushSync()

  // A background 401 flips the profile to guest, the way expireSession does.
  profile.expireSession(profile.sessionGeneration)
  svelte.flushSync()
  expect(profile.sessionExpired).toBe(true)
  expect(profile.current.jwt).toBeUndefined()
  expect(editor()?.value).toBe('Half-written reply')

  // A newer login lands and the root layout syncs it in.
  profile.syncFromServer(session(`${initialGeneration}-replacement`), {
    sessionGeneration: `${initialGeneration}-replacement`,
    sessionExpired: false,
  })
  svelte.flushSync()
  expect(profile.sessionExpired).toBe(false)
  expect(profile.current.jwt).toBe('authenticated')
  expect(editor()?.value).toBe('Half-written reply')
})

it('keeps the comment draft when the prompt is dismissed and the reader logs back in', () => {
  const textarea = openEditor()
  textarea.value = 'Half-written reply'
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  svelte.flushSync()

  profile.expireSession(profile.sessionGeneration)
  svelte.flushSync()
  expect(editor()?.value).toBe('Half-written reply')

  // Dismissing hides the prompt; the session is still expired, not a guest.
  profile.dismissSessionExpiration()
  svelte.flushSync()
  expect(profile.sessionExpired).toBe(true)
  expect(profile.sessionExpirationDismissed).toBe(true)
  expect(editor()?.value).toBe('Half-written reply')

  profile.syncFromServer(session(`${initialGeneration}-replacement`), {
    sessionGeneration: `${initialGeneration}-replacement`,
    sessionExpired: false,
  })
  svelte.flushSync()
  expect(profile.sessionExpired).toBe(false)
  expect(profile.sessionExpirationDismissed).toBe(false)
  expect(profile.current.jwt).toBe('authenticated')
  expect(editor()?.value).toBe('Half-written reply')
})

it('unmounts the editor for a genuine guest, not an expired session', () => {
  openEditor()
  profile.syncFromServer(undefined)
  svelte.flushSync()
  expect(profile.sessionExpired).toBe(false)
  expect(editor()).toBeNull()
})
