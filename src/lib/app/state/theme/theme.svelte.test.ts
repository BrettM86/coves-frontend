import { describe, it, expect, vi } from 'vitest'
import { presets } from './presets'

/**
 * loadTheme() runs at module init, so each case re-imports the module with a
 * fresh localStorage stub. These tests exist because a corrupted
 * localStorage['theme.data'] used to throw during init and white-screen the
 * app on every subsequent visit — both for unparseable JSON and for
 * valid-JSON-wrong-shape payloads (e.g. themes: [null]).
 */
async function importThemeWith(stored: string | null) {
  vi.resetModules()
  vi.doMock('$app/environment', () => ({
    browser: true,
    dev: true,
    building: false,
  }))
  vi.doMock('$env/dynamic/public', () => ({ env: {} }))

  const store = new Map<string, string>(
    stored === null ? [] : [['theme.data', stored]],
  )
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  })

  const module = await import('./theme.svelte')
  return { theme: module.theme, store }
}

describe('theme initialization from localStorage', () => {
  it('uses presets when nothing is stored', async () => {
    const { theme } = await importThemeWith(null)
    expect(theme.data.themes.length).toBe(presets.length)
  })

  it('falls back to presets and clears the key on unparseable JSON', async () => {
    const { theme, store } = await importThemeWith('{corrupt')
    expect(theme.data.themes.length).toBe(presets.length)
    expect(store.has('theme.data')).toBe(false)
  })

  it('falls back and clears the key when themes is not an array', async () => {
    const { theme, store } = await importThemeWith(
      '{"scheme":"system","themes":"nope","currentTheme":0}',
    )
    expect(theme.data.themes.length).toBe(presets.length)
    expect(store.has('theme.data')).toBe(false)
  })

  it('filters garbage entries without crashing (themes: [null])', async () => {
    const { theme } = await importThemeWith(
      '{"scheme":"system","themes":[null],"currentTheme":5}',
    )
    // null must not survive into live state — the persist effect and derived
    // state read .id on every entry
    expect(theme.data.themes.every((t) => t && typeof t.id === 'number')).toBe(
      true,
    )
    expect(theme.data.themes.length).toBe(presets.length)
    // currentTheme points at a nonexistent id — current falls back to default
    expect(theme.current).toBeTruthy()
  })

  it('filters partial entries missing colors', async () => {
    const { theme } = await importThemeWith(
      '{"scheme":"system","themes":[{"id":7}],"currentTheme":7}',
    )
    expect(theme.data.themes.length).toBe(presets.length)
    // calculateVars must not hit Object.entries(undefined)
    expect(() => theme.vars).not.toThrow()
  })

  it('preserves valid custom themes', async () => {
    const custom =
      '{"scheme":"system","themes":[{"id":7,"name":"Custom","colors":{"other":{}}}],"currentTheme":7}'
    const { theme } = await importThemeWith(custom)
    expect(theme.data.themes.some((t) => t.id === 7)).toBe(true)
    expect(theme.current.id).toBe(7)
  })

  it('coerces a non-numeric currentTheme to the default', async () => {
    const { theme } = await importThemeWith(
      '{"scheme":"system","themes":[],"currentTheme":"garbage"}',
    )
    expect(theme.data.currentTheme).toBe(0)
  })
})
