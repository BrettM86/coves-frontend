// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The module-level `$effect.root` persist effects and the cross-tab `storage`
 * listener only run under Svelte's client runtime, so `svelte` resolves to the
 * client entry here (same approach as FeedTabs.browser.test.ts).
 */
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

/** Literal copy of COVES_COLORS in presets.ts — expected values, not computed. */
function covesColors() {
  return {
    slate: {
      '25': '252 253 254',
      '50': '253 252 250',
      '100': '241 245 249',
      '200': '226 232 240',
      '300': '203 213 225',
      '400': '148 163 184',
      '500': '100 116 139',
      '600': '71 85 105',
      '700': '51 65 85',
      '800': '30 41 59',
      '900': '26 26 28',
      '950': '2 6 23',
    },
    zinc: {
      '50': '252 252 254',
      '100': '255 248 240',
      '200': '235 235 240',
      '300': '222 222 228',
      '400': '175 175 185',
      '500': '128 128 138',
      '600': '98 98 108',
      '700': '68 68 76',
      '800': '47 47 54',
      '900': '34 34 39',
      '925': '28 28 32',
      '950': '15 15 16',
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

/** Seeds jsdom's real localStorage with one custom theme (id 1) selected. */
function seedCustomTheme() {
  localStorage.setItem(
    'theme.data',
    JSON.stringify({
      scheme: 'system',
      currentTheme: 1,
      themes: [{ id: 1, name: 'Custom 1', colors: covesColors() }],
    }),
  )
}

async function importTheme(publicEnv: Record<string, string> = {}) {
  vi.resetModules()
  vi.doMock('$app/environment', () => ({
    browser: true,
    dev: true,
    building: false,
  }))
  vi.doMock('$env/dynamic/public', () => ({ env: publicEnv }))
  const { theme } = await import('./theme.svelte')
  const { flushSync: flushRuntime } = await import('svelte')
  // The mocked `svelte` entry survives vi.resetModules() but the compiled
  // module's `svelte/internal/client` is re-instantiated, so this flushSync can
  // belong to a stale runtime. The fresh runtime schedules its effects on a
  // microtask, so awaiting one after the flush runs them deterministically.
  const flushSync = async () => {
    flushRuntime()
    await Promise.resolve()
  }
  await flushSync()
  return { theme, flushSync }
}

interface StoredTheme {
  id: number
  colors: Record<string, Record<string, string>>
}

beforeEach(() => {
  localStorage.clear()
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query }) as MediaQueryList
})

describe('theme reactive persistence', () => {
  it('persists an edited colour to theme.vars and theme.data', async () => {
    seedCustomTheme()
    const { theme, flushSync } = await importTheme()

    theme.setColor('zinc', '900', '#ff0000')
    await flushSync()

    expect(localStorage.getItem('theme.vars')).toContain(
      '--color-zinc-900:rgb(255 0 0)',
    )
    const stored = JSON.parse(localStorage.getItem('theme.data') ?? '{}') as {
      themes: StoredTheme[]
    }
    const custom = stored.themes.find((t) => t.id === 1)
    expect(custom?.colors.zinc['900']).toBe('255 0 0')
  })

  describe('colorScheme cookie', () => {
    const assignments: string[] = []

    beforeEach(() => {
      assignments.length = 0
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => '',
        set: (value: string) => {
          assignments.push(value)
        },
      })
    })

    afterEach(() => {
      // Remove the own-property override so Document.prototype's accessor
      // is visible again.
      Reflect.deleteProperty(document, 'cookie')
    })

    it('writes the colour scheme to a site-wide lax cookie', async () => {
      const { theme, flushSync } = await importTheme()

      theme.colorScheme = 'light'
      await flushSync()

      const cookie = assignments.find((value) =>
        value.includes('colorScheme=light'),
      )
      expect(cookie).toBeDefined()
      const lower = (cookie ?? '').toLowerCase()
      expect(lower).toContain('path=/')
      expect(lower).toContain('max-age=')
      expect(lower).toContain('samesite=lax')
    })
  })
})

/**
 * Grain is on only for the built-in Coves default (theme id 0 with no
 * PUBLIC_THEME). The server stamps data-grain on <html>; the theme state keeps
 * it in step with the selected theme.
 */
