import type { ThemeColors } from './theme.svelte'
import { contrastRatio, deriveAccentGradient } from './tint'

export type ThemeImportError = 'invalid-json' | 'invalid-theme'

export type ContrastPairId =
  | 'light-body'
  | 'dark-body'
  | 'light-primary-button'
  | 'dark-primary-button'
  | 'light-accent'
  | 'dark-accent'

/** The colour categories app.css reads; anything else in a theme is dropped. */
export const KNOWN_CATEGORIES = ['slate', 'zinc', 'primary', 'other'] as const

/** WCAG AA for normal text. */
const MINIMUM_CONTRAST = 4.5

/**
 * Accepts '#rgb', '#rrggbb' or an 'r g b' triple of 0-255 integers (any
 * whitespace) and returns the canonical 'r g b' form, or null for anything
 * else. Themes store and emit only the canonical form.
 */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed)?.[1]
  if (hex) {
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((digit) => digit + digit)
            .join('')
        : hex
    return [0, 2, 4]
      .map((offset) => parseInt(full.slice(offset, offset + 2), 16))
      .join(' ')
  }

  const parts = trimmed.split(/\s+/)
  if (parts.length !== 3 || !parts.every((part) => /^\d{1,3}$/.test(part)))
    return null
  const channels = parts.map((part) => parseInt(part, 10))
  if (channels.some((channel) => channel > 255)) return null
  return channels.join(' ')
}

/**
 * Builds a fresh colour set with exactly the categories and shade keys of
 * `defaults`: each shade comes from `input` when it holds a valid colour and
 * from `defaults` otherwise. Nothing in the result is shared with either
 * argument, so callers can mutate it freely.
 */
export function normalizeThemeColors(
  input: unknown,
  defaults: ThemeColors,
): ThemeColors {
  const source = isRecord(input) ? input : {}
  const colors: ThemeColors = {}
  for (const category of KNOWN_CATEGORIES) {
    const defaultShades = defaults[category]
    if (!defaultShades) continue
    const candidate = source[category]
    const sourceShades = isRecord(candidate) ? candidate : {}
    colors[category] = {}
    for (const [shade, fallback] of Object.entries(defaultShades)) {
      colors[category][shade] = normalizeColor(sourceShades[shade]) ?? fallback
    }
  }
  return colors
}

/**
 * Whether `input` holds at least one valid colour for a category and shade
 * that `defaults` defines, i.e. one normalizeThemeColors would keep.
 */
function hasKnownColor(
  input: Record<string, unknown>,
  defaults: ThemeColors,
): boolean {
  return KNOWN_CATEGORIES.some((category) => {
    const shades = input[category]
    const defaultShades = defaults[category]
    return (
      isRecord(shades) &&
      !!defaultShades &&
      Object.keys(defaultShades).some(
        (shade) => normalizeColor(shades[shade]) !== null,
      )
    )
  })
}

/**
 * Parses a theme pasted by the user. Two shapes are accepted: the export
 * format `{ name, colors }` and the legacy colours-only object. Either must
 * supply at least one valid shade in a known category.
 */
export function parseThemeImport(
  text: string,
  defaults: ThemeColors,
):
  | { ok: true; name?: string; colors: ThemeColors }
  | { ok: false; error: ThemeImportError } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'invalid-json' }
  }
  if (!isRecord(parsed)) return { ok: false, error: 'invalid-theme' }

  if (!('colors' in parsed)) {
    if (!hasKnownColor(parsed, defaults))
      return { ok: false, error: 'invalid-theme' }
    return { ok: true, colors: normalizeThemeColors(parsed, defaults) }
  }
  if (!isRecord(parsed.colors) || !hasKnownColor(parsed.colors, defaults))
    return { ok: false, error: 'invalid-theme' }

  const colors = normalizeThemeColors(parsed.colors, defaults)
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
  return name ? { ok: true, name, colors } : { ok: true, colors }
}

/**
 * Text/background pairs the app actually renders (see app.css and the
 * primary button styles), as [id, foreground, background] of
 * [category, shade]. The primary button's background is a gradient from
 * this stop to the one deriveAccentGradient gives (see GRADIENT_STOPS).
 */
const CONTRAST_PAIRS: [ContrastPairId, [string, string], [string, string]][] = [
  ['light-body', ['slate', '900'], ['slate', '50']],
  ['dark-body', ['zinc', '100'], ['zinc', '950']],
  ['light-primary-button', ['slate', '50'], ['primary', '900']],
  ['dark-primary-button', ['zinc', '900'], ['primary', '100']],
  ['light-accent', ['primary', '900'], ['slate', '50']],
  ['dark-accent', ['primary', '100'], ['zinc', '950']],
]

/** The derived far stop of each primary button gradient. */
const GRADIENT_STOPS: Partial<Record<ContrastPairId, '800' | '200'>> = {
  'light-primary-button': '800',
  'dark-primary-button': '200',
}

/**
 * Pairs whose contrast falls below WCAG AA. Gradient pairs report the lower
 * ratio of their two stops. A pair with a missing or invalid colour is
 * skipped rather than reported, since there is nothing to measure.
 */
export function themeContrastWarnings(
  colors: ThemeColors,
): { id: ContrastPairId; ratio: number }[] {
  const warnings: { id: ContrastPairId; ratio: number }[] = []
  for (const [
    id,
    [foregroundCategory, foregroundShade],
    [backgroundCategory, backgroundShade],
  ] of CONTRAST_PAIRS) {
    const foreground = normalizeColor(
      colors[foregroundCategory]?.[foregroundShade],
    )
    const background = normalizeColor(
      colors[backgroundCategory]?.[backgroundShade],
    )
    if (!foreground || !background) continue
    let ratio = contrastRatio(foreground, background)
    const gradientStop = GRADIENT_STOPS[id]
    if (gradientStop) {
      const derived = deriveAccentGradient(colors)[gradientStop]
      ratio = Math.min(ratio, contrastRatio(foreground, derived))
    }
    if (ratio < MINIMUM_CONTRAST) warnings.push({ id, ratio })
  }
  return warnings
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 'r g b' to '#rrggbb'; out-of-range channels become 0. */
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
