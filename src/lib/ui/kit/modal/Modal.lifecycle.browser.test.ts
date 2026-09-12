// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { action, modal, shownModal } from './modal'
import { toasts } from '$lib/ui/kit/toast/toasts'

type PageState = { openModals?: string[]; marker?: string }
const navigation = vi.hoisted(() => ({
  read: (): PageState => ({}),
  push: (_state: PageState) => {},
  replace: (_state: PageState) => {},
  back: () => {},
}))

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$app/state', () => ({
  page: {
    get state() {
      return navigation.read()
    },
  },
}))
vi.mock('$app/navigation', () => ({
  pushState: (_url: string, state: PageState) => navigation.push(state),
  replaceState: (_url: string, state: PageState) => navigation.replace(state),
}))

// Match the existing mounted-component suites: Vitest otherwise resolves the
// server Svelte entry despite the jsdom environment.
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

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let additionalMounted:
  ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')

beforeEach(async () => {
  client = await import('svelte')
  const { SvelteMap } = await import('svelte/reactivity')
  const current = new SvelteMap<string, PageState>([
    ['state', { marker: 'original-page' }],
  ])
  const history: PageState[] = [{ marker: 'original-page' }]
  let index = 0
  navigation.read = () => current.get('state') ?? {}
  navigation.push = (state) => {
    history.splice(index + 1)
    history.push(state)
    index++
    current.set('state', state)
  }
  navigation.replace = (state) => {
    history[index] = state
    current.set('state', state)
  }
  navigation.back = () => {
    if (index > 0) index--
    current.set('state', history[index] ?? {})
  }
  vi.spyOn(window.history, 'back').mockImplementation(() => navigation.back())
  shownModal.set(undefined)
  toasts.set([])
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (additionalMounted)
    await client.unmount(additionalMounted, { outro: false })
  if (mounted) await client.unmount(mounted, { outro: false })
  additionalMounted = undefined
  mounted = undefined
  shownModal.set(undefined)
  toasts.set([])
  target.remove()
})

