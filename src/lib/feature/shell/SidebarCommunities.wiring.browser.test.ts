// @vitest-environment jsdom
import { createRequire } from 'node:module'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { XrpcError } from '$lib/api/coves'
import type { CommunityView } from '$lib/api/coves/types'
import { communityOrder } from '$lib/feature/community/community-order.svelte'
import {
  resetSubscribedCommunitiesState,
  subscribedCommunities,
} from '$lib/feature/community/subscribed-communities.svelte'
import { resetSubscriptionState } from '$lib/feature/community/subscription.svelte'
import type { DID } from '$lib/types/atproto'
import { toast } from '$lib/ui/kit'
import { sidebarViewer } from './fixtures/sidebar-viewer.svelte'
import SidebarCommunities from './SidebarCommunities.svelte'

// The sidebar's own wiring against the real stores: the load/reset effect and
// what a star press does to the saved order. Only the network, the viewer
// and toasts are faked.

vi.mock('svelte', async () => {
  const entry = createRequire(import.meta.url)
    .resolve('svelte/package.json')
    .replace('package.json', 'src/index-client.js')
  return import(/* @vite-ignore */ entry)
})
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/environment', () => ({ browser: true, dev: false }))
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/') } }))
vi.mock('$lib/app/state/auth.svelte', async () => ({
  profile: (await import('./fixtures/sidebar-viewer.svelte')).sidebarViewer,
}))
const api = {
  listCommunities: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}
vi.mock('$lib/api/client.svelte', () => ({ coves: () => api }))
vi.mock('$lib/ui/kit', async (original) => ({
  ...(await original<typeof import('$lib/ui/kit')>()),
  toast: vi.fn(),
}))

const VIEWER = 'did:plc:viewer' as DID

function community(name: string): CommunityView {
  return {
    did: `did:plc:${name}` as DID,
    name,
    subscriberCount: 0,
    memberCount: 0,
    postCount: 0,
    viewer: { subscribed: true },
  }
}

const target = document.createElement('div')
let mounted: ReturnType<typeof mount> | undefined
let saved: DID[] = []

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
    flushSync()
  }
}

function rowNames(): string[] {
  return [...target.querySelectorAll<HTMLElement>('[data-row-did]')].map(
    (row) => row.dataset.rowDid?.replace('did:plc:', '') ?? '',
  )
}

function star(name: string): HTMLButtonElement {
  const button = target.querySelector<HTMLButtonElement>(
    `[data-favorite-did="did:plc:${name}"]`,
  )
  if (!button) throw new Error(`Missing star for ${name}`)
  return button
}

async function mountSidebar(): Promise<void> {
  document.body.appendChild(target)
  mounted = mount(SidebarCommunities, { target })
  await settle()
  // The real load ran through the effect; point the order at memory.
  communityOrder.load(VIEWER, {
    get: () => saved,
    set: (_owner, order) => {
      saved = [...order]
    },
  })
  flushSync()
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  sidebarViewer.current = { type: 'authenticated', did: VIEWER }
  saved = []
  api.listCommunities.mockReset().mockResolvedValue({
    communities: ['alpha', 'beta', 'gamma'].map(community),
  })
  api.subscribe.mockReset()
  vi.mocked(toast).mockReset()
})

afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  target.remove()
  resetSubscribedCommunitiesState()
  resetSubscriptionState()
  communityOrder.reset()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('loads the list for the viewer and drops it on sign-out', async () => {
  await mountSidebar()
  expect(subscribedCommunities.owner).toBe(VIEWER)
  expect(rowNames()).toEqual(['alpha', 'beta', 'gamma'])

  sidebarViewer.current = { type: 'anonymous' }
  await settle()
  expect(subscribedCommunities.owner).toBeUndefined()
  expect(subscribedCommunities.communities).toEqual([])
  expect(communityOrder.order).toEqual([])
})

function pressStar(button: HTMLButtonElement, pointerType: 'mouse' | 'touch') {
  for (const type of ['pointerdown', 'pointerup']) {
    button.dispatchEvent(
      Object.assign(new MouseEvent(type, { bubbles: true, detail: 1 }), {
        pointerType,
      }),
    )
  }
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
}

