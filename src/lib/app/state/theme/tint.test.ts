import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  deriveAccentGradient,
  oklchToRgb,
  rgbToOklch,
  tintNeutrals,
  type TintStrength,
} from './tint'
import type { ThemeColors } from './theme.svelte'

/** Literal copy of KELP_DEFAULT in presets.ts — expected values, not computed. */
function kelpColors(): ThemeColors {
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

/**
 * Kelp with a red light-mode accent (Tailwind red-600 #dc2626, published as
 * oklch(0.577 0.245 27.325)) and a blue dark-mode accent (Tailwind blue-200
 * #bfdbfe, published as oklch(0.882 0.059 254.128)).
 */
function redBlueKelp(): ThemeColors {
  const colors = kelpColors()
  colors.primary['900'] = '220 38 38'
  colors.primary['100'] = '191 219 254'
  return colors
}

const RED_HUE = 27
const BLUE_HUE = 254

function channels(rgb: string): number[] {
  return rgb.split(' ').map(Number)
}

/** Shortest distance between two hues on the colour wheel, in degrees. */
function hueDistance(a: number, b: number): number {
  const difference = Math.abs(a - b) % 360
  return Math.min(difference, 360 - difference)
}

function expectChannelsNear(
  actual: string,
  expected: string,
  tolerance: number,
) {
  const actualChannels = channels(actual)
  const expectedChannels = channels(expected)
  expect(actualChannels).toHaveLength(3)
  actualChannels.forEach((channel, index) => {
    expect(
      Math.abs(channel - expectedChannels[index]),
      `channel ${index} of ${actual} vs ${expected}`,
    ).toBeLessThanOrEqual(tolerance)
  })
}

describe('rgbToOklch', () => {
  it('maps white to full lightness and no chroma', () => {
    const white = rgbToOklch('255 255 255')
    expect(white.lightness).toBeCloseTo(1, 3)
    expect(white.chroma).toBeLessThan(0.001)
  })

  it('maps black to zero lightness', () => {
    expect(rgbToOklch('0 0 0').lightness).toBeCloseTo(0, 3)
  })

  it('matches the published OKLCH of Tailwind slate-900', () => {
    // #0f172a is published as oklch(0.208 0.042 265.755).
    const slate900 = rgbToOklch('15 23 42')
    expect(Math.abs(slate900.lightness - 0.208)).toBeLessThanOrEqual(0.005)
    expect(Math.abs(slate900.chroma - 0.042)).toBeLessThanOrEqual(0.005)
    expect(hueDistance(slate900.hue, 265.755)).toBeLessThanOrEqual(2)
  })

  it('round-trips slate-900 through oklchToRgb', () => {
    expectChannelsNear(oklchToRgb(rgbToOklch('15 23 42')), '15 23 42', 1)
  })
})

describe('tintNeutrals', () => {
  // Input lightness comes from rgbToOklch on the input shade; that function
  // is pinned independently against published values above.
  it.each([
    { category: 'slate', hue: RED_HUE },
    { category: 'zinc', hue: BLUE_HUE },
  ])(
    'keeps each $category shade lightness and takes the accent hue',
    ({ category, hue }) => {
      const input = redBlueKelp()
      const result = tintNeutrals(input, 'medium')
      for (const [shade, value] of Object.entries(input[category])) {
        const before = rgbToOklch(value)
        const after = rgbToOklch(result[category][shade])
        expect(
          Math.abs(after.lightness - before.lightness),
          `${category}-${shade} lightness`,
        ).toBeLessThanOrEqual(0.01)
        if (after.chroma > 0.005) {
          expect(
            hueDistance(after.hue, hue),
            `${category}-${shade} hue ${after.hue}`,
          ).toBeLessThanOrEqual(6)
        }
      }
    },
  )

  it('emits valid r g b triples for every neutral shade', () => {
    const result = tintNeutrals(redBlueKelp(), 'medium')
    for (const category of ['slate', 'zinc']) {
      for (const [shade, value] of Object.entries(result[category])) {
        expect(value, `${category}-${shade}`).toMatch(
          /^\d{1,3} \d{1,3} \d{1,3}$/,
        )
        for (const channel of channels(value)) {
          expect(channel).toBeGreaterThanOrEqual(0)
          expect(channel).toBeLessThanOrEqual(255)
        }
      }
    }
  })

  it('leaves primary and other unchanged and does not mutate the input', () => {
    const input = redBlueKelp()
    const result = tintNeutrals(input, 'medium')
    expect(result.primary).toEqual({ '100': '191 219 254', '900': '220 38 38' })
    expect(result.other).toEqual({ black: '0 0 0', white: '255 255 255' })
    expect(input).toEqual(redBlueKelp())
  })

  it('gives the mid shades visible colour', () => {
    const result = tintNeutrals(redBlueKelp(), 'medium')
    expect(rgbToOklch(result.slate['500']).chroma).toBeGreaterThan(0.02)
    expect(rgbToOklch(result.zinc['500']).chroma).toBeGreaterThan(0.02)
  })

  it('orders chroma by strength: subtle < medium < strong', () => {
    const chromaAt = (strength: TintStrength) =>
      rgbToOklch(tintNeutrals(redBlueKelp(), strength).slate['500']).chroma
    expect(chromaAt('subtle')).toBeLessThan(chromaAt('medium'))
    expect(chromaAt('medium')).toBeLessThan(chromaAt('strong'))
  })

  it('turns the neutrals pure grey when the accent has no hue', () => {
    const input = kelpColors()
    input.primary['900'] = '128 128 128'
    input.primary['100'] = '200 200 200'
    const result = tintNeutrals(input, 'medium')
    for (const category of ['slate', 'zinc']) {
      for (const [shade, value] of Object.entries(result[category])) {
        expect(
          rgbToOklch(value).chroma,
          `${category}-${shade} ${value}`,
        ).toBeLessThan(0.005)
      }
    }
  })
})

describe('deriveAccentGradient', () => {
  it('keeps the current hard-coded gradient for the Kelp accents', () => {
    // app.css hard-codes --color-primary-800: rgb(50 58 77) and
    // --color-primary-200: rgb(175 175 185) for the default theme.
    const gradient = deriveAccentGradient(kelpColors())
    expectChannelsNear(gradient['800'], '50 58 77', 6)
    expectChannelsNear(gradient['200'], '175 175 185', 6)
  })

  it('keeps the exact gradient Kelp derives today', () => {
    expect(deriveAccentGradient(kelpColors())).toEqual({
      '800': '48 58 79',
      '200': '173 177 181',
    })
  })

  // Catppuccin (presets.ts): primary-900 '114 135 253' is already light, so
  // stepping lighter washes out the slate-50 button text. The gradient end may
  // lower contrast (Kelp's dark end does, 16:1 to 9:1) but not below the
  // accent's own contrast or AA 4.5:1, whichever is lower. The Catppuccin '200'
  // row is a guard: it passes today and must keep passing. The Tailwind rows
  // sit just either side of where a fixed lightness threshold would flip the
  // step direction (blue-600 4.94:1 on the accent falls to 2.94:1 at a lighter
  // end; blue-400 6.23:1 to 2.66:1 at a darker one).
  it.each([
    {
      end: '800' as const,
      role: 'Catppuccin repro',
      text: '248 250 252', // slate-50, light-mode button text
      accent: '114 135 253',
    },
    {
      end: '200' as const,
      role: 'Catppuccin guard',
      text: '34 34 39', // default zinc-900, dark-mode button text
      accent: '166 227 161',
    },
    {
      end: '800' as const,
      role: 'Tailwind blue-600',
      text: '248 250 252',
      accent: '37 99 235',
    },
    {
      end: '800' as const,
      role: 'Tailwind violet-600',
      text: '248 250 252',
      accent: '124 58 237',
    },
    {
      end: '200' as const,
      role: 'Tailwind blue-400',
      text: '34 34 39',
      accent: '96 165 250',
    },
    {
      end: '200' as const,
      role: 'Tailwind emerald-400',
      text: '34 34 39',
      accent: '52 211 153',
    },
  ])(
    'keeps text contrast at gradient end $end at least min(accent, 4.5) for $role',
    ({ end, text, accent }) => {
      const source = end === '800' ? '900' : '100'
      const gradient = deriveAccentGradient({
        slate: { '50': '248 250 252' },
        zinc: { '900': '34 34 39' },
        primary: {
          '100': '166 227 161',
          '900': '114 135 253',
          [source]: accent,
        },
      })
      expect(contrastRatio(text, gradient[end])).toBeGreaterThanOrEqual(
        Math.min(contrastRatio(text, accent), 4.5),
      )
    },
  )

  it('follows a red light-mode accent', () => {
    const [red, green, blue] = channels(
      deriveAccentGradient(redBlueKelp())['800'],
    )
    expect(red).toBeGreaterThan(green)
    expect(red).toBeGreaterThan(blue)
  })
})
