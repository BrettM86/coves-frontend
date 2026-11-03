import { describe, expect, it } from 'vitest'
import {
  normalizeColor,
  parseThemeImport,
  themeContrastWarnings,
} from './colors'
import { contrastRatio } from './tint'
import type { ThemeColors } from './theme.svelte'

describe('normalizeColor', () => {
  it.each([
    ['#0f172a', '15 23 42'],
    ['#abc', '170 187 204'],
    ['15 23 42', '15 23 42'],
    ['  15  23 42 ', '15 23 42'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeColor(input)).toBe(expected)
  })

  it.each([['300 0 0'], ['red'], [''], [null], [42], ['#12345']])(
    'rejects %j',
    (input) => {
      expect(normalizeColor(input)).toBeNull()
    },
  )
})

const importDefaults: ThemeColors = {
  slate: { '50': '248 250 252', '900': '15 23 42' },
  zinc: { '100': '248 248 251', '950': '25 25 29' },
  primary: { '100': '241 245 249', '900': '15 23 42' },
  other: { black: '0 0 0', white: '255 255 255' },
}

const importedColors = {
  slate: { '50': '1 2 3', '900': '4 5 6' },
  zinc: { '100': '7 8 9', '950': '10 11 12' },
  primary: { '100': '13 14 15', '900': '16 17 18' },
  other: { black: '19 20 21', white: '22 23 24' },
}

describe('parseThemeImport', () => {
  it('rejects text that is not JSON', () => {
    expect(parseThemeImport('{not json', importDefaults)).toEqual({
      ok: false,
      error: 'invalid-json',
    })
  })

  it.each([['42'], ['"a theme"'], ['[]'], ['null']])(
    'rejects JSON %s that is not a theme object',
    (text) => {
      expect(parseThemeImport(text, importDefaults)).toEqual({
        ok: false,
        error: 'invalid-theme',
      })
    },
  )

  it.each([
    ['{}'],
    ['{"foo":1}'],
    ['{"colours":{"slate":{"50":"#fff"}}}'],
    ['{"name":"X","colors":{}}'],
    ['{"slate":{"50":"bogus"}}'],
    ['{"slate":{"typo":"#fff"}}'],
    ['{"colors":{"slate":{"typo":"#fff"}}}'],
  ])('rejects %s, which supplies no valid colour', (text) => {
    expect(parseThemeImport(text, importDefaults)).toEqual({
      ok: false,
      error: 'invalid-theme',
    })
  })

  it('accepts a legacy colors-only object without a name', () => {
    const result = parseThemeImport(
      JSON.stringify(importedColors),
      importDefaults,
    )
    expect(result).toEqual({ ok: true, colors: importedColors })
    expect(result.ok && result.name).toBeUndefined()
  })

  it('accepts the named format', () => {
    expect(
      parseThemeImport(
        JSON.stringify({ name: 'Sea', colors: importedColors }),
        importDefaults,
      ),
    ).toEqual({ ok: true, name: 'Sea', colors: importedColors })
  })

  it('fills null and missing categories from the defaults and drops unknown ones', () => {
    const text = JSON.stringify({
      name: 'Partial',
      colors: {
        primary: null,
        slate: { '50': '1 2 3', '900': '4 5 6' },
        neon: { '500': '57 255 20' },
      },
    })
    expect(parseThemeImport(text, importDefaults)).toEqual({
      ok: true,
      name: 'Partial',
      colors: {
        slate: { '50': '1 2 3', '900': '4 5 6' },
        zinc: { '100': '248 248 251', '950': '25 25 29' },
        primary: { '100': '241 245 249', '900': '15 23 42' },
        other: { black: '0 0 0', white: '255 255 255' },
      },
    })
  })

  it('replaces an invalid shade with its default, converts hex and keeps only default shade keys', () => {
    const text = JSON.stringify({
      ...importedColors,
      slate: { '50': 'nope', '900': '#0f172a', '999': '1 1 1' },
    })
    expect(parseThemeImport(text, importDefaults)).toEqual({
      ok: true,
      colors: {
        ...importedColors,
        slate: { '50': '248 250 252', '900': '15 23 42' },
      },
    })
  })

  it('returns colors that do not share objects with the defaults', () => {
    const result = parseThemeImport('{"zinc":{"100":"1 2 3"}}', importDefaults)
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
    result.colors.slate['50'] = '0 0 0'
    expect(importDefaults.slate['50']).toBe('248 250 252')
  })
})

