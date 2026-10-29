import type { ThemeColors } from './theme.svelte'

/**
 * OKLCH colour maths for tinting the neutral greys from the accent. The
 * sRGB ↔ OKLab matrices are Björn Ottosson's published ones
 * (https://bottosson.github.io/posts/oklab/).
 */

export type Oklch = { lightness: number; chroma: number; hue: number }

export type TintStrength = 'subtle' | 'medium' | 'strong'

/** Highest chroma each strength gives a mid-lightness shade. */
const STRENGTH_CHROMA: Record<TintStrength, number> = {
  subtle: 0.015,
  medium: 0.035,
  strong: 0.07,
}

/** Below this an accent reads as grey, so its hue is noise. */
const GREY_ACCENT_CHROMA = 0.01

/**
 * Lightness steps that turn the accents into the button gradient's other
 * end, calibrated so Kelp's accents land on the colours app.css hard-codes.
 */
const GRADIENT_DARK_STEP = 0.14
const GRADIENT_LIGHT_STEP = 0.21

/** WCAG AA contrast for body-size text. */
const MINIMUM_TEXT_CONTRAST = 4.5

/** Kelp's button text colours, used when a theme lacks slate-50 or zinc-900. */
const DEFAULT_LIGHT_BUTTON_TEXT = '248 250 252'
const DEFAULT_DARK_BUTTON_TEXT = '34 34 39'

function parseChannels(rgb: string): [number, number, number] | null {
  const parts = rgb.trim().split(/\s+/).map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part)))
    return null
  return [parts[0], parts[1], parts[2]]
}

