import { describe, it, expect, vi } from 'vitest'
import { presets } from './presets'

/**
 * loadTheme() runs at module init, so each case re-imports the module with a
 * fresh localStorage stub. These tests exist because a corrupted
 * localStorage['theme.data'] used to throw during init and white-screen the
 * app on every subsequent visit — both for unparseable JSON and for
 * valid-JSON-wrong-shape payloads (e.g. themes: [null]).
 */
async function importThemeWith(
  stored: string | null,
  publicEnv: Record<string, string> = {},
) {
  vi.resetModules()
  vi.doMock('$app/environment', () => ({
    browser: true,
    dev: true,
    building: false,
  }))
  vi.doMock('$env/dynamic/public', () => ({ env: publicEnv }))

  const store = new Map<string, string>(
    stored === null ? [] : [['theme.data', stored]],
  )
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  })

  const module = await import('./theme.svelte')
  const presetsModule = await import('./presets')
  return {
    theme: module.theme,
    store,
    getDefaultColors: presetsModule.getDefaultColors,
  }
}

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

function storedThemes(
  themes: { id: number; name: string; colors: unknown }[],
  currentTheme: number,
) {
  return JSON.stringify({ scheme: 'system', themes, currentTheme })
}

function customTheme(id: number, name = `Custom ${id}`) {
  return { id, name, colors: kelpColors() }
}

/**
 * localStorage doesn't merely return null when it's unavailable — Safari's
 * private mode and blocked-storage contexts throw on access, and a full quota
 * throws on write. Both have to degrade to "theme isn't persisted", never to a
 * throw out of module init or out of the persist effect.
 */
async function importThemeWithThrowingStorage(err: Error) {
  vi.resetModules()
  vi.doMock('$app/environment', () => ({
    browser: true,
    dev: true,
    building: false,
  }))
  vi.doMock('$env/dynamic/public', () => ({ env: {} }))

  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw err
    },
    setItem: () => {
      throw err
    },
    removeItem: () => {
      throw err
    },
  })

  return import('./theme.svelte')
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

describe('theme persistence when localStorage is unavailable', () => {
  it('falls back to defaults when reads throw at module init', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { theme } = await importThemeWithThrowingStorage(
      new DOMException('The operation is insecure.', 'SecurityError'),
    )

    expect(theme.data.themes.length).toBe(presets.length)
    expect(theme.data.currentTheme).toBe(0)
    expect(theme.colorScheme).toBe('system')
    expect(error).toHaveBeenCalled()
    expect(String(error.mock.calls[0][0])).toContain('[theme]')
  })

  it('does not throw out of the persist path when writes throw', async () => {
    const module = await importThemeWithThrowingStorage(
      new DOMException('Quota exceeded.', 'QuotaExceededError'),
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => module.persistThemeData(module.theme.data)).not.toThrow()
    expect(() => module.persistColorScheme('dark')).not.toThrow()

    expect(error).toHaveBeenCalledTimes(2)
    expect(String(error.mock.calls[0][0])).toContain(
      'will not survive a reload',
    )
    expect(String(error.mock.calls[1][0])).toContain(
      'Failed to persist colorScheme',
    )
    expect(String(error.mock.calls[0][1])).toContain('Quota exceeded.')
  })
})

