// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The grain cases read the preset list as the server builds it without
// PUBLIC_THEME, the only case in which it stamps data-grain.
vi.mock('$env/dynamic/public', () => ({ env: {} }))

/**
 * static/theme-boot.js runs before first paint, outside the bundle, so the test
 * executes the shipped file text against jsdom's window/document/localStorage.
 * Vite rewrites `new URL(path, import.meta.url)` into an http asset URL, so the
 * path is resolved with node:path from this file's location instead.
 */
const bootSource = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../static/theme-boot.js',
  ),
  'utf8',
)

function runBootScript() {
  new Function(bootSource)()
}

function mockPrefersDark(matches: boolean) {
  window.matchMedia = (query: string) =>
    ({ matches, media: query }) as MediaQueryList
}

const html = () => document.documentElement

beforeEach(() => {
  localStorage.clear()
  html().className = ''
  html().removeAttribute('style')
  delete html().dataset.defaultColorScheme
  html().removeAttribute('data-grain')
  mockPrefersDark(false)
})

describe('theme-boot.js colour scheme', () => {
  it.each([
    { stored: 'dark', prefersDark: false, startDark: false, dark: true },
    { stored: 'light', prefersDark: false, startDark: true, dark: false },
    { stored: 'system', prefersDark: true, startDark: false, dark: true },
    { stored: 'system', prefersDark: false, startDark: true, dark: false },
    { stored: null, prefersDark: false, startDark: true, dark: true },
  ])(
    'stored $stored, prefers dark $prefersDark, starting dark $startDark → dark $dark',
    ({ stored, prefersDark, startDark, dark }) => {
      if (stored !== null) localStorage.setItem('colorScheme', stored)
      if (startDark) html().classList.add('dark')
      mockPrefersDark(prefersDark)

      runBootScript()

      expect(html().classList.contains('dark')).toBe(dark)
    },
  )
})

describe('theme-boot.js first-visit colour scheme', () => {
  it.each([
    { fallback: 'light', prefersDark: false, startDark: true, dark: false },
    { fallback: 'system', prefersDark: false, startDark: true, dark: false },
    { fallback: 'system', prefersDark: true, startDark: false, dark: true },
    { fallback: 'dark', prefersDark: false, startDark: false, dark: true },
    { fallback: undefined, prefersDark: false, startDark: true, dark: true },
  ])(
    'no stored scheme, default $fallback, prefers dark $prefersDark, starting dark $startDark → dark $dark',
    ({ fallback, prefersDark, startDark, dark }) => {
      if (fallback !== undefined) html().dataset.defaultColorScheme = fallback
      if (startDark) html().classList.add('dark')
      mockPrefersDark(prefersDark)

      runBootScript()

      expect(html().classList.contains('dark')).toBe(dark)
    },
  )
})

describe('theme-boot.js colour variables', () => {
  it('applies stored theme.vars to the root element', () => {
    localStorage.setItem(
      'theme.vars',
      '--color-zinc-900:rgb(1 2 3); --color-slate-50:rgb(4 5 6);',
    )

    runBootScript()

    expect(html().style.getPropertyValue('--color-zinc-900')).toBe('rgb(1 2 3)')
  })

  it.each([['background:url(x)'], ['--color-slate-50:red']])(
    'does not apply stored theme.vars %j',
    (vars) => {
      localStorage.setItem('theme.vars', vars)

      runBootScript()

      expect(html().getAttribute('style')).toBeNull()
    },
  )

  it('does not throw when localStorage access is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(() => runBootScript()).not.toThrow()
  })
})

describe('theme-boot.js with storage access denied', () => {
  it.each([
    { fallback: 'system', prefersDark: false, startDark: true, dark: false },
    { fallback: 'light', prefersDark: false, startDark: true, dark: false },
  ])(
    'default $fallback, prefers dark $prefersDark, starting dark $startDark → dark $dark',
    ({ fallback, prefersDark, startDark, dark }) => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied')
      })
      html().dataset.defaultColorScheme = fallback
      if (startDark) html().classList.add('dark')
      mockPrefersDark(prefersDark)

      runBootScript()

      expect(html().classList.contains('dark')).toBe(dark)
    },
  )
})

/**
 * The server stamps data-grain on <html> only without PUBLIC_THEME; grain is
 * for the built-in Coves default (id 0). theme.svelte.ts persists the selected
 * theme id as currentTheme in 'theme.data', with only the custom themes (id >
 * 0) in its themes list, and shows Coves for a selected id that names no
 * listed theme. Boot must drop the marker exactly when hydration would.
 */
describe('theme-boot.js grain marker', () => {
  const customOne = { id: 1, name: 'Custom 1', colors: {} }
  const themeData = (currentTheme: unknown, themes: unknown = []) =>
    JSON.stringify({ scheme: 'system', currentTheme, themes })

  it.each([
    { selection: 'nothing stored', stored: null, grain: true },
    { selection: 'Coves (id 0)', stored: themeData(0), grain: true },
    { selection: 'Mono (id -10)', stored: themeData(-10), grain: false },
    { selection: 'Classic (id -1)', stored: themeData(-1), grain: false },
    { selection: 'AMOLED (id -2)', stored: themeData(-2), grain: false },
    { selection: 'Catppuccin (id -3)', stored: themeData(-3), grain: false },
    { selection: 'Neutral (id -4)', stored: themeData(-4), grain: false },
    {
      selection: 'a preset id that does not exist (id -99)',
      stored: themeData(-99),
      grain: true,
    },
    {
      selection: 'a custom theme (id 1)',
      stored: themeData(1, [customOne]),
      grain: false,
    },
    {
      selection: 'a stale custom id (id 2) missing from the themes list',
      stored: themeData(2, [customOne]),
      grain: true,
    },
    {
      selection: 'a custom id whose entry has no name',
      stored: themeData(1, [{ id: 1, colors: {} }]),
      grain: true,
    },
    {
      selection: 'a currentTheme that is not an integer',
      stored: themeData('1', [customOne]),
      grain: true,
    },
    {
      selection: 'theme.data without a themes list',
      stored: JSON.stringify({ scheme: 'system', currentTheme: -1 }),
      grain: true,
    },
    { selection: 'unparseable theme.data', stored: '{', grain: true },
  ])(
    'server stamped grain, stored $selection → grain $grain',
    ({ stored, grain }) => {
      html().setAttribute('data-grain', '')
      if (stored !== null) localStorage.setItem('theme.data', stored)

      runBootScript()

      expect(html().hasAttribute('data-grain')).toBe(grain)
    },
  )

  it('drops grain for every preset other than the default', async () => {
    const { presets } = await import('./presets')
    for (const preset of presets.filter((p) => p.id !== 0)) {
      html().setAttribute('data-grain', '')
      localStorage.setItem('theme.data', themeData(preset.id))

      runBootScript()

      expect(html().hasAttribute('data-grain'), preset.name).toBe(false)
    }
  })

  it.each([
    { selection: 'nothing stored', stored: null },
    { selection: 'id 0', stored: themeData(0) },
  ])(
    'never adds grain the server did not stamp (PUBLIC_THEME), stored $selection',
    ({ stored }) => {
      if (stored !== null) localStorage.setItem('theme.data', stored)

      runBootScript()

      expect(html().hasAttribute('data-grain')).toBe(false)
    },
  )
})
