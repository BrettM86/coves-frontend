// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type PageState = { openModals?: string[]; marker?: string }
const navigation = vi.hoisted(() => ({
  read: (): PageState => ({}),
  push: (_state: PageState) => {},
  replace: (_state: PageState) => {},
  back: () => {},
  goto: vi.fn(),
}))

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
}))
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/state', () => ({
  page: {
    url: new URL('https://coves.test/'),
    data: {},
    get state() {
      return navigation.read()
    },
  },
}))
vi.mock('$app/navigation', () => ({
  goto: navigation.goto,
  pushState: (_url: string, state: PageState) => navigation.push(state),
  replaceState: (_url: string, state: PageState) => navigation.replace(state),
}))
vi.mock('$lib/app/state/auth.svelte', () => ({
  profile: { meta: {}, current: { type: 'guest' } },
}))
vi.mock('$lib/app/state/theme/theme.svelte', () => ({
  theme: { data: { themes: [] }, colorScheme: 'system' },
}))
vi.mock('$lib/feature/legacy/item.svelte', () => ({
  resumables: { items: [] },
}))
vi.mock('./actions.svelte', () => ({
  getGroups: () => [
    {
      name: 'Test commands',
      actions: [
        {
          name: 'Parent command',
          icon: '',
          subActions: [{ name: 'Child command', icon: '', href: '/child' }],
        },
      ],
    },
  ],
  dynamicActions: (query: string) => ({
    name: 'Search',
    actions: [{ name: query, icon: '', href: `/search?q=${query}` }],
  }),
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

let target: HTMLDivElement
let mounted: ReturnType<(typeof import('svelte'))['mount']> | undefined
let client: typeof import('svelte')

beforeEach(async () => {
  client = await import('svelte')
  const { SvelteMap } = await import('svelte/reactivity')
  const current = new SvelteMap<string, PageState>([
    ['state', { marker: 'profile-page' }],
  ])
  const history: PageState[] = [{ marker: 'profile-page' }]
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
  navigation.back = vi.fn(() => {
    if (index > 0) index--
    current.set('state', history[index] ?? {})
  })
  vi.spyOn(window.history, 'back').mockImplementation(() => navigation.back())

  const { chords } = await import('./CommandsHost.svelte')
  chords.commands = false
  target = document.createElement('div')
  document.body.appendChild(target)
  const CommandsHost = (await import('./CommandsHost.svelte')).default
  mounted = client.mount(CommandsHost, { target, intro: false })
  client.flushSync()
})

afterEach(async () => {
  if (mounted) await client.unmount(mounted, { outro: false })
  mounted = undefined
  const { chords } = await import('./CommandsHost.svelte')
  chords.commands = false
  target.remove()
  vi.restoreAllMocks()
})

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

async function settle(): Promise<void> {
  await client.tick()
  client.flushSync()
}

function pressFocusedPaletteKey(key: 'Enter' | 'Escape'): void {
  const focused = document.activeElement
  if (
    !(focused instanceof HTMLElement) ||
    !focused.closest('[role="dialog"]') ||
    !focused.matches('input, button, a, [role="button"], [role="link"]')
  )
    throw new Error('The palette input or action does not own focus')

  focused.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    }),
  )
}

async function openCommands(): Promise<void> {
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      cancelable: true,
    }),
  )
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain('Parent command'),
  )
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      document.querySelector('input[placeholder="nav.commands.prompt"]'),
    ),
  )
}

describe('command palette Escape lifecycle', () => {
  it('pops a breadcrumb without closing or changing modal history', async () => {
    await openCommands()
    expect(navigation.read().openModals).toHaveLength(1)

    pressFocusedPaletteKey('Enter')
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Child command'),
    )

    pressFocusedPaletteKey('Escape')
    await settle()

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(button('Parent command')).toBeDefined()
    expect(
      [...document.querySelectorAll('button')].some((candidate) =>
        candidate.textContent?.includes('Child command'),
      ),
    ).toBe(false)
    expect(navigation.back).not.toHaveBeenCalled()
    expect(navigation.read().openModals).toHaveLength(1)
  })

  it('pops a clicked breadcrumb without closing or changing modal history', async () => {
    await openCommands()
    expect(navigation.read().openModals).toHaveLength(1)

    const parent = button('Parent command')
    parent.focus()
    parent.click()
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Child command'),
    )

    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    )
    await settle()
    await settle()

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(button('Parent command')).toBeDefined()
    expect(
      [...document.querySelectorAll('button')].some((candidate) =>
        candidate.textContent?.includes('Child command'),
      ),
    ).toBe(false)
    expect(navigation.back).not.toHaveBeenCalled()
    expect(navigation.read().openModals).toHaveLength(1)
  })

  it('closes once at the root and reopens with clean state and history', async () => {
    await openCommands()
    expect(navigation.read().openModals).toHaveLength(1)

    pressFocusedPaletteKey('Escape')
    await settle()
    await settle()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(navigation.back).toHaveBeenCalledOnce()
    expect(navigation.read()).toEqual({ marker: 'profile-page' })

    await openCommands()
    expect(navigation.read().openModals).toHaveLength(1)
    expect(button('Parent command')).toBeDefined()
    expect(
      [...document.querySelectorAll('button')].some((candidate) =>
        candidate.textContent?.includes('Child command'),
      ),
    ).toBe(false)
  })
})