describe('theme storage validation', () => {
  it('fills a null color category from the defaults', async () => {
    const { theme } = await importThemeWith(
      '{"themes":[{"id":1,"name":"x","colors":{"primary":null}}],"currentTheme":1}',
    )
    expect(theme.current.colors.primary['900']).toBe('15 23 42')
    expect(theme.vars).toContain('--color-primary-900:rgb(15 23 42)')
  })

  it('normalizes a stored hex shade to an rgb triple', async () => {
    const colors = kelpColors()
    colors.zinc['900'] = '#ff0000'
    const { theme } = await importThemeWith(
      storedThemes([{ id: 1, name: 'x', colors }], 1),
    )
    expect(theme.current.colors.zinc['900']).toBe('255 0 0')
  })

  it('drops stored entries that claim preset ids', async () => {
    const { theme } = await importThemeWith(
      storedThemes([customTheme(0, 'Impostor'), customTheme(-1, 'Fake')], 0),
    )
    const defaults = theme.data.themes.filter((t) => t.id === 0)
    expect(defaults).toHaveLength(1)
    expect(defaults[0].name).toBe('Mono')
    expect(theme.data.themes.filter((t) => t.id === -1)).toHaveLength(1)
  })

  it('gives duplicate stored custom ids unique ids', async () => {
    const { theme } = await importThemeWith(
      storedThemes([customTheme(1, 'A'), customTheme(1, 'B')], 1),
    )
    const ids = theme.data.themes.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    const customNames = theme.data.themes
      .filter((t) => t.id > 0)
      .map((t) => t.name)
      .sort()
    expect(customNames).toEqual(['A', 'B'])
  })
})

describe('theme.deleteTheme', () => {
  it('removes a non-current custom theme and keeps the selection', async () => {
    const { theme } = await importThemeWith(
      storedThemes([customTheme(1), customTheme(2)], 2),
    )
    theme.deleteTheme(1)
    expect(theme.data.themes.some((t) => t.id === 1)).toBe(false)
    expect(theme.data.currentTheme).toBe(2)
  })

  it('selects the default theme after deleting the current theme', async () => {
    const { theme } = await importThemeWith(
      storedThemes([customTheme(1), customTheme(2)], 2),
    )
    theme.deleteTheme(2)
    expect(theme.data.themes.some((t) => t.id === 2)).toBe(false)
    expect(theme.data.currentTheme).toBe(0)
  })

  it('does not delete a preset', async () => {
    const { theme } = await importThemeWith(null)
    theme.deleteTheme(-1)
    expect(theme.data.themes.some((t) => t.id === -1)).toBe(true)
  })
})

describe('theme.duplicateTheme', () => {
  it('copies the default preset into a new selected theme', async () => {
    const { theme } = await importThemeWith(storedThemes([customTheme(3)], 3))
    const id = theme.duplicateTheme(0, 'Copy')
    expect(id).toBe(4)
    const copy = theme.data.themes.find((t) => t.id === 4)
    expect(copy?.name).toBe('Copy')
    expect(copy?.colors).toEqual(kelpColors())
    expect(theme.data.currentTheme).toBe(4)
  })

  it('copies a non-default preset', async () => {
    const { theme } = await importThemeWith(storedThemes([customTheme(3)], 3))
    theme.duplicateTheme(0, 'Copy')
    const id = theme.duplicateTheme(-1, 'C2')
    expect(id).toBe(5)
    const copy = theme.data.themes.find((t) => t.id === 5)
    expect(copy?.colors.zinc['900']).toBe('18 18 21')
  })

  it('does not share colour objects with the source preset', async () => {
    const { theme, getDefaultColors } = await importThemeWith(
      storedThemes([customTheme(3)], 3),
    )
    theme.duplicateTheme(0, 'Copy')
    const copy = theme.data.themes.find((t) => t.id === 4)
    if (!copy) throw new Error('copy missing')
    copy.colors.zinc['900'] = '1 2 3'
    const preset = theme.data.themes.find((t) => t.id === 0)
    expect(preset?.colors).toEqual(kelpColors())
    expect(getDefaultColors()).toEqual(kelpColors())
  })
})

describe('theme.resetCurrentColors', () => {
  it('restores an edited custom theme to the default colours', async () => {
    const colors = kelpColors()
    colors.zinc['900'] = '1 2 3'
    const { theme } = await importThemeWith(
      storedThemes([{ id: 1, name: 'x', colors }], 1),
    )
    theme.resetCurrentColors()
    expect(theme.current.colors).toEqual(kelpColors())
  })

  it('does not share colour objects with the defaults after reset', async () => {
    const { theme, getDefaultColors } = await importThemeWith(
      storedThemes([customTheme(1)], 1),
    )
    theme.resetCurrentColors()
    theme.current.colors.zinc['900'] = '1 2 3'
    expect(getDefaultColors()).toEqual(kelpColors())
  })

  it('leaves a preset unchanged', async () => {
    const { theme } = await importThemeWith(null)
    theme.resetCurrentColors()
    expect(theme.current.id).toBe(0)
    expect(theme.current.colors).toEqual(kelpColors())
  })
})

