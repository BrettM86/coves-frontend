// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeToast, toast, toasts } from './toasts'

vi.mock('svelte', async () => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */
    require_
      .resolve('svelte/package.json')
      .replace('package.json', 'src/index-client.js')
  )
})

vi.mock('svelte/transition', () => ({
  fly: () => ({ duration: 0 }),
  scale: () => ({ duration: 0 }),
}))

vi.mock('svelte/animate', () => ({ flip: () => ({ duration: 0 }) }))

interface SvelteClient {
  mount: (
    component: unknown,
    options: { target: Element; props: unknown; intro?: boolean },
  ) => unknown
  unmount: (component: unknown, options?: { outro?: boolean }) => void
  flushSync: (fn?: () => void) => void
}

let client: SvelteClient
let mounted: unknown
let target: HTMLElement
const originalGetAnimations = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'getAnimations',
)

beforeEach(async () => {
  vi.useFakeTimers()
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
  toasts.set([])
  client = (await import('svelte')) as unknown as SvelteClient
  const { default: ToastContainer } = await import('./ToastContainer.svelte')
  target = document.createElement('div')
  document.body.appendChild(target)
  mounted = client.mount(ToastContainer, {
    target,
    intro: false,
    props: {},
  })
  client.flushSync()
})

afterEach(() => {
  if (mounted) client.unmount(mounted, { outro: false })
  toasts.set([])
  target?.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
  if (originalGetAnimations) {
    Object.defineProperty(
      Element.prototype,
      'getAnimations',
      originalGetAnimations,
    )
  } else {
    Reflect.deleteProperty(Element.prototype, 'getAnimations')
  }
})

describe('ToastContainer announcements', () => {
  it('provides an empty live region before any toast is added', () => {
    const region = target.querySelector('[aria-live="polite"]')

    expect(region).not.toBeNull()
    expect(region?.textContent?.trim()).toBe('')
    expect(region?.getAttribute('aria-atomic')).toBe('false')
  })

  it('adds success and failure feedback to the existing live region without nested announcements', () => {
    const region = target.querySelector('[aria-live="polite"]')
    expect(region).not.toBeNull()

    toast({ type: 'success', content: 'Community blocked' })
    client.flushSync()
    expect(region?.textContent).toContain('Community blocked')

    toast({ type: 'error', content: 'Could not subscribe to community' })
    client.flushSync()
    expect(region?.textContent).toContain('Could not subscribe to community')
    expect(target.querySelector('[aria-live="polite"]')).toBe(region)
    expect(
      region?.querySelectorAll('[aria-live], [role="status"], [role="alert"]'),
    ).toHaveLength(0)
  })

  it('keeps the region after dismissal and requests announcements only for additions and text changes', () => {
    const region = target.querySelector('[aria-live="polite"]')
    expect(region).not.toBeNull()
    expect(region?.getAttribute('aria-relevant')).toBe('additions text')

    const id = toast({ type: 'success', content: 'Community unblocked' })
    client.flushSync()
    expect(region?.textContent).toContain('Community unblocked')

    removeToast(id)
    client.flushSync()
    expect(target.querySelector('[aria-live="polite"]')).toBe(region)
    expect(region?.textContent?.trim()).toBe('')
  })
})
