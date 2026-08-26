import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
//
// `settings.svelte.ts` reads localStorage during boot and writes to it from a
// module-level `$effect`, so both need to exist before the import is evaluated.
// `browser: false` keeps the boot path on the defaults instead of whatever a
// previous test left in the stub.
// ---------------------------------------------------------------------------

vi.mock('$app/environment', () => ({
  browser: false,
  dev: false,
  building: false,
  version: 'test',
}))

vi.hoisted(() => {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  } as Storage
})

import {
  defaultSettings,
  importSettings,
  normalizeSettings,
  resetSettings,
  settings,
} from './settings.svelte'

/** Reaches past the schema types to plant the foreign values under test. */
function loosen(value: object): Record<string, unknown> {
  return value as Record<string, unknown>
}

describe('normalizeSettings', () => {
  it('migrates legacy Lemmy-era values written by older versions', () => {
    const target = structuredClone(defaultSettings)
    Object.assign(loosen(target.defaultSort), {
      sort: 'TopWeek',
      feed: 'Subscribed',
      comments: 'Old',
      timeframe: 'TopNineMonths',
    })

    normalizeSettings(target)

    expect(target.defaultSort).toMatchObject({
      sort: 'top',
      feed: 'timeline',
      comments: 'hot',
      timeframe: 'all',
    })
  })

  it('fills in fields a partial payload left missing', () => {
    const target = structuredClone(defaultSettings)
    const defaultSort = loosen(target.defaultSort)
    delete defaultSort.timeframe
    delete defaultSort.feed

    expect(() => normalizeSettings(target)).not.toThrow()
    expect(target.defaultSort.timeframe).toBe('all')
    expect(target.defaultSort.feed).toBe('discover')
  })

  it('coerces non-string leaves rather than throwing', () => {
    // A hand-edited import or corrupted localStorage can put any JSON value
    // here, and this runs during app boot — throwing would brick startup.
    const target = structuredClone(defaultSettings)
    Object.assign(loosen(target.defaultSort), {
      sort: 42,
      feed: null,
      comments: ['top'],
      timeframe: { value: 'week' },
    })

    expect(() => normalizeSettings(target)).not.toThrow()
    expect(target.defaultSort).toMatchObject({
      sort: 'hot',
      feed: 'discover',
      comments: 'hot',
      timeframe: 'all',
    })
  })

  it('leaves already-valid values alone', () => {
    const target = structuredClone(defaultSettings)
    Object.assign(target.defaultSort, {
      sort: 'top',
      feed: 'timeline',
      comments: 'new',
      timeframe: 'week',
    })

    normalizeSettings(target)

    expect(target.defaultSort).toMatchObject({
      sort: 'top',
      feed: 'timeline',
      comments: 'new',
      timeframe: 'week',
    })
  })
})

describe('importSettings', () => {
  beforeEach(() => {
    resetSettings()
  })

  it('applies the keys a payload names and defaults the rest', () => {
    settings.view = 'compact'

    importSettings('{"defaultSort":{"sort":"top","timeframe":"week"}}')

    expect(settings.defaultSort.sort).toBe('top')
    expect(settings.defaultSort.timeframe).toBe('week')
    // Absent keys come from the defaults, not from the pre-import state.
    expect(settings.view).toBe(defaultSettings.view)
  })

  it('accepts a partial defaultSort without leaving fields undefined', () => {
    // Regression: a shallow merge left timeframe/comments/feed undefined and
    // normalization then threw on undefined.toLowerCase(), after the live
    // settings had already been overwritten.
    expect(() => importSettings('{"defaultSort":{"sort":"hot"}}')).not.toThrow()

    expect(settings.defaultSort).toMatchObject({
      sort: 'hot',
      timeframe: 'all',
      comments: 'hot',
      feed: 'discover',
    })
  })

  it('normalizes legacy values in the payload', () => {
    importSettings('{"defaultSort":{"sort":"TopAll","feed":"Subscribed"}}')

    expect(settings.defaultSort.sort).toBe('top')
    expect(settings.defaultSort.feed).toBe('timeline')
  })

  it('ignores a __proto__ key instead of polluting prototypes', () => {
    importSettings('{"__proto__":{"polluted":"yes"}}')

    expect(loosen({}).polluted).toBeUndefined()
    expect(loosen(settings).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(settings)).toBe(Object.prototype)
  })

  it('prunes unknown keys and values of the wrong shape', () => {
    importSettings('{"bogusKey":1,"expandableImages":"yes","view":"compact"}')

    expect(loosen(settings).bogusKey).toBeUndefined()
    expect(settings.expandableImages).toBe(defaultSettings.expandableImages)
    expect(settings.view).toBe('compact')
  })

  it('rejects JSON that is not an object, leaving settings untouched', () => {
    settings.view = 'compact'

    for (const payload of ['42', '"oops"', '[]', 'null']) {
      expect(() => importSettings(payload)).toThrow()
    }

    // Regression: these spread to nothing and silently reset every setting.
    expect(settings.view).toBe('compact')
  })

  it('rejects unparseable text', () => {
    settings.view = 'compact'

    expect(() => importSettings('not json')).toThrow(SyntaxError)
    expect(() => importSettings('')).toThrow(SyntaxError)
    expect(settings.view).toBe('compact')
  })
})

describe('resetSettings', () => {
  it('restores the defaults', () => {
    settings.view = 'compact'
    settings.defaultSort.sort = 'top'

    resetSettings()

    expect(settings.view).toBe(defaultSettings.view)
    expect(settings.defaultSort.sort).toBe(defaultSettings.defaultSort.sort)
  })

  it('does not alias the defaults into the live settings', () => {
    // Regression: assigning defaultSettings directly shared its nested objects,
    // so the next edit mutated the singleton the reset restores from.
    resetSettings()
    settings.defaultSort.sort = 'new'

    expect(defaultSettings.defaultSort.sort).toBe('hot')
  })
})