describe('theme.setColor', () => {
  it('stores a hex value as an rgb triple', async () => {
    const { theme } = await importThemeWith(storedThemes([customTheme(1)], 1))
    theme.setColor('zinc', '900', '#ff0000')
    expect(theme.current.colors.zinc['900']).toBe('255 0 0')
  })

  it('rejects an invalid colour', async () => {
    const { theme } = await importThemeWith(storedThemes([customTheme(1)], 1))
    theme.setColor('zinc', '900', 'nope')
    expect(theme.current.colors.zinc['900']).toBe('34 34 39')
  })

  it('does not edit a preset', async () => {
    const { theme } = await importThemeWith(null)
    theme.setColor('zinc', '900', '#ff0000')
    expect(theme.current.colors.zinc['900']).toBe('34 34 39')
  })
})

describe('theme.renameTheme', () => {
  it.each(['', '  '])('rejects the empty name %j', async (name) => {
    const { theme } = await importThemeWith(
      storedThemes([customTheme(1, 'Old')], 1),
    )
    expect(theme.renameTheme(1, name)).toBe('empty-name')
    expect(theme.current.name).toBe('Old')
  })

  it('trims the new name', async () => {
    const { theme } = await importThemeWith(
      storedThemes([customTheme(1, 'Old')], 1),
    )
    expect(theme.renameTheme(1, '  New  ')).toBe(null)
    expect(theme.current.name).toBe('New')
  })
})

describe('theme.importIntoCurrent', () => {
  it('imports legacy colours and fills missing categories', async () => {
    const { theme } = await importThemeWith(storedThemes([customTheme(1)], 1))
    const result = theme.importIntoCurrent(
      JSON.stringify({ zinc: { '900': '#ff0000' } }),
    )
    expect(result).toBe(null)
    expect(theme.current.colors.zinc['900']).toBe('255 0 0')
    expect(theme.current.colors.primary['900']).toBe('15 23 42')
  })

  it('applies the name from the named format', async () => {
    const { theme } = await importThemeWith(storedThemes([customTheme(1)], 1))
    const result = theme.importIntoCurrent(
      JSON.stringify({
        name: 'Imported',
        colors: { zinc: { '900': '#ff0000' } },
      }),
    )
    expect(result).toBe(null)
    expect(theme.current.name).toBe('Imported')
    expect(theme.current.colors.zinc['900']).toBe('255 0 0')
  })

  it('reports invalid JSON and leaves the colours alone', async () => {
    const { theme } = await importThemeWith(storedThemes([customTheme(1)], 1))
    expect(theme.importIntoCurrent('nope')).toBe('invalid-json')
    expect(theme.current.colors).toEqual(kelpColors())
  })

  it('refuses to import into a preset', async () => {
    const { theme } = await importThemeWith(null)
    expect(
      theme.importIntoCurrent(JSON.stringify({ zinc: { '900': '#ff0000' } })),
    ).toBe('preset-not-editable')
    expect(theme.current.colors).toEqual(kelpColors())
  })
})

