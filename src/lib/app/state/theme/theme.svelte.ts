import { browser } from '$app/environment'
import { env } from '$env/dynamic/public'
import { getDefaultColors, getDefaultTheme, presets } from './presets'
import { log } from '$lib/app/util/log'
import {
  normalizeColor,
  normalizeThemeColors,
  parseThemeImport,
  type ThemeImportError,
} from './colors'
import { deriveAccentGradient } from './tint'

export { rgbToHex } from './colors'

type ColorScheme = 'system' | 'light' | 'dark'

export interface ThemeData {
  scheme: ColorScheme
  themes: Theme[]
  currentTheme: number
}

export interface Theme {
  id: number
  colors: ThemeColors
  name: string
}

export interface ThemeColors {
  [scheme: string]: {
    [key: string]: string
  }
}

/**
 * localStorage throws, it doesn't just fail: Safari's private mode denies
 * access outright (SecurityError), blocked-storage contexts do the same, and a
 * full origin quota rejects writes (QuotaExceededError). These wrappers keep
 * any of that from taking module init or the reactive graph down with it — a
 * browser that can't persist the theme still has to render one.
 */
function readStorage(key: string): string | null {
  if (!browser) return null
  try {
    return localStorage.getItem(key)
  } catch (err) {
    log.error(`[theme] Failed to read ${key} from localStorage`, err)
    return null
  }
}

function removeStorage(key: string): void {
  if (!browser) return
  try {
    localStorage.removeItem(key)
  } catch (err) {
    log.error(`[theme] Failed to clear ${key} from localStorage`, err)
  }
}

function isColorScheme(value: unknown): value is ColorScheme {
  return value === 'system' || value === 'light' || value === 'dark'
}

const configuredColorScheme: ColorScheme = isColorScheme(env.PUBLIC_COLORSCHEME)
  ? env.PUBLIC_COLORSCHEME
  : 'system'

function serializeThemeData(data: ThemeData): string {
  return JSON.stringify({
    ...data,
    themes: data.themes.filter((t) => t.id > 0),
  })
}

/**
 * The serialized form of a theme.data value just applied from another tab's
 * storage event. That tab already stored it, and writing it back would fire a
 * storage event there in turn. Compared in serialized form rather than against
 * the raw stored value: the other tab's key order or unnormalized colours can
 * differ from what this tab would write for the same theme.
 */
let themeDataFromOtherTab: string | null = null

/**
 * Persist helpers are exported so the failure paths stay testable: the
 * module-level effects below never flush outside a browser runtime.
 */
export function persistThemeData(data: ThemeData): void {
  const serialized = serializeThemeData(data)
  const fromOtherTab = serialized === themeDataFromOtherTab
  themeDataFromOtherTab = null
  if (fromOtherTab) return
  try {
    localStorage.setItem('theme.data', serialized)
  } catch (err) {
    log.error(
      '[theme] Failed to persist theme.data — theme customizations will not survive a reload',
      err,
    )
  }
}

/** static/theme-boot.js applies this before first paint on the next load. */
export function persistThemeVars(vars: string): void {
  try {
    localStorage.setItem('theme.vars', vars)
  } catch (err) {
    log.error('[theme] Failed to persist theme.vars', err)
  }
}

/**
 * A colorScheme value just applied from another tab's storage event. Writing
 * it back could overwrite a newer value when events arrive late, so the next
 * persist of exactly this value is skipped. The DOM class and cookie still
 * update for this tab.
 */
let colorSchemeFromOtherTab: ColorScheme | null = null

export function persistColorScheme(scheme: ColorScheme): void {
  const fromOtherTab = scheme === colorSchemeFromOtherTab
  colorSchemeFromOtherTab = null
  if (fromOtherTab) return
  try {
    localStorage.setItem('colorScheme', scheme)
  } catch (err) {
    log.error('[theme] Failed to persist colorScheme', err)
  }
}

/**
 * hooks.server reads this cookie to render <html class="dark"> on the server,
 * so the first paint matches the stored scheme without waiting for JS.
 */
function persistColorSchemeCookie(scheme: ColorScheme): void {
  try {
    document.cookie = `colorScheme=${scheme}; path=/; max-age=31536000; samesite=lax`
  } catch (err) {
    log.error('[theme] Failed to write the colorScheme cookie', err)
  }
}

class ThemeState {
  constructor() {
    const stored = readStorage('colorScheme')

    this.#colorScheme = isColorScheme(stored) ? stored : configuredColorScheme
  }

