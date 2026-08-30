/**
 * The public i18n module, exercised on the BROWSER path.
 *
 * In the browser there is no request event and never more than one user, so
 * the locale IS module state: `locale.set` and `loadTranslations` steer what
 * every component renders. Separate file from `index.test.ts` because
 * `$app/environment`'s `browser` flag is mocked per-file and the two paths
 * need opposite values.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
  version: 'test',
}))

/**
 * Lets a test hold one locale's load open while another finishes, so the
 * "which language wins" question can be asked deterministically instead of
 * being decided by whichever dynamic import happens to resolve first.
 */
const logged = vi.hoisted(() => ({
  error: [] as unknown[][],
  warn: [] as unknown[][],
}))

vi.mock('$lib/app/util/log', () => ({
  log: {
    error: (...args: unknown[]) => {
      logged.error.push(args)
    },
    warn: (...args: unknown[]) => {
      logged.warn.push(args)
    },
  },
}))

const control = vi.hoisted(() => {
  const gates = new Map<string, { promise: Promise<void>; open: () => void }>()
  /** Locales whose dictionary load should fail, as a missing chunk would. */
  const failing = new Set<string>()
  return {
    gates,
    failing,
    hold(locale: string) {
      let open!: () => void
      const promise = new Promise<void>((resolve) => {
        open = resolve
      })
      const gate = { promise, open }
      gates.set(locale, gate)
      return gate
    },
  }
})

vi.mock('./dictionary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./dictionary')>()
  return {
    ...actual,
    ensureLoaded: async (locale: string): Promise<void> => {
      if (control.failing.has(locale)) {
        throw new Error(`failed to fetch dictionary chunk for ${locale}`)
      }
      await actual.ensureLoaded(locale)
      await control.gates.get(locale)?.promise
    },
  }
})

const LOGIN_DE = 'Anmelden'
const LOGIN_FR = 'Connexion'
const LOGIN_EN = 'Log in'
// Polish is touched by no other test in this file. `vi.resetModules()` gives
// `./index` a fresh module but NOT the dictionary cache underneath it — the
// mock factory's `importOriginal()` hands back the same instance every time —
// so a locale another test already loaded would make these pass for free.
const LOGIN_PL = 'Zaloguj się'

async function freshI18n() {
  vi.resetModules()
  return await import('./index')
}

beforeEach(() => {
  vi.resetModules()
  control.gates.clear()
  control.failing.clear()
  logged.error.length = 0
  logged.warn.length = 0
})

describe('i18n public module — browser path', () => {
  it('follows locale.set once the dictionary is loaded', async () => {
    const { t, locale, loadTranslations } = await freshI18n()
    await loadTranslations('fr')

    locale.set('fr')

    expect(get(locale)).toBe('fr')
    expect(get(t)('account.login')).toBe(LOGIN_FR)
    expect(t.get('account.login')).toBe(LOGIN_FR)
  })

  it('loadTranslations sets the locale and t follows it', async () => {
    const { t, locale, loadTranslations } = await freshI18n()

    await loadTranslations('de')

    expect(get(locale)).toBe('de')
    expect(get(t)('account.login')).toBe(LOGIN_DE)
  })

  it('switches language on a later load without a reload', async () => {
    const { t, locale, loadTranslations } = await freshI18n()

    await loadTranslations('de')
    expect(get(t)('account.login')).toBe(LOGIN_DE)

    await loadTranslations('fr')

    expect(get(locale)).toBe('fr')
    expect(get(t)('account.login')).toBe(LOGIN_FR)
  })
})

/**
 * Everything above reads with `get()`, which subscribes and unsubscribes on
 * the spot — so it would keep passing even if the store never told anyone the
 * language changed. Components subscribe once and stay subscribed. These pin
 * that a live subscriber is pushed a new value.
 */
describe('i18n public module — browser subscribers are notified', () => {
  it('pushes a new translation to a t subscriber when locale.set runs', async () => {
    const { t, locale, loadTranslations } = await freshI18n()
    await loadTranslations('de')
    await loadTranslations('fr')
    locale.set('de')

    const seen: string[] = []
    const unsubscribe = t.subscribe((translate) =>
      seen.push(translate('account.login')),
    )
    expect(seen).toEqual([LOGIN_DE])

    locale.set('fr')

    expect(seen).toEqual([LOGIN_DE, LOGIN_FR])
    unsubscribe()
  })

  it('pushes a new translation to a t subscriber when loadTranslations runs', async () => {
    const { t, loadTranslations } = await freshI18n()
    await loadTranslations('fr')

    const seen: string[] = []
    const unsubscribe = t.subscribe((translate) =>
      seen.push(translate('account.login')),
    )
    expect(seen).toEqual([LOGIN_FR])

    await loadTranslations('de')

    expect(seen).toEqual([LOGIN_FR, LOGIN_DE])
    unsubscribe()
  })

  it('pushes the new code to a locale subscriber', async () => {
    const { locale, loadTranslations } = await freshI18n()
    await loadTranslations('de')
    await loadTranslations('fr')
    locale.set('de')

    const seen: string[] = []
    const unsubscribe = locale.subscribe((code) => seen.push(code))
    expect(seen).toEqual(['de'])

    locale.set('fr')

    expect(seen).toEqual(['de', 'fr'])
    unsubscribe()
  })

  it('stops pushing once unsubscribed', async () => {
    // The browser store keeps a subscriber registry; a component that is torn
    // down must leave it, or every language change walks a growing list of
    // dead closures.
    const { locale, loadTranslations } = await freshI18n()
    await loadTranslations('de')
    await loadTranslations('fr')
    locale.set('de')

    const seen: string[] = []
    const unsubscribe = locale.subscribe((code) => seen.push(code))
    unsubscribe()

    locale.set('fr')

    expect(seen).toEqual(['de'])
  })
})

