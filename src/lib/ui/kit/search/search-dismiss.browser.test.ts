// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
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
  scale: () => ({ duration: 0 }),
}))
vi.mock('svelte-floating-ui', () => ({
  createFloatingActions: () => [
    () => ({ destroy: () => {} }),
    () => ({ update: () => {}, destroy: () => {} }),
  ],
}))
// The focus trap is stubbed out unless a test opts into the real one.
const focusTrap = vi.hoisted(() => ({ real: false, realCalls: 0 }))
vi.mock('trap-focus-svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('trap-focus-svelte')>()
  return {
    trapFocus: (...args: Parameters<typeof actual.trapFocus>) => {
      if (!focusTrap.real) return { destroy: () => {} }
      focusTrap.realCalls++
      return actual.trapFocus(...args)
    },
  }
})

let target: HTMLDivElement
let client: typeof import('svelte')
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
/** The search the mounted fixture calls; a test may swap it before acting. */
let searchImplementation: (query: string) => Promise<string[]>

beforeEach(async () => {
  client = await import('svelte')
  target = document.createElement('div')
  document.body.appendChild(target)
  const Fixture = (await import('./Search.fixture.svelte')).default
  searchImplementation = async () => ['alpha', 'beta']
  mounted = client.mount(Fixture, {
    target,
    intro: false,
    props: { search: (query: string) => searchImplementation(query) },
  })
  client.flushSync()
}, 30_000)

afterEach(async () => {
  vi.useRealTimers()
  focusTrap.real = false
  focusTrap.realCalls = 0
  const component = mounted
  mounted = undefined
  if (component) await client.unmount(component, { outro: false })
  target.remove()
  document.body.replaceChildren()
})

/**
 * The event sequence a mouse click produces in a browser: mousedown moves
 * focus (to the element if it is focusable, otherwise off the focused one),
 * then mouseup and click fire on the element.
 */
function userClick(element: HTMLElement): void {
  const init = { bubbles: true, cancelable: true, composed: true }
  element.dispatchEvent(new MouseEvent('mousedown', init))
  if (element.tabIndex >= 0) element.focus()
  else (document.activeElement as HTMLElement | null)?.blur()
  element.dispatchEvent(new MouseEvent('mouseup', init))
  element.dispatchEvent(new MouseEvent('click', init))
  client.flushSync()
}

function resultNames(): string[] {
  return [
    ...document.body.querySelectorAll<HTMLElement>('[role="menu"] button'),
  ].map((button) => button.textContent?.trim() ?? '')
}

function spinnerShown(): boolean {
  return document.body.querySelector('[role="menu"] svg.animate-spin') != null
}

function menuOpen(): boolean {
  return document.body.querySelector('[role="menu"]') != null
}

function searchInput(): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>(
    'input[placeholder="Community"]',
  )
  if (!input) throw new Error('Missing search input')
  return input
}

function outsideElement(): HTMLElement {
  const outside = [...document.body.querySelectorAll('p')].find(
    (element) => element.textContent === 'Somewhere else on the page',
  )
  if (!outside) throw new Error('Missing outside element')
  return outside
}

/** Types one character the way a keyboard does: value change, then input. */
function typeCharacter(input: HTMLInputElement, character: string): void {
  input.value += character
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  client.flushSync()
}

async function waitForResults(): Promise<void> {
  await vi.waitFor(
    () => {
      client.flushSync()
      expect(resultNames()).toEqual(['alpha', 'beta'])
    },
    { timeout: 2000 },
  )
}