describe('theme grain marker on <html>', () => {
  const hasGrain = () => document.documentElement.hasAttribute('data-grain')

  beforeEach(() => {
    document.documentElement.setAttribute('data-grain', '')
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-grain')
  })

  it.each([
    { selected: -1, name: 'Classic', grain: false },
    { selected: -2, name: 'AMOLED', grain: false },
    { selected: -10, name: 'Mono', grain: false },
    { selected: 0, name: 'Coves', grain: true },
    { selected: -99, name: 'a preset id that does not exist', grain: true },
  ])(
    'selecting $name (id $selected) leaves grain $grain',
    async ({ selected, grain }) => {
      const { theme, flushSync } = await importTheme()

      theme.data.currentTheme = selected
      await flushSync()

      expect(hasGrain()).toBe(grain)
    },
  )

  it('removes grain while a custom theme is selected', async () => {
    seedCustomTheme()
    const { flushSync } = await importTheme()
    await flushSync()

    expect(hasGrain()).toBe(false)
  })

  // These start without the marker so they fail unless the state adds it back,
  // not just leaves the server's marker alone.
  it('restores grain when switching back to Coves', async () => {
    document.documentElement.removeAttribute('data-grain')
    const { theme, flushSync } = await importTheme()
    theme.data.currentTheme = -1
    await flushSync()

    theme.data.currentTheme = 0
    await flushSync()

    expect(hasGrain()).toBe(true)
  })

  it('restores grain when switching from a custom theme back to Coves', async () => {
    // theme-boot.js already removed it for the stored custom selection.
    document.documentElement.removeAttribute('data-grain')
    seedCustomTheme()
    const { theme, flushSync } = await importTheme()
    await flushSync()

    theme.data.currentTheme = 0
    await flushSync()

    expect(hasGrain()).toBe(true)
  })

  it('sets grain when the selected custom id no longer exists and Coves shows', async () => {
    document.documentElement.removeAttribute('data-grain')
    const { theme, flushSync } = await importTheme()

    theme.data.currentTheme = 99
    await flushSync()

    expect(theme.current.name).toBe('Coves')
    expect(hasGrain()).toBe(true)
  })

  it.each([
    { selected: 0, name: 'Instance Default' },
    { selected: -10, name: 'Mono' },
  ])(
    'never sets grain with PUBLIC_THEME, selecting $name (id $selected)',
    async ({ selected }) => {
      document.documentElement.removeAttribute('data-grain')
      const { theme, flushSync } = await importTheme({
        PUBLIC_THEME: JSON.stringify({ zinc: { '950': '1 2 3' } }),
      })

      theme.data.currentTheme = -1
      await flushSync()
      theme.data.currentTheme = selected
      await flushSync()

      expect(hasGrain()).toBe(false)
    },
  )
})

describe('theme cross-tab sync', () => {
  it('replaces custom themes with the list written by another tab', async () => {
    seedCustomTheme()
    const { theme } = await importTheme()
    const newValue = JSON.stringify({
      scheme: 'system',
      currentTheme: 2,
      themes: [
        {
          id: 2,
          name: 'Other tab',
          colors: { zinc: { '900': '#ff0000' } },
        },
      ],
    })
    // The browser has already stored the other tab's value when the event fires.
    localStorage.setItem('theme.data', newValue)

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'theme.data', newValue }),
    )

    expect(theme.data.currentTheme).toBe(2)
    const incoming = theme.data.themes.find((t) => t.id === 2)
    expect(incoming?.name).toBe('Other tab')
    expect(incoming?.colors.zinc['900']).toBe('255 0 0')
    expect(incoming?.colors.primary['900']).toBe('15 23 42')
    expect(theme.data.themes.some((t) => t.id === 1)).toBe(false)
    const defaultPreset = theme.data.themes.find((t) => t.id === 0)
    expect(defaultPreset?.name).toBe('Coves')
  })

  it('follows a colour scheme changed in another tab', async () => {
    const { theme } = await importTheme()
    localStorage.setItem('colorScheme', 'light')

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'colorScheme', newValue: 'light' }),
    )

    expect(theme.colorScheme).toBe('light')
  })

  it('ignores unparseable theme.data from another tab', async () => {
    seedCustomTheme()
    const { theme } = await importTheme()
    // The browser has already stored the other tab's value when the event fires.
    localStorage.setItem('theme.data', '{not json')

    expect(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'theme.data',
          newValue: '{not json',
        }),
      ),
    ).not.toThrow()
    expect(theme.data.currentTheme).toBe(1)
  })

  it('keeps the stored colour scheme over a late event carrying an older one', async () => {
    localStorage.setItem('colorScheme', 'system')
    const { theme } = await importTheme()

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'colorScheme', newValue: 'light' }),
    )

    expect(theme.colorScheme).toBe('system')
  })

  it('keeps the stored theme.data over a late event carrying an older one', async () => {
    seedCustomTheme()
    const { theme } = await importTheme()

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'theme.data',
        newValue: JSON.stringify({
          scheme: 'system',
          currentTheme: 2,
          themes: [{ id: 2, name: 'Older', colors: covesColors() }],
        }),
      }),
    )

    expect(theme.data.currentTheme).toBe(1)
  })
})

describe('theme cross-tab write-back', () => {
  it('does not write an incoming theme.data change back to storage', async () => {
    seedCustomTheme()
    const { flushSync } = await importTheme()
    const newValue = JSON.stringify({
      scheme: 'system',
      currentTheme: 2,
      themes: [{ id: 2, name: 'Other tab', colors: covesColors() }],
    })
    // The browser has already stored the other tab's value when the event fires.
    localStorage.setItem('theme.data', newValue)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'theme.data', newValue }),
    )
    await flushSync()

    const keys = setItem.mock.calls.map(([key]) => key)
    setItem.mockRestore()
    expect(keys).not.toContain('theme.data')
  })

  it('does not write a stale colorScheme event back over a newer stored value', async () => {
    const { flushSync } = await importTheme()
    // Another tab has since written 'dark'; this queued event carries its older 'light'.
    localStorage.setItem('colorScheme', 'dark')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'colorScheme', newValue: 'light' }),
    )
    await flushSync()

    const writes = setItem.mock.calls.filter(([key]) => key === 'colorScheme')
    setItem.mockRestore()
    expect(writes).not.toContainEqual(['colorScheme', 'light'])
    expect(localStorage.getItem('colorScheme')).toBe('dark')
  })

  it('persists a later local change back to the value applied from another tab', async () => {
    const { theme, flushSync } = await importTheme()
    localStorage.setItem('colorScheme', 'light')
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'colorScheme', newValue: 'light' }),
    )
    await flushSync()

    theme.colorScheme = 'dark'
    await flushSync()
    theme.colorScheme = 'light'
    await flushSync()

    expect(localStorage.getItem('colorScheme')).toBe('light')
  })
})