async function mountContainer(formatError?: (error: unknown) => string) {
  const Container = (await import('./ModalContainer.svelte')).default
  mounted = client.mount(Container, {
    target,
    props: { formatError },
    intro: false,
  })
  client.flushSync()
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === label,
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

async function settle() {
  await client.tick()
  client.flushSync()
}

function deferred() {
  let resolve = () => {}
  let reject = (_error: Error) => {}
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('modal browser history lifecycle', () => {
  it('handles Back each time an initially closed direct modal is opened', async () => {
    const Modal = (await import('./Modal.svelte')).default
    const { SvelteMap } = await import('svelte/reactivity')
    const state = new SvelteMap([['open', false]])
    const dismissed = vi.fn(() => state.set('open', false))
    mounted = client.mount(Modal, {
      target,
      intro: false,
      props: {
        get open() {
          return state.get('open') ?? false
        },
        set open(value: boolean) {
          state.set('open', value)
        },
        title: 'Reusable dialog',
        ondismissed: dismissed,
      },
    })
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    for (let opening = 1; opening <= 2; opening++) {
      state.set('open', true)
      await settle()
      expect(document.querySelector('[role="dialog"] h1')?.textContent).toBe(
        'Reusable dialog',
      )
      expect(navigation.read().openModals).toHaveLength(1)
      navigation.back()
      await settle()
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(dismissed).toHaveBeenCalledTimes(opening)
    }
  })

  it('dismisses an open direct modal when Escape is pressed', async () => {
    const Modal = (await import('./Modal.svelte')).default
    const { SvelteMap } = await import('svelte/reactivity')
    const state = new SvelteMap([['open', true]])
    const dismissed = vi.fn(() => state.set('open', false))
    mounted = client.mount(Modal, {
      target,
      intro: false,
      props: {
        get open() {
          return state.get('open') ?? false
        },
        set open(value: boolean) {
          state.set('open', value)
        },
        title: 'Keyboard dialog',
        ondismissed: dismissed,
      },
    })
    await settle()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    expect(window.dispatchEvent(escape)).toBe(false)
    await settle()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(dismissed).toHaveBeenCalledOnce()
    expect(navigation.read()).toEqual({ marker: 'original-page' })
  })

  it('clears modal history after a parent closes it and remains reusable', async () => {
    const Modal = (await import('./Modal.svelte')).default
    const { SvelteMap } = await import('svelte/reactivity')
    const state = new SvelteMap([['open', true]])
    mounted = client.mount(Modal, {
      target,
      intro: false,
      props: {
        get open() {
          return state.get('open') ?? false
        },
        set open(value: boolean) {
          state.set('open', value)
        },
        title: 'Reusable dialog',
      },
    })
    await settle()
    expect(navigation.read().openModals).toHaveLength(1)

    state.set('open', false)
    await settle()
    expect(window.history.back).toHaveBeenCalledOnce()
    expect(navigation.read()).toEqual({ marker: 'original-page' })

    state.set('open', true)
    await settle()
    expect(navigation.read().openModals).toHaveLength(1)
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
    )
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(navigation.read()).toEqual({ marker: 'original-page' })
  })

  it('dismisses only the topmost modal on Escape', async () => {
    const Modal = (await import('./Modal.svelte')).default
    const { SvelteMap } = await import('svelte/reactivity')
    const first = new SvelteMap([['open', true]])
    const second = new SvelteMap([['open', true]])
    const props = (state: {
      get(key: string): boolean | undefined
      set(key: string, value: boolean): unknown
    }) => ({
      get open() {
        return state.get('open') ?? false
      },
      set open(value: boolean) {
        state.set('open', value)
      },
    })
    mounted = client.mount(Modal, {
      target,
      intro: false,
      props: { ...props(first), title: 'First dialog' },
    })
    await settle()
    additionalMounted = client.mount(Modal, {
      target,
      intro: false,
      props: { ...props(second), title: 'Second dialog' },
    })
    await settle()
    expect(navigation.read().openModals).toHaveLength(2)

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
    )
    await settle()

    const titles = [...document.querySelectorAll('[role="dialog"] h1')].map(
      (title) => title.textContent,
    )
    expect(titles).toEqual(['First dialog'])
    expect(navigation.read().openModals).toHaveLength(1)
  })

  it('closes only a nested popover on Escape and returns focus to its trigger', async () => {
    const Fixture = (await import('./ModalPopoverEscape.fixture.svelte'))
      .default
    mounted = client.mount(Fixture, { target, intro: false })
    await settle()

    const trigger = button('Open options')
    trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await settle()
    const popoverAction = button('Popover action')
    popoverAction.focus()
    expect(document.activeElement).toBe(popoverAction)

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    expect.soft(popoverAction.dispatchEvent(escape)).toBe(false)
    await settle()

    expect
      .soft(document.querySelector('[role="dialog"] h1')?.textContent)
      .toBe('Profile dialog')
    expect.soft(navigation.read().openModals ?? []).toHaveLength(1)
    expect
      .soft(
        [...document.querySelectorAll('button')].some(
          (candidate) => candidate.textContent?.trim() === 'Popover action',
        ),
      )
      .toBe(false)
    expect.soft(document.activeElement).toBe(trigger)
  })

  it('ignores Escape when the topmost modal is not dismissable', async () => {
    const Modal = (await import('./Modal.svelte')).default
    mounted = client.mount(Modal, {
      target,
      intro: false,
      props: {
        open: true,
        dismissable: false,
        title: 'Required dialog',
      },
    })
    await settle()

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true,
    })
    expect(window.dispatchEvent(escape)).toBe(true)
    await settle()

    expect(document.querySelector('[role="dialog"] h1')?.textContent).toBe(
      'Required dialog',
    )
    expect(navigation.read().openModals).toHaveLength(1)
  })

  it.each(['Back', 'replacement'] as const)(
    'shows one friendly error toast when a pending action fails after %s',
    async (departure) => {
      const friendlyMessage =
        'The server is temporarily unreachable. Please try again.'
      await mountContainer(() => friendlyMessage)
      const request = deferred()
      modal({
        title: 'Old confirmation',
        actions: [action({ content: 'Delete', action: () => request.promise })],
      })
      await settle()
      button('Delete').click()
      await settle()
      if (departure === 'Back') navigation.back()
      else modal({ title: 'New confirmation' })
      await settle()
      request.reject(new TypeError('Failed to fetch'))
      await request.promise.catch(() => {})
      await settle()

      expect(get(toasts)).toHaveLength(1)
      expect(get(toasts)[0]).toMatchObject({
        content: friendlyMessage,
        type: 'error',
      })
      expect(document.querySelector('[role="alert"]')).toBeNull()
      if (departure === 'Back') {
        expect(get(shownModal)).toBeUndefined()
        expect(document.querySelector('[role="dialog"]')).toBeNull()
      } else {
        expect(document.querySelector('[role="dialog"] h1')?.textContent).toBe(
          'New confirmation',
        )
      }
    },
  )

  it('shows an active action failure inline without a duplicate toast', async () => {
    const friendlyMessage =
      'The server is temporarily unreachable. Please try again.'
    await mountContainer(() => friendlyMessage)
    const request = deferred()
    modal({
      title: 'Delete post',
      actions: [action({ content: 'Delete', action: () => request.promise })],
    })
    await settle()
    button('Delete').click()
    await settle()
    request.reject(new TypeError('Failed to fetch'))
    await request.promise.catch(() => {})
    await settle()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      friendlyMessage,
    )
    expect(get(toasts)).toEqual([])
    expect(button('Delete').disabled).toBe(false)
  })

  it('clears the current confirmation when browser Back closes it', async () => {
    await mountContainer()
    modal({ title: 'First confirmation' })
    await settle()
    expect(document.querySelector('[role="dialog"] h1')?.textContent).toBe(
      'First confirmation',
    )
    expect(navigation.read().openModals).toHaveLength(1)

    navigation.back()
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(get(shownModal)).toBeUndefined()
    expect(navigation.read().marker).toBe('original-page')
  })

  it.each(['success', 'failure'] as const)(
    'shows a new confirmation after Back during a pending action, including late %s',
    async (outcome) => {
      await mountContainer()
      const request = deferred()
      modal({
        title: 'Old confirmation',
        actions: [action({ content: 'Delete', action: () => request.promise })],
      })
      await settle()
      button('Delete').click()
      await settle()
      expect(button('Delete').disabled).toBe(true)
      navigation.back()
      await settle()
      modal({ title: 'New confirmation' })
      await settle()
      expect(document.querySelector('[role="dialog"] h1')?.textContent).toBe(
        'New confirmation',
      )

      if (outcome === 'success') request.resolve()
      else request.reject(new Error('Old request failed'))
      await request.promise.catch(() => {})
      await settle()
      expect(document.querySelector('[role="dialog"] h1')?.textContent).toBe(
        'New confirmation',
      )
      expect(document.querySelector('[role="alert"]')).toBeNull()
      expect(navigation.read().openModals).toHaveLength(1)
    },
  )

  it('does not revive a confirmation when its request fails after Back', async () => {
    await mountContainer()
    const request = deferred()
    modal({
      title: 'Delete post',
      actions: [action({ content: 'Delete', action: () => request.promise })],
    })
    await settle()
    button('Delete').click()
    await settle()
    navigation.back()
    await settle()
    request.reject(new Error('Deletion failed'))
    await request.promise.catch(() => {})
    await settle()
    expect(get(shownModal)).toBeUndefined()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('removes completed confirmation history before opening another dialog', async () => {
    await mountContainer()
    modal({ title: 'First confirmation' })
    await settle()
    navigation.replace({
      ...navigation.read(),
      marker: 'page-state-to-preserve',
    })
    button('Close').click()
    await settle()
    expect(get(shownModal)).toBeUndefined()
    expect(navigation.read().openModals ?? []).toEqual([])
    expect(navigation.read().marker).toBe('page-state-to-preserve')

    modal({ title: 'Second confirmation' })
    await settle()
    expect(navigation.read().openModals).toHaveLength(1)
    navigation.back()
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps a replacement visible when the previous action completes', async () => {
    await mountContainer()
    const request = deferred()
    modal({
      title: 'Old confirmation',
      actions: [action({ content: 'Delete', action: () => request.promise })],
    })
    await settle()
    button('Delete').click()
    await settle()
    modal({ title: 'New confirmation' })
    await settle()
    request.resolve()
    await request.promise
    await settle()
    expect(document.querySelector('[role="dialog"] h1')?.textContent).toBe(
      'New confirmation',
    )
    expect(navigation.read().openModals).toHaveLength(1)
    navigation.back()
    await settle()
    expect(get(shownModal)).toBeUndefined()
  })

  it('lets an explicit primary action close a non-dismissable dialog', async () => {
    const Modal = (await import('./Modal.svelte')).default
    const complete = vi.fn()
    const dismissed = vi.fn()
    mounted = client.mount(Modal, {
      target,
      intro: false,
      props: {
        open: true,
        dismissable: false,
        action: 'Finish',
        title: 'Required action',
        onaction: complete,
        ondismissed: dismissed,
      },
    })
    await settle()
    button('Finish').click()
    await settle()
    expect(complete).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(dismissed).toHaveBeenCalledTimes(1)
  })
})