describe('Search dismissal', () => {
  it('closes the results menu on a click outside after results appear', async () => {
    const input = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="Community"]',
    )
    if (!input) throw new Error('Missing search input')
    const outside = [...document.body.querySelectorAll('p')].find(
      (element) => element.textContent === 'Somewhere else on the page',
    )
    if (!outside) throw new Error('Missing outside element')

    userClick(input)
    await vi.waitFor(
      () => {
        client.flushSync()
        expect(resultNames()).toEqual(['alpha', 'beta'])
      },
      { timeout: 2000 },
    )

    // Fake timers from here so the debounce window after the outside click
    // can be run out deterministically instead of slept through.
    vi.useFakeTimers()
    userClick(outside)
    await vi.advanceTimersByTimeAsync(1000)
    client.flushSync()

    expect(menuOpen()).toBe(false)
  })

  it('keeps the menu closed when a pending search resolves after a click outside', async () => {
    const input = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="Community"]',
    )
    if (!input) throw new Error('Missing search input')
    const outside = [...document.body.querySelectorAll('p')].find(
      (element) => element.textContent === 'Somewhere else on the page',
    )
    if (!outside) throw new Error('Missing outside element')

    let resolveSearch: (results: string[]) => void = () => {
      throw new Error('Search was never called')
    }
    searchImplementation = () =>
      new Promise<string[]>((resolve) => {
        resolveSearch = resolve
      })

    vi.useFakeTimers()
    userClick(input)
    // Run out the 300ms debounce so the search starts and stays pending.
    await vi.advanceTimersByTimeAsync(400)
    client.flushSync()
    expect(menuOpen()).toBe(true)
    expect(spinnerShown()).toBe(true)

    // Dismiss while the search is still pending, then let the debounce run
    // out and the search resolve.
    userClick(outside)
    expect(menuOpen()).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    resolveSearch(['alpha', 'beta'])
    await vi.advanceTimersByTimeAsync(1000)
    client.flushSync()

    expect(menuOpen()).toBe(false)
  })

  it('keeps the menu closed when the debounced search fires after a click outside', async () => {
    const input = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="Community"]',
    )
    if (!input) throw new Error('Missing search input')
    const outside = [...document.body.querySelectorAll('p')].find(
      (element) => element.textContent === 'Somewhere else on the page',
    )
    if (!outside) throw new Error('Missing outside element')

    let resolveSearch: (results: string[]) => void = () => {
      throw new Error('Search was never called')
    }
    searchImplementation = () =>
      new Promise<string[]>((resolve) => {
        resolveSearch = resolve
      })

    vi.useFakeTimers()
    userClick(input)
    // Dismiss inside the 300ms debounce window, before the search has even
    // started, then let the debounce run out and the search resolve.
    await vi.advanceTimersByTimeAsync(100)
    userClick(outside)
    await vi.advanceTimersByTimeAsync(1000)
    resolveSearch(['alpha', 'beta'])
    await vi.advanceTimersByTimeAsync(1000)
    client.flushSync()

    expect(menuOpen()).toBe(false)
  })

  it.each([
    {
      opened: 'by typing after keyboard focus, with no click on the input',
      open: async () => {
        const input = searchInput()
        input.focus()
        client.flushSync()
        typeCharacter(input, 'a')
        await waitForResults()
      },
    },
    {
      opened: 'by typing again after a result was selected',
      open: async () => {
        const input = searchInput()
        userClick(input)
        await waitForResults()
        const result = [
          ...document.body.querySelectorAll<HTMLElement>(
            '[role="menu"] button',
          ),
        ].find((button) => button.textContent?.trim() === 'alpha')
        if (!result) throw new Error('Missing result button')
        userClick(result)
        typeCharacter(input, 'b')
        await waitForResults()
      },
    },
  ])(
    'closes the results menu on a click outside when it was opened $opened',
    async ({ open }) => {
      await open()
      expect(menuOpen()).toBe(true)

      vi.useFakeTimers()
      userClick(outsideElement())
      await vi.advanceTimersByTimeAsync(1000)
      client.flushSync()

      expect(menuOpen()).toBe(false)
    },
  )

  it('opens the results menu on ArrowDown after keyboard focus', async () => {
    const input = searchInput()
    input.focus()
    client.flushSync()
    expect(menuOpen()).toBe(false)

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    )
    client.flushSync()

    await waitForResults()
  })

  it('stays closed after a click outside when the real focus trap hands focus back', async () => {
    focusTrap.real = true
    const input = searchInput()

    userClick(input)
    await waitForResults()
    expect(focusTrap.realCalls).toBeGreaterThan(0)

    vi.useFakeTimers()
    userClick(outsideElement())
    await vi.advanceTimersByTimeAsync(1000)
    client.flushSync()

    expect(menuOpen()).toBe(false)
  })
})
