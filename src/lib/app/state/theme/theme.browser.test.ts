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

/** Literal copy of KELP_DEFAULT in presets.ts — expected values, not computed. */
function kelpColors() {
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

/** Seeds jsdom's real localStorage with one custom theme (id 1) selected. */
function seedCustomTheme() {
  localStorage.setItem(
    'theme.data',
    JSON.stringify({
      scheme: 'system',
      currentTheme: 1,
      themes: [{ id: 1, name: 'Custom 1', colors: kelpColors() }],
    }),
  )
}

async function importTheme() {
  vi.resetModules()
  vi.doMock('$app/environment', () => ({
    browser: true,
    dev: true,
    building: false,
  }))
  vi.doMock('$env/dynamic/public', () => ({ env: {} }))
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
    expect(defaultPreset?.name).toBe('Mono')
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
          themes: [{ id: 2, name: 'Older', colors: kelpColors() }],
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
      themes: [{ id: 2, name: 'Other tab', colors: kelpColors() }],
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