describe('contrastRatio', () => {
  it('is 21 for white on black', () => {
    expect(contrastRatio('255 255 255', '0 0 0')).toBeCloseTo(21)
  })

  it('is about 4.54 for #767676 on white', () => {
    expect(contrastRatio('118 118 118', '255 255 255')).toBeCloseTo(4.54, 2)
  })
})

// Literal copy of KELP_DEFAULT from presets.ts.
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
    primary: { '100': '241 245 249', '900': '15 23 42' },
    other: { black: '0 0 0', white: '255 255 255' },
  }
}

type ColorChange = [category: string, shade: string, value: string]

describe('themeContrastWarnings', () => {
  it('reports nothing for the Kelp default', () => {
    expect(themeContrastWarnings(kelpColors())).toEqual([])
  })

  // Rows whose failing colour appears only in the intended pair.
  it.each<[string, ColorChange[]]>([
    ['light-body', [['slate', '900', '248 250 252']]],
    ['dark-body', [['zinc', '100', '25 25 29']]],
    ['dark-primary-button', [['zinc', '900', '241 245 249']]],
    // primary-100 also backs dark-primary-button, so zinc-900 turns white to keep that pair passing.
    [
      'dark-accent',
      [
        ['primary', '100', '25 25 29'],
        ['zinc', '900', '255 255 255'],
      ],
    ],
    // The primary button's text sits on a gradient, so both stops must pass.
    // zinc-900 '34 34 39' on grey 132 is ≈ 4.23 (zinc-950 '25 25 29' ≈ 4.69,
    // so dark-accent passes). Stepping darker to about '73 72 72' would drop
    // it to ≈ 1.74, so the derived stop steps lighter (≈ 9.17) and the
    // warning reports the accent's own ratio.
    ['dark-primary-button', [['primary', '100', '132 132 132']]],
  ])('reports only %s', (id, changes) => {
    const colors = kelpColors()
    for (const [category, shade, value] of changes)
      colors[category][shade] = value
    const warnings = themeContrastWarnings(colors)
    expect(warnings.map((warning) => warning.id)).toEqual([id])
    expect(warnings[0]?.ratio).toBeLessThan(4.5)
  })

  // light-primary-button and light-accent share slate-50 on primary-900, so a
  // too-light accent reports both. slate-50 '248 250 252' on grey 150 is
  // ≈ 2.83; the derived stop steps darker (about '108 109 109', ≈ 4.96)
  // rather than lighter (≈ 1.70), so the button reports the accent's ratio.
  it('reports a too-light accent at its own ratio, not a washed-out stop', () => {
    const colors = kelpColors()
    colors.primary['900'] = '150 150 150'
    const warnings = themeContrastWarnings(colors)
    expect(warnings.map((warning) => warning.id).sort()).toEqual([
      'light-accent',
      'light-primary-button',
    ])
    for (const warning of warnings) expect(warning.ratio).toBeCloseTo(2.83, 2)
  })

  // light-primary-button and light-accent are the same two colours (slate-50 and primary-900).
  it.each<[string, ColorChange]>([
    ['light-primary-button', ['primary', '900', '248 250 252']],
    ['light-accent', ['primary', '900', '255 255 255']],
  ])('reports %s', (id, [category, shade, value]) => {
    const colors = kelpColors()
    colors[category][shade] = value
    const warning = themeContrastWarnings(colors).find(
      (candidate) => candidate.id === id,
    )
    expect(warning?.ratio).toBeLessThan(4.5)
  })
})
