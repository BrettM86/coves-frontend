// @vitest-environment jsdom
import { createRequire } from 'node:module'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, expect, it, vi } from 'vitest'
import { settings } from '$lib/app/state/settings.svelte'
import { communityOrder } from '$lib/feature/community/community-order.svelte'
import type { DID } from '$lib/types/atproto'
import SidebarCommunities from './SidebarCommunities.svelte'

vi.mock('svelte', async () => {
  const entry = createRequire(import.meta.url)
    .resolve('svelte/package.json')
    .replace('package.json', 'src/index-client.js')
  return import(/* @vite-ignore */ entry)
})
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/') } }))
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: { current: { type: 'authenticated', did: 'did:plc:viewer' } },
}))
vi.mock('$lib/api/client.svelte', () => ({ coves: () => ({}) }))
vi.mock(
  '$lib/feature/community/subscribed-communities.svelte',
  async (original) => ({
    ...(await original<
      typeof import('$lib/feature/community/subscribed-communities.svelte')
    >()),
    subscribedCommunities: {
      owner: 'did:plc:viewer',
      status: 'loaded',
      communities: ['alpha', 'beta'].map((name) => ({
        name,
        did: `did:plc:${name}`,
      })),
    },
  }),
)

const target = document.createElement('div')
let mounted: ReturnType<typeof mount> | undefined

afterEach(async () => {
  if (mounted) await unmount(mounted)
  settings.expand.communities = true
  target.remove()
  vi.unstubAllGlobals()
})

it('moves the held tile even while the insertion slot stays the same', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  document.body.appendChild(target)
  mounted = mount(SidebarCommunities, { target })
  flushSync()
  const handles =
    target.querySelectorAll<HTMLButtonElement>('[data-reorder-did]')
  expect(handles).toHaveLength(2)
  const handle = handles[0]
  // jsdom has no layout or PointerEvent constructor. Both positions are above
  // the next row's midpoint, so only the held tile's visual offset changes.
  const nextRow = handles[1]?.closest('li')
  if (!nextRow || !handle) throw new Error('Expected two community rows')
  vi.spyOn(nextRow, 'getBoundingClientRect').mockReturnValue({
    top: 40,
    height: 40,
    left: 0,
    right: 200,
    bottom: 80,
    width: 200,
    x: 0,
    y: 40,
    toJSON: () => ({}),
  })
  function pointer(element: EventTarget, type: string, y: number) {
    element.dispatchEvent(
      new MouseEvent(type, { bubbles: true, buttons: 1, clientY: y }),
    )
    flushSync()
  }
  pointer(handle, 'pointerdown', 8)
  pointer(document, 'pointermove', 12)
  const tile = handle.closest<HTMLElement>('.tile')
  expect(tile?.style.getPropertyValue('--carry-y')).toBe('4px')
  pointer(document, 'pointermove', 18)
  expect(tile?.style.getPropertyValue('--carry-y')).toBe('10px')
  expect(target.querySelector('[data-reorder-did]')).toBe(handle)
  pointer(document, 'pointercancel', 18)
})

it.each([false, true])(
  'moves and refocuses the keyboard-selected tile with reduced motion set to %s',
  async (reducedMotion) => {
    vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }))
    communityOrder.load('did:plc:viewer' as DID, {
      get: () => [],
      set: () => {},
    })
    const animate = vi.fn()
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: animate,
    })
    try {
      document.body.appendChild(target)
      mounted = mount(SidebarCommunities, { target })
      flushSync()
      const handle =
        target.querySelector<HTMLButtonElement>('[data-reorder-did]')
      if (!handle) throw new Error('Missing reorder handle')
      const tile = handle.closest('.tile')
      const initialTop = handle.getBoundingClientRect()
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
        function (this: Element) {
          const rows = [...target.querySelectorAll('[data-row-did]')]
          const slot = this.closest('[data-row-did]')
          return { ...initialTop, top: slot ? rows.indexOf(slot) * 40 : 0 }
        },
      )
      handle.focus()
      handle.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      )
      await tick()
      expect(target.querySelectorAll('[data-reorder-did]')[1]).toBe(handle)
      await vi.waitFor(() =>
        expect(document.activeElement === handle).toBe(true),
      )
      if (reducedMotion) {
        expect(animate).not.toHaveBeenCalled()
      } else {
        const landing = animate.mock.contexts.indexOf(tile)
        expect(landing).toBeGreaterThanOrEqual(0)
        expect(animate.mock.calls[landing][0]).toEqual([
          expect.objectContaining({
            transform: expect.stringContaining('translateY(-40px)'),
          }),
          expect.objectContaining({
            transform: expect.stringContaining('scale('),
          }),
          expect.objectContaining({ transform: 'none' }),
        ])
      }
    } finally {
      Reflect.deleteProperty(Element.prototype, 'animate')
      communityOrder.reset()
    }
  },
)

it.each([false, true])(
  'closes and reopens the section with reduced motion set to %s',
  async (reducedMotion) => {
    vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }))
    // Leave the animation pending so the second click reverses the close.
    const animate = vi.fn(() => ({ cancel: () => {} }))
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: animate,
    })
    try {
      document.body.appendChild(target)
      mounted = mount(SidebarCommunities, { target, intro: false })
      flushSync()
      const toggle = target.querySelector<HTMLButtonElement>(
        '[aria-controls="sidebar-communities"]',
      )
      const list = target.querySelector<HTMLElement>('#sidebar-communities')
      if (!toggle || !list) throw new Error('Missing community disclosure')

      toggle.click()
      await tick()
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      if (reducedMotion) {
        expect(list.isConnected).toBe(false)
        expect(animate).not.toHaveBeenCalled()
      } else {
        expect(list.isConnected).toBe(true)
        expect(list.inert).toBe(true)
      }

      toggle.click()
      await tick()
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(target.querySelectorAll('#sidebar-communities')).toHaveLength(1)
      if (!reducedMotion) {
        expect(target.querySelector('#sidebar-communities')).toBe(list)
        expect(list.inert).toBeFalsy()
      }
    } finally {
      Reflect.deleteProperty(Element.prototype, 'animate')
    }
  },
)