it('moves the mouse-starred row immediately with reduced motion', async () => {
  await mountSidebar()
  api.subscribe.mockResolvedValue({ uri: 'at://x', cid: 'c', favorite: true })
  const button = star('gamma')
  pressStar(button, 'mouse')
  await settle()
  expect(api.subscribe).toHaveBeenCalledWith({
    community: 'did:plc:gamma',
    favorite: true,
  })
  expect(button.getAttribute('aria-pressed')).toBe('true')
  expect(rowNames()).toEqual(['gamma', 'alpha', 'beta'])
  expect(saved).toEqual(['did:plc:gamma', 'did:plc:alpha', 'did:plc:beta'])
})

it('allows undo on the same star during the burst', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  await mountSidebar()
  api.subscribe
    .mockResolvedValueOnce({ uri: 'at://x', cid: 'c', favorite: true })
    .mockResolvedValueOnce({ uri: 'at://x', cid: 'd', favorite: false })
  const button = star('beta')
  vi.useFakeTimers()
  pressStar(button, 'mouse')
  await settle()
  await vi.advanceTimersByTimeAsync(350)
  expect(rowNames()).toEqual(['alpha', 'beta', 'gamma'])
  pressStar(button, 'mouse')
  await settle()
  await vi.advanceTimersByTimeAsync(700)
  await settle()
  expect(button.getAttribute('aria-pressed')).toBe('false')
  expect(rowNames()).toEqual(['alpha', 'beta', 'gamma'])
})

it('moves a keyboard-starred row when focus leaves the whole row', async () => {
  await mountSidebar()
  api.subscribe.mockResolvedValue({ uri: 'at://x', cid: 'c', favorite: true })
  const button = star('gamma')
  button.focus()
  button.click()
  await settle()
  expect(document.activeElement).toBe(button)
  expect(rowNames()).toEqual(['alpha', 'beta', 'gamma'])
  button.closest('li')?.querySelector('a')?.focus()
  await settle()
  expect(rowNames()).toEqual(['alpha', 'beta', 'gamma'])
  const next = star('alpha')
  next.focus()
  await settle()
  expect(rowNames()).toEqual(['gamma', 'alpha', 'beta'])
  expect(document.activeElement).toBe(next)
})

it.each(['mouse', 'touch'] as const)(
  'holds a %s-starred row for the star burst, then releases it',
  async (pointerType) => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    await mountSidebar()
    api.subscribe.mockResolvedValue({ uri: 'at://x', cid: 'c', favorite: true })
    const button = star('gamma')
    vi.useFakeTimers()
    pressStar(button, pointerType)
    await settle()
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(rowNames()).toEqual(['alpha', 'beta', 'gamma'])
    await vi.advanceTimersByTimeAsync(699)
    expect(rowNames()).toEqual(['alpha', 'beta', 'gamma'])
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(rowNames()).toEqual(['gamma', 'alpha', 'beta'])
  },
)

it('a failed star puts the order back and shows the error', async () => {
  await mountSidebar()
  api.subscribe.mockRejectedValue(new Error('offline'))
  star('gamma').click()
  await settle()
  expect(rowNames()).toEqual(['alpha', 'beta', 'gamma'])
  expect(saved).toEqual([])
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
})

it('a conflicting star refetches the list and warns', async () => {
  await mountSidebar()
  expect(api.listCommunities).toHaveBeenCalledTimes(1)
  api.subscribe.mockRejectedValue(
    new XrpcError(409, 'SubscriptionConflict', 'changed elsewhere'),
  )
  star('gamma').click()
  await settle()
  expect(api.listCommunities).toHaveBeenCalledTimes(2)
  expect(saved).toEqual([])
  await vi.waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning' }),
    ),
  )
})

it('a conflict whose refetch fails shows the error row, not the refreshed toast', async () => {
  await mountSidebar()
  api.subscribe.mockRejectedValue(
    new XrpcError(409, 'SubscriptionConflict', 'changed elsewhere'),
  )
  api.listCommunities.mockRejectedValue(new Error('down'))
  star('gamma').click()
  await vi.waitFor(() => expect(subscribedCommunities.status).toBe('error'))
  await settle()
  expect(toast).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'warning' }),
  )
})
