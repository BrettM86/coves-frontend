import { browser } from '$app/environment'
import { env } from '$env/dynamic/public'
import { getDefaultTheme, presets } from './presets'

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

export function hexToRgb(value: string) {
  // Regular expression to match valid hex color codes
  const hexRegex = /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/

  if (!hexRegex.test(value)) {
    return value // Not a valid hex color
  }

  // Remove # if present
  let hex = value.replace('#', '')

  // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  }

  // Convert to RGB values
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)

  return `${r} ${g} ${b}`
}

export function rgbToHex(rgbString: string): string {
  const rgb = rgbString.split(' ')

  if (rgb.length !== 3) {
    return rgbString
  }

  const [r, g, b] = rgb.map((val) => {
    const num = parseInt(val, 10)
    if (isNaN(num) || num < 0 || num > 255) {
      return 0
    }
    return num
  })

  // Convert to hex and pad with zeros if necessary
  const toHex = (n: number) => n.toString(16).padStart(2, '0')

  // Return the hex color code
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const configuredColorScheme = env.PUBLIC_COLORSCHEME ?? 'system'

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
    console.error(
      `[theme] Failed to read ${key} from localStorage:`,
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}

function removeStorage(key: string): void {
  if (!browser) return
  try {
    localStorage.removeItem(key)
  } catch (err) {
    console.error(
      `[theme] Failed to clear ${key} from localStorage:`,
      err instanceof Error ? err.message : String(err),
    )
  }
}

function isColorScheme(value: unknown): value is ColorScheme {
  return value === 'system' || value === 'light' || value === 'dark'
}

/**
 * Persist helpers are exported so the failure paths stay testable: the
 * module-level effects below never flush outside a browser runtime.
 */
export function persistThemeData(data: ThemeData): void {
  try {
    localStorage.setItem(
      'theme.data',
      JSON.stringify({
        ...data,
        themes: data.themes.filter((t) => t.id > 0),
      }),
    )
  } catch (err) {
    console.error(
      '[theme] Failed to persist theme.data — theme customizations will not survive a reload:',
      err instanceof Error ? err.message : String(err),
    )
  }
}

export function persistColorScheme(scheme: ColorScheme): void {
  try {
    localStorage.setItem('colorScheme', scheme)
  } catch (err) {
    console.error(
      '[theme] Failed to persist colorScheme:',
      err instanceof Error ? err.message : String(err),
    )
  }
}

class ThemeState {
  constructor() {
    const stored = readStorage('colorScheme')

    this.#colorScheme = isColorScheme(stored)
      ? stored
      : (configuredColorScheme as ColorScheme)
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
  #colorScheme = $state<ColorScheme>(configuredColorScheme as ColorScheme)
  #vars = $derived(calculateVars(this.#current))

  get current() {
    return this.#current
  }
  set current(value) {
    if (!value) return
    const index = this.#data.themes.findIndex((i) => i.id == value?.id)
    this.#data.themes[index] = value
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
    }
  })
})

export function calculateVars(theme: Theme) {
  let cssVariables = ''

  for (const [scheme, colors] of Object.entries(theme.colors)) {
    for (const [key, value] of Object.entries(colors)) {
      cssVariables += `--color-${scheme}-${key}:rgb(${hexToRgb(value)}); `
    }
  }

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

function isTheme(value: unknown): value is Theme {
  if (!value || typeof value !== 'object') return false
  const t = value as Theme
  return (
    typeof t.id === 'number' &&
    typeof t.name === 'string' &&
    !!t.colors &&
    typeof t.colors === 'object'
  )
}

function loadTheme(): ThemeData | undefined {
  if (!browser) return
  const localTheme = readStorage('theme.data')
  if (!localTheme) return

  // This runs at module init: a corrupted or malformed value must fall back
  // to defaults, not throw and white-screen the app on every future visit.
  // Every theme entry is validated individually — a top-level shape check
  // alone lets e.g. {"themes":[null]} through, which then crashes the
  // persist effect and derived state on every visit without ever hitting
  // the cleanup path below.
  try {
    const data: unknown = JSON.parse(localTheme)
    if (
      !data ||
      typeof data !== 'object' ||
      !Array.isArray((data as ThemeData).themes)
    ) {
      console.warn('[theme] discarding malformed theme.data:', localTheme)
      removeStorage('theme.data')
      return
    }
    const parsed = data as ThemeData
    const validThemes = parsed.themes.filter(isTheme)
    if (validThemes.length < parsed.themes.length) {
      console.warn(
        '[theme] dropped invalid entries from theme.data:',
        localTheme,
      )
    }
    parsed.themes = [...presets, ...validThemes]
    if (typeof parsed.currentTheme !== 'number') {
      parsed.currentTheme = 0
    }
    return parsed
  } catch (err) {
    console.warn('[theme] discarding unparseable theme.data:', localTheme, err)
    removeStorage('theme.data')
    return
  }
}