  #data = $state<ThemeData>(
    loadTheme() ?? {
      scheme: 'system',
      themes: presets,
      currentTheme: 0,
    },
  )
  #current = $derived(
    this.#data.themes.find((i) => i.id == this.#data.currentTheme) ??
      getDefaultTheme(),
  )
  #colorScheme = $state<ColorScheme>(configuredColorScheme)
  #vars = $derived(calculateVars(this.#current))

  get current() {
    return this.#current
  }

  get colorScheme() {
    return this.#colorScheme
  }
  set colorScheme(value) {
    this.#colorScheme = value
  }

  get vars() {
    return this.#vars
  }

  get data() {
    return this.#data
  }
  set data(value) {
    this.#data = value
  }

  /** The selected theme when it is a custom one; presets are read-only. */
  #editableCurrent(): Theme | undefined {
    if (this.#data.currentTheme <= 0) return
    return this.#data.themes.find((t) => t.id === this.#data.currentTheme)
  }

  deleteTheme(id: number): void {
    if (id <= 0) return
    const wasCurrent = this.#data.currentTheme === id
    this.#data.themes = this.#data.themes.filter((t) => t.id !== id)
    if (wasCurrent) this.#data.currentTheme = 0
  }

  /**
   * Copies theme `id` (the current theme when `id` is unknown) into a new
   * custom theme, selects it and returns its id.
   */
  duplicateTheme(id: number, name: string): number {
    const source = this.#data.themes.find((t) => t.id === id) ?? this.#current
    const newId = unusedThemeId(this.#data.themes.map((t) => t.id))
    this.#data.themes.push({
      id: newId,
      name,
      colors: cloneColors(source.colors),
    })
    this.#data.currentTheme = newId
    return newId
  }

  resetCurrentColors(): void {
    const current = this.#editableCurrent()
    if (current) current.colors = getDefaultColors()
  }

  /**
   * Replaces the current custom theme's colours, normalised against the
   * defaults. Ignored on presets.
   */
  replaceColors(colors: ThemeColors): void {
    const current = this.#editableCurrent()
    if (current)
      current.colors = normalizeThemeColors(colors, getDefaultColors())
  }

  /** Ignores invalid colours, unknown categories and presets. */
  setColor(category: string, shade: string, value: string): void {
    const shades = this.#editableCurrent()?.colors[category]
    const color = normalizeColor(value)
    if (!shades || !color) return
    shades[shade] = color
  }

  renameTheme(id: number, name: string): 'empty-name' | null {
    const trimmed = name.trim()
    if (!trimmed) return 'empty-name'
    const target = id > 0 && this.#data.themes.find((t) => t.id === id)
    if (target) target.name = trimmed
    return null
  }

  importIntoCurrent(
    text: string,
  ): ThemeImportError | 'preset-not-editable' | null {
    const current = this.#editableCurrent()
    if (!current) return 'preset-not-editable'
    const result = parseThemeImport(text, getDefaultColors())
    if (!result.ok) return result.error
    current.colors = result.colors
    if (result.name) current.name = result.name
    return null
  }

  /**
   * Applies a localStorage write made by another tab. The value is read from
   * storage now rather than taken from the event, so a late event can't apply
   * a value older than what is stored. Malformed values are ignored so a bad
   * write elsewhere can't break this tab.
   */
  applyStorageChange(key: string | null): void {
    if (key !== 'colorScheme' && key !== 'theme.data') return
    const newValue = readStorage(key)
    if (key === 'colorScheme') {
      if (!isColorScheme(newValue) || newValue === this.#colorScheme) return
      colorSchemeFromOtherTab = newValue
      this.#colorScheme = newValue
    } else {
      const parsed =
        newValue === null
          ? { scheme: 'system' as const, themes: presets, currentTheme: 0 }
          : parseThemeData(newValue)
      if (parsed === 'invalid-theme-data') return
      themeDataFromOtherTab = serializeThemeData(parsed)
      this.#data = parsed
    }
  }
}

export const theme = new ThemeState()

$effect.root(() => {
  $effect(() => {
    if (browser) {
      persistThemeData(theme.data)
    }
  })
  $effect(() => {
    if (browser) {
      persistThemeVars(theme.vars)
    }
  })
  $effect(() => {
    if (!browser) return
    const onStorage = (event: StorageEvent) =>
      theme.applyStorageChange(event.key)
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  })
  $effect(() => {
    if (browser) {
      const prefersDark = window.matchMedia(
        '(prefers-color-scheme: dark)',
      ).matches

      const html = document.querySelector('html')

      // The class toggle stays ahead of the write: when persistence fails,
      // the page must still be in the right color scheme for this session.
      if (theme.colorScheme == 'system')
        html?.classList.toggle('dark', prefersDark)
      else html?.classList.toggle('dark', theme.colorScheme === 'dark')

      persistColorScheme(theme.colorScheme)
      persistColorSchemeCookie(theme.colorScheme)
    }
  })
})

