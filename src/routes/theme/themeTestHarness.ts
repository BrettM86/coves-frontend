/**
 * Test support for the theme route's jsdom component tests. Not shipped.
 *
 * Each test file still declares its own `vi.mock` calls (they are hoisted per
 * file); the factories live here so the files share one definition:
 *
 *   vi.mock('$app/state', async () =>
 *     (await import('./themeTestHarness')).appStateModule())
 *
 * This module must not statically import anything that is itself mocked.
 */
import { afterEach, beforeEach, vi } from 'vitest'
import type { Component } from 'svelte'

export const pageState: { openModals: string[] } = { openModals: [] }

export const appEnvironmentModule = () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test',
})

export const appStateModule = () => ({
  page: { state: pageState, url: new URL('http://localhost/theme') },
})

export const appNavigationModule = () => ({
  goto: vi.fn().mockResolvedValue(undefined),
  pushState: (_url: string, next: typeof pageState) =>
    Object.assign(pageState, next),
  replaceState: (_url: string, next: typeof pageState) =>
    Object.assign(pageState, next),
})

/** The i18n `t` store returns the key itself, so tests assert on keys. */
export const i18nModule = () => {
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
}

/** Svelte's client entry points; vitest resolves the server build in jsdom. */
export const svelteClientEntry = async (subpath: string): Promise<unknown> => {
  const { createRequire } = await import('node:module')
  const require_ = createRequire(import.meta.url)
  return await import(
    /* @vite-ignore */ require_
      .resolve('svelte/package.json')
      .replace('package.json', subpath)
  )
}

/** Literal copy of KELP_DEFAULT in presets.ts — expected values, not computed. */
export function kelpColors() {
  return {
    slate: {
      '25': '252 253 254',
      '50': '248 250 252',
      '100': '241 245 249',
      '200': '226 232 240',
      '300': '203 213 225',
      '400': '148 163 184',
      '500': '100 116 139',
      '600': '71 85 105',
      '700': '51 65 85',
      '800': '30 41 59',
      '900': '15 23 42',
      '950': '2 6 23',
    },
    zinc: {
      '50': '252 252 254',
      '100': '248 248 251',
      '200': '235 235 240',
      '300': '222 222 228',
      '400': '175 175 185',
      '500': '128 128 138',
      '600': '98 98 108',
      '700': '68 68 76',
      '800': '47 47 54',
      '900': '34 34 39',
      '925': '28 28 32',
      '950': '25 25 29',
    },
    primary: {
      '100': '241 245 249',
      '900': '15 23 42',
    },
    other: {
      black: '0 0 0',
      white: '255 255 255',
    },
  }
}

export function accessibleName(element: Element): string {
  const labelledBy = element.getAttribute('aria-labelledby')
  const labelledText = labelledBy
    ? document.getElementById(labelledBy)?.textContent?.trim()
    : undefined
  const id = element.getAttribute('id')
  const forLabel = id
    ? document.querySelector(`label[for="${id}"]`)?.textContent?.trim()
    : undefined
  return (
    element.getAttribute('aria-label') ??
    labelledText ??
    element.getAttribute('title') ??
    forLabel ??
    element.closest('label')?.textContent?.trim() ??
    element.textContent?.trim() ??
    ''
  )
}

export function buttonNamed(
  name: string,
  scope: ParentNode,
): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((button) =>
    accessibleName(button).includes(name),
  )
  if (!found) throw new Error(`Missing button ${name}`)
  return found
}

type ThemeModule = typeof import('$lib/app/state/theme/theme.svelte')

export interface ThemeHarness {
  readonly target: HTMLDivElement
  readonly client: typeof import('svelte')
  readonly themeState: ThemeModule['theme']
  setPrefersDark(value: boolean): void
  mount<Props extends Record<string, unknown>>(
    component: Component<Props>,
    props: Props,
  ): void
  mountModalHost(): Promise<void>
}

/**
 * Registers beforeEach/afterEach for a theme component test: stubs
 * ResizeObserver and matchMedia, clears storage and open modals, and seeds
 * the real theme state with the presets plus custom themes 1 and 2 (2 is
 * current), both with Kelp colours. Tests reseed `themeState.data` as needed.
 */
export function useThemeHarness(): ThemeHarness {
  let target: HTMLDivElement | undefined
  let client: typeof import('svelte') | undefined
  let themeState: ThemeModule['theme'] | undefined
  let mounted: ReturnType<(typeof import('svelte'))['mount']>[] = []
  let prefersDark = false

  const required = <Value>(value: Value | undefined, name: string): Value => {
    if (value === undefined) throw new Error(`${name} used before setup`)
    return value
  }

  beforeEach(async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    prefersDark = false
    window.matchMedia = (query: string) =>
      ({
        matches: query.includes('dark') ? prefersDark : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
    localStorage.clear()
    pageState.openModals = []
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
    mounted = []
    client = await import('svelte')
    const { shownModal } = await import('$lib/ui/kit/modal/modal')
    shownModal.set(undefined)
    const { presets } = await import('$lib/app/state/theme/presets')
    themeState = (await import('$lib/app/state/theme/theme.svelte')).theme
    themeState.colorScheme = 'dark'
    themeState.data = {
      scheme: 'system',
      themes: [
        ...presets,
        { id: 1, name: 'Custom 1', colors: kelpColors() },
        { id: 2, name: 'Custom 2', colors: kelpColors() },
      ],
      currentTheme: 2,
    }
    target = document.createElement('div')
    document.body.appendChild(target)
    client.flushSync()
  })

  afterEach(async () => {
    const svelte = required(client, 'client')
    for (const component of mounted)
      await svelte.unmount(component, { outro: false })
    target?.remove()
    vi.unstubAllGlobals()
  })

  const harness: ThemeHarness = {
    get target() {
      return required(target, 'target')
    },
    get client() {
      return required(client, 'client')
    },
    get themeState() {
      return required(themeState, 'themeState')
    },
    setPrefersDark(value) {
      prefersDark = value
    },
    mount(component, props) {
      const svelte = required(client, 'client')
      mounted.push(
        svelte.mount(component, {
          target: required(target, 'target'),
          intro: false,
          props,
        }),
      )
      svelte.flushSync()
    },
    async mountModalHost() {
      const Container = (
        await import('$lib/ui/kit/modal/ModalContainer.svelte')
      ).default
      harness.mount(Container, {
        formatError: (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      })
    },
  }
  return harness
}
