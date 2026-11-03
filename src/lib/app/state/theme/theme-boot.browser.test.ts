// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