describe('PUBLIC_THEME instance default colours', () => {
  it('accepts the named export format and fills missing colours from Kelp', async () => {
    const { getDefaultColors } = await importThemeWith(null, {
      PUBLIC_THEME: JSON.stringify({
        name: 'Instance',
        colors: { zinc: { '900': '#ff0000' } },
      }),
    })
    const colors = getDefaultColors()
    expect(colors.zinc['900']).toBe('255 0 0')
    expect(colors.zinc['925']).toBe('28 28 32')
    expect(colors.primary['900']).toBe('15 23 42')
  })

  it('accepts the legacy colours-only format', async () => {
    const { getDefaultColors } = await importThemeWith(null, {
      PUBLIC_THEME: JSON.stringify({ zinc: { '900': '1 2 3' } }),
    })
    const colors = getDefaultColors()
    expect(colors.zinc['900']).toBe('1 2 3')
    expect(colors.slate['25']).toBe('252 253 254')
  })

  it.each([
    ['is not JSON', 'not json'],
    ['misspells colors', '{"colours":{"zinc":{"900":"#ff0000"}}}'],
  ])('falls back to Kelp when PUBLIC_THEME %s', async (_case, publicTheme) => {
    const { getDefaultColors } = await importThemeWith(null, {
      PUBLIC_THEME: publicTheme,
    })
    expect(getDefaultColors()).toEqual(kelpColors())
  })
})

describe('PUBLIC_COLORSCHEME instance default', () => {
  it('falls back to system for a value that is not a colour scheme', async () => {
    const { theme } = await importThemeWith(null, {
      PUBLIC_COLORSCHEME: 'Dark',
    })
    expect(theme.colorScheme).toBe('system')
  })
})

describe('theme id safety', () => {
  it('drops stored ids that are not safe integers', async () => {
    const { theme } = await importThemeWith(
      '{"scheme":"system","currentTheme":2,"themes":[' +
        '{"id":9007199254740992,"name":"Too big","colors":{}},' +
        '{"id":1.5,"name":"Fraction","colors":{}},' +
        '{"id":1e309,"name":"Infinite","colors":{}},' +
        '{"id":2,"name":"Valid","colors":{}}]}',
    )
    const ids = theme.data.themes.map((t) => t.id)
    expect(ids).not.toContain(9007199254740992)
    expect(ids).not.toContain(1.5)
    expect(ids).not.toContain(Infinity)
    expect(ids).toContain(2)
  })

  it('duplicates into a safe unused id when the largest id is MAX_SAFE_INTEGER', async () => {
    const { theme } = await importThemeWith(
      '{"scheme":"system","currentTheme":9007199254740991,"themes":[' +
        '{"id":9007199254740991,"name":"Max","colors":{}}]}',
    )
    const existing = theme.data.themes.map((t) => t.id)
    const id = theme.duplicateTheme(0, 'Copy')
    expect(Number.isSafeInteger(id)).toBe(true)
    expect(existing).not.toContain(id)
  })
})

describe('calculateVars accent gradient', () => {
  it("declares Kelp's derived primary-800 and primary-200 gradient stops", async () => {
    await importThemeWith(null)
    const { calculateVars } = await import('./theme.svelte')
    const vars = calculateVars({ id: 1, name: 'Kelp', colors: kelpColors() })
    expect(vars).toContain('--color-primary-800:rgb(48 58 79)')
    expect(vars).toContain('--color-primary-200:rgb(173 177 181)')
  })
})

describe('theme.replaceColors', () => {
  function redAccentTheme() {
    const colors = kelpColors()
    colors.primary['900'] = '220 38 38'
    return { id: 1, name: 'Red', colors }
  }

  it("replaces a custom theme's colours, normalised", async () => {
    const { theme } = await importThemeWith(storedThemes([redAccentTheme()], 1))
    const colors = kelpColors()
    colors.slate['500'] = '#010203'
    colors.primary['900'] = 'not a colour'

    theme.replaceColors(colors)

    const expected = kelpColors()
    expected.slate['500'] = '1 2 3'
    expect(theme.current.colors).toEqual(expected)
  })

  it('does not restore colours onto a preset', async () => {
    const { theme } = await importThemeWith(null)
    const colors = kelpColors()
    colors.slate['500'] = '1 2 3'

    theme.replaceColors(colors)

    expect(theme.current.colors).toEqual(kelpColors())
  })
})