function toLinear(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function fromLinear(value: number): number {
  const encoded =
    value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
  return encoded * 255
}

function linearToOklab(
  red: number,
  green: number,
  blue: number,
): [number, number, number] {
  const long = Math.cbrt(
    0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
  )
  const medium = Math.cbrt(
    0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
  )
  const short = Math.cbrt(
    0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
  )
  return [
    0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  ]
}

function oklchToLinear(color: Oklch): [number, number, number] {
  const radians = (color.hue * Math.PI) / 180
  const a = color.chroma * Math.cos(radians)
  const b = color.chroma * Math.sin(radians)
  const long = (color.lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const medium = (color.lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const short = (color.lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ]
}

function inGamut(linear: [number, number, number]): boolean {
  const epsilon = 1e-6
  return linear.every((value) => value >= -epsilon && value <= 1 + epsilon)
}

/** `"r g b"` → OKLCH. Unparseable input reads as black. */
export function rgbToOklch(rgb: string): Oklch {
  const [red, green, blue] = (parseChannels(rgb) ?? [0, 0, 0]).map(toLinear)
  const [lightness, a, b] = linearToOklab(red, green, blue)
  const hue = (Math.atan2(b, a) * 180) / Math.PI
  return {
    lightness,
    chroma: Math.hypot(a, b),
    hue: hue < 0 ? hue + 360 : hue,
  }
}

/**
 * OKLCH → `"r g b"`. Colours outside sRGB keep their lightness and hue and
 * lose chroma (binary search) until they fit.
 */
export function oklchToRgb(color: Oklch): string {
  const lightness = Math.min(1, Math.max(0, color.lightness))
  let linear = oklchToLinear({ ...color, lightness })
  if (!inGamut(linear)) {
    let low = 0
    let high = color.chroma
    for (let step = 0; step < 24; step++) {
      const middle = (low + high) / 2
      if (inGamut(oklchToLinear({ ...color, lightness, chroma: middle })))
        low = middle
      else high = middle
    }
    linear = oklchToLinear({ ...color, lightness, chroma: low })
  }
  return nearestRgb(linear)
}

/**
 * The 8-bit colour closest in OKLab to a linear-light one. Rounding each
 * channel on its own can swing the hue of dark, low-chroma colours by tens
 * of degrees, so every floor/ceil combination is compared instead.
 */
function nearestRgb(linear: [number, number, number]): string {
  const target = linearToOklab(...linear)
  const options = linear.map((value) => {
    const encoded = Math.min(255, Math.max(0, fromLinear(Math.max(0, value))))
    return [...new Set([Math.floor(encoded), Math.ceil(encoded)])]
  })
  let best: number[] = []
  let bestDistance = Infinity
  for (const red of options[0])
    for (const green of options[1])
      for (const blue of options[2]) {
        const candidate = linearToOklab(
          toLinear(red),
          toLinear(green),
          toLinear(blue),
        )
        const distance = Math.hypot(
          candidate[0] - target[0],
          candidate[1] - target[1],
          candidate[2] - target[2],
        )
        if (distance < bestDistance) {
          bestDistance = distance
          best = [red, green, blue]
        }
      }
  return best.join(' ')
}

/** 1 at mid lightness, falling to 0 at black and white. */
function lightnessTaper(lightness: number): number {
  return Math.max(0, 1 - (2 * lightness - 1) ** 2)
}

function tintShades(
  shades: Record<string, string>,
  accent: string | undefined,
  strength: TintStrength,
): Record<string, string> {
  const accentColor = rgbToOklch(accent ?? '0 0 0')
  const maximumChroma =
    accentColor.chroma < GREY_ACCENT_CHROMA
      ? 0
      : Math.min(accentColor.chroma, STRENGTH_CHROMA[strength])
  return Object.fromEntries(
    Object.entries(shades).map(([shade, value]) => {
      const { lightness } = rgbToOklch(value)
      const tinted = oklchToRgb({
        lightness,
        chroma: maximumChroma * lightnessTaper(lightness),
        hue: accentColor.hue,
      })
      return [shade, tinted]
    }),
  )
}

/**
 * A copy of `colors` with the slate (light mode) greys taking the hue of
 * primary-900 and the zinc (dark mode) greys the hue of primary-100. Each
 * shade keeps its OKLCH lightness, but WCAG contrast can still shift a
 * little, since WCAG luminance is not OKLCH lightness.
 */
export function tintNeutrals(
  colors: ThemeColors,
  strength: TintStrength,
): ThemeColors {
  const result: ThemeColors = Object.fromEntries(
    Object.entries(colors).map(([category, shades]) => [
      category,
      { ...shades },
    ]),
  )
  const accents = colors.primary ?? {}
  if (result.slate)
    result.slate = tintShades(result.slate, accents['900'], strength)
  if (result.zinc)
    result.zinc = tintShades(result.zinc, accents['100'], strength)
  return result
}

/** WCAG 2 contrast ratio between two 'r g b' colours, from 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function luminance(color: string): number {
  const [red, green, blue] = (parseChannels(color) ?? [0, 0, 0]).map(toLinear)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/**
 * The other end of the accent button gradient. primary-800 is primary-900
 * stepped lighter (by GRADIENT_DARK_STEP) and primary-200 is primary-100
 * stepped darker (by GRADIENT_LIGHT_STEP), unless that step drops the button
 * text's WCAG contrast (slate-50 on primary-800, zinc-900 on primary-200)
 * below the lower of its contrast on the accent and 4.5:1. Then the end steps
 * the opposite way, and if both directions fall short it takes whichever
 * keeps more contrast.
 */
export function deriveAccentGradient(colors: ThemeColors): {
  '800': string
  '200': string
} {
  const step = (
    accent: string | undefined,
    text: string,
    amount: number,
    preferredDirection: 1 | -1,
  ) => {
    const color = rgbToOklch(accent ?? '0 0 0')
    const stepped = (direction: number) =>
      oklchToRgb({ ...color, lightness: color.lightness + direction * amount })
    const target = Math.min(
      contrastRatio(text, oklchToRgb(color)),
      MINIMUM_TEXT_CONTRAST,
    )
    const preferred = stepped(preferredDirection)
    const preferredContrast = contrastRatio(text, preferred)
    if (preferredContrast >= target) return preferred
    const opposite = stepped(-preferredDirection)
    return contrastRatio(text, opposite) > preferredContrast
      ? opposite
      : preferred
  }
  return {
    '800': step(
      colors.primary?.['900'],
      colors.slate?.['50'] ?? DEFAULT_LIGHT_BUTTON_TEXT,
      GRADIENT_DARK_STEP,
      1,
    ),
    '200': step(
      colors.primary?.['100'],
      colors.zinc?.['900'] ?? DEFAULT_DARK_BUTTON_TEXT,
      GRADIENT_LIGHT_STEP,
      -1,
    ),
  }
}