describe('i18n public module — locale.set loads what it names', () => {
  it('loads the dictionary and notifies subscribers', async () => {
    const { t, locale } = await freshI18n()
    const { getDictionary } = await import('./dictionary')

    // Stated as a precondition rather than assumed: nothing has loaded pl.
    // Setting the locale has to be enough on its own — a component calling
    // `locale.set` is not going to call `loadTranslations` as well, and until
    // the dictionary arrives every key falls back to en.
    expect(getDictionary('pl')).toBeUndefined()

    const seen: string[] = []
    const unsubscribe = t.subscribe((translate) =>
      seen.push(translate('account.login')),
    )
    expect(seen).toEqual([LOGIN_EN])

    locale.set('pl')

    await vi.waitFor(() => {
      expect(get(locale)).toBe('pl')
      expect(get(t)('account.login')).toBe(LOGIN_PL)
    })
    // A live subscriber must be told, not just a fresh `get()`.
    expect(seen.at(-1)).toBe(LOGIN_PL)
    unsubscribe()
  })

  it('resolves a regional tag through the alias map', async () => {
    const { t, locale } = await freshI18n()

    locale.set('de-DE')

    await vi.waitFor(() => {
      // `de-DE` has no dictionary of its own; German is what serves it.
      expect(get(locale)).toBe('de')
      expect(get(t)('account.login')).toBe(LOGIN_DE)
    })
  })
})

describe('i18n public module — overlapping loads', () => {
  it('ends on the language requested last, not the one that finished last', async () => {
    const { t, locale, loadTranslations } = await freshI18n()

    // German is requested first but held open; French is requested second and
    // completes immediately. A reader who asked for French must not be flipped
    // back to German when the earlier request finally lands.
    const german = control.hold('de')
    const germanLoad = loadTranslations('de')
    await loadTranslations('fr')

    german.open()
    await germanLoad

    expect(get(locale)).toBe('fr')
    expect(get(t)('account.login')).toBe(LOGIN_FR)
  })
})

describe('i18n public module — a dictionary that cannot be fetched', () => {
  it('keeps the chosen language, falls back to en, and reports it once', async () => {
    const { t, locale } = await freshI18n()
    const { getDictionary } = await import('./dictionary')
    // What a stale client sees after a redeploy: the chunk it asks for is gone.
    // Hungarian is touched by no other test in this file: the dictionary cache
    // survives `vi.resetModules()`, so a locale another test loaded would
    // already be cached and this path would never run.
    expect(getDictionary('hu')).toBeUndefined()
    control.failing.add('hu')

    locale.set('hu')

    await vi.waitFor(() => {
      expect(logged.warn).toHaveLength(1)
    })

    // A warning, not an error: the UI still works, in English. The locale
    // stays committed so the language menu reflects what the reader picked
    // rather than silently snapping back.
    expect(logged.error).toHaveLength(0)
    expect(get(locale)).toBe('hu')
    expect(get(t)('account.login')).toBe(LOGIN_EN)
    expect(JSON.stringify(logged.warn[0])).toContain('hu')
  })

  it('does not reject out of locale.set', async () => {
    const { locale } = await freshI18n()
    control.failing.add('hu')

    // `locale.set` returns void; a rejection escaping it becomes an unhandled
    // rejection that no caller can catch.
    expect(() => locale.set('hu')).not.toThrow()

    await vi.waitFor(() => {
      expect(logged.warn).toHaveLength(1)
    })
  })

  it('still switches language on a later, working load', async () => {
    const { t, locale } = await freshI18n()
    control.failing.add('hu')
    locale.set('hu')
    await vi.waitFor(() => {
      expect(logged.warn).toHaveLength(1)
    })

    // A failed load must not wedge the store.
    locale.set('de')

    await vi.waitFor(() => {
      expect(get(locale)).toBe('de')
      expect(get(t)('account.login')).toBe(LOGIN_DE)
    })
  })
})