export function calculateVars(theme: Theme) {
  let cssVariables = ''

  for (const [scheme, colors] of Object.entries(theme.colors)) {
    for (const [key, value] of Object.entries(colors)) {
      cssVariables += `--color-${scheme}-${key}:rgb(${value}); `
    }
  }

  // The accent button gradient's other end follows the accent; app.css keeps
  // the Kelp values as a fallback for before these vars apply.
  const gradient = deriveAccentGradient(theme.colors)
  cssVariables += `--color-primary-800:rgb(${gradient['800']}); `
  cssVariables += `--color-primary-200:rgb(${gradient['200']}); `

  return cssVariables.trim()
}

export const inDarkColorScheme = (): boolean => {
  if (browser) {
    return theme.colorScheme == 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : theme.colorScheme == 'dark'
  }
  return false
}

/**
 * A positive safe integer not in `ids`: one past the largest when that is
 * still safe, otherwise the smallest unused one. Ids past MAX_SAFE_INTEGER
 * lose precision, so two themes could end up sharing one.
 */
function unusedThemeId(ids: number[]): number {
  const next = Math.max(0, ...ids) + 1
  if (Number.isSafeInteger(next)) return next
  const used = new Set(ids)
  let id = 1
  while (used.has(id)) id++
  return id
}

function isTheme(value: unknown): value is Theme {
  if (!value || typeof value !== 'object') return false
  const t = value as Theme
  return (
    Number.isSafeInteger(t.id) &&
    typeof t.name === 'string' &&
    !!t.colors &&
    typeof t.colors === 'object'
  )
}

function cloneColors(colors: ThemeColors): ThemeColors {
  return Object.fromEntries(
    Object.entries(colors).map(([category, shades]) => [
      category,
      { ...shades },
    ]),
  )
}

/**
 * Validates a serialized theme.data. Every entry is checked individually — a
 * top-level shape check alone lets e.g. {"themes":[null]} through, which then
 * crashes the persist effect and derived state. Stored entries claiming a
 * preset id (<= 0) are dropped, duplicate ids are renumbered, and colours are
 * normalized to the default categories and shades. Presets are prepended.
 */
function parseThemeData(text: string): ThemeData | 'invalid-theme-data' {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    log.warn('[theme] discarding unparseable theme.data', err, {
      localTheme: text,
    })
    return 'invalid-theme-data'
  }
  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray((data as ThemeData).themes)
  ) {
    log.warn('[theme] discarding malformed theme.data', undefined, {
      localTheme: text,
    })
    return 'invalid-theme-data'
  }

  const parsed = data as ThemeData
  const validThemes = parsed.themes.filter(isTheme)
  if (validThemes.length < parsed.themes.length) {
    log.warn('[theme] dropped invalid entries from theme.data', undefined, {
      localTheme: text,
    })
  }

  const defaults = getDefaultColors()
  const customThemes: Theme[] = []
  const usedIds: number[] = []
  const storedIds = validThemes.map((t) => t.id)
  for (const stored of validThemes) {
    if (stored.id <= 0) continue
    const id = usedIds.includes(stored.id)
      ? unusedThemeId([...storedIds, ...usedIds])
      : stored.id
    usedIds.push(id)
    customThemes.push({
      id,
      name: stored.name,
      colors: normalizeThemeColors(stored.colors, defaults),
    })
  }

  return {
    scheme: isColorScheme(parsed.scheme) ? parsed.scheme : 'system',
    themes: [...presets, ...customThemes],
    currentTheme: Number.isSafeInteger(parsed.currentTheme)
      ? parsed.currentTheme
      : 0,
  }
}

function loadTheme(): ThemeData | undefined {
  if (!browser) return
  const localTheme = readStorage('theme.data')
  if (!localTheme) return

  // This runs at module init: a corrupted or malformed value must fall back
  // to defaults, not throw and white-screen the app on every future visit.
  const parsed = parseThemeData(localTheme)
  if (parsed === 'invalid-theme-data') {
    removeStorage('theme.data')
    return
  }
  return parsed
}
