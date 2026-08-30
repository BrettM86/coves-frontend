/**
 * Pins dictionary loading, flattening, fallback and caching.
 *
 * Every expectation reads the REAL json in this directory — those files are
 * the data, and a test that mocked them would prove nothing about the
 * flattening. Each test gets a fresh module instance so the "not yet loaded"
 * cases cannot silently depend on a sibling test having loaded a locale.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

/**
 * Polish stands in for a dictionary chunk that will not load — the everyday
 * case being a client that survived a redeploy and asks for a hashed chunk
 * that no longer exists.
 *
 * The failure lives in a `default` GETTER rather than a throwing factory, so
 * it fires once per ACCESS. Vitest caches the module, so a factory that threw
 * would be re-served from cache and a retry would be indistinguishable from a
 * short-circuit; a getter is re-run every time the loader reads `.default`,
 * which makes attempts countable.
 */
const plChunk = vi.hoisted(() => ({ attempts: 0, failUntilAttempt: 0 }))

vi.mock('./pl.json', () => ({
  get default() {
    plChunk.attempts += 1
    if (plChunk.attempts <= plChunk.failUntilAttempt) {
      throw new Error('Failed to fetch dynamically imported module: pl.json')
    }
    return { account: { login: 'Zaloguj się' } }
  },
}))

type DictionaryModule = typeof import('./dictionary')

const freshModule = (): Promise<DictionaryModule> => import('./dictionary')

/** Reads `account.login` out of a loaded locale, for the retry assertion. */
const lookupOnce = (
  mod: DictionaryModule,
  locale: string,
): string | undefined => mod.lookup(locale, 'account.login')

beforeEach(() => {
  vi.resetModules()
  logged.error.length = 0
  logged.warn.length = 0
  plChunk.attempts = 0
  plChunk.failUntilAttempt = 0
})

describe('dictionary', () => {
  describe('lookup — flattened dotted keys', () => {
    it('resolves a nested json path as a dotted key', async () => {
      const { ensureLoaded, lookup } = await freshModule()
      await ensureLoaded('en')

      expect(lookup('en', 'account.login')).toBe('Log in')
    })

    it('returns undefined for an interior (object) node', async () => {
      const { ensureLoaded, lookup } = await freshModule()
      await ensureLoaded('en')

      // `account` is an object in en.json. Flattening must not surface it as
      // a translatable value — the caller gets undefined and falls through.
      // Paired with the leaf below so this cannot pass on an empty cache.
      expect(lookup('en', 'account.login')).toBe('Log in')
      expect(lookup('en', 'account')).toBeUndefined()
    })

    it('returns undefined for an unknown key rather than the key itself', async () => {
      const { ensureLoaded, lookup } = await freshModule()
      await ensureLoaded('en')

      // The key-as-value behaviour belongs to `translate`, not `lookup`.
      expect(lookup('en', 'account.login')).toBe('Log in')
      expect(lookup('en', 'no.such.key.here')).toBeUndefined()
    })
  })

  describe('translate — lookup, fallback, interpolation', () => {
    it('returns the locale string once that locale is loaded', async () => {
      const { ensureLoaded, translate } = await freshModule()
      await ensureLoaded('de')

      expect(translate('de', 'account.login')).toBe('Anmelden')
    })

    it('falls back to en for a key the locale does not define', async () => {
      const { ensureLoaded, translate } = await freshModule()
      await ensureLoaded('de')

      // `account.block` exists in en.json and not in de.json.
      expect(translate('de', 'account.block')).toBe('Block user')
    })

    it('returns the key itself when neither the locale nor en defines it', async () => {
      const { ensureLoaded, translate } = await freshModule()
      await ensureLoaded('de')

      expect(translate('de', 'no.such.key.here')).toBe('no.such.key.here')
    })

    it('interpolates params into the resolved string', async () => {
      const { ensureLoaded, translate } = await freshModule()
      await ensureLoaded('de')

      expect(translate('de', 'account.versionGate', { version: '1.0' })).toBe(
        'Diese Version von Kelp unterstützt Instanzen mit 1.0 oder höher.',
      )
    })

    it('returns the en string for a locale that has not been loaded yet', async () => {
      const { translate } = await freshModule()

      // No ensureLoaded call at all: en must be available without loading, and
      // an unloaded locale must degrade to it rather than throw or return
      // undefined. This is what makes a server render safe before any await.
      expect(translate('de', 'account.login')).toBe('Log in')
    })
  })

  describe('cache — loaded once, never mutated', () => {
    it('does not reload a locale that is already cached', async () => {
      const { ensureLoaded, getDictionary } = await freshModule()

      await ensureLoaded('de')
      const first = getDictionary('de')
      await ensureLoaded('de')
      const second = getDictionary('de')

      expect(first).toBeDefined()
      // Object identity, not deep equality: a reload would build a new object.
      expect(second).toBe(first)
    })

    it('leaves other locales untouched when a locale loads', async () => {
      const { ensureLoaded, getDictionary, lookup } = await freshModule()

      await ensureLoaded('en')
      const enBefore = getDictionary('en')
      expect(lookup('en', 'account.login')).toBe('Log in')

      await ensureLoaded('de')

      expect(getDictionary('en')).toBe(enBefore)
      expect(lookup('en', 'account.login')).toBe('Log in')
      expect(lookup('de', 'account.login')).toBe('Anmelden')
    })
  })

  describe('locale codes are data, not property names', () => {
    it('does not mistake a prototype key for a loadable locale', async () => {
      const { ensureLoaded, getDictionary, lookup } = await freshModule()

      // `loaders` is a plain object, so `loaders['__proto__']` yields
      // Object.prototype and `loaders['constructor']` yields a function —
      // neither is a loader, and both are reachable from an Accept-Language
      // header or a `?lang=` param.
      await expect(ensureLoaded('__proto__')).resolves.toBeUndefined()
      await expect(ensureLoaded('constructor')).resolves.toBeUndefined()

      expect(getDictionary('__proto__')).toBeUndefined()
      expect(getDictionary('constructor')).toBeUndefined()
      expect(lookup('__proto__', 'account.login')).toBeUndefined()
    })

    it('falls back to en for a prototype key', async () => {
      const { translate } = await freshModule()

      expect(translate('__proto__', 'account.login')).toBe('Log in')
      expect(translate('constructor', 'account.login')).toBe('Log in')
    })

    it('does not resolve inherited object properties as translations', async () => {
      const { ensureLoaded, lookup } = await freshModule()
      await ensureLoaded('en')

      // `toString` and friends live on every object's prototype; a lookup for
      // one must miss rather than return a function's source.
      expect(lookup('en', 'toString')).toBeUndefined()
      expect(lookup('en', 'constructor')).toBeUndefined()
    })
  })

  describe('a dictionary that cannot be fetched', () => {
    it('resolves instead of throwing, and reports it once', async () => {
      const { ensureLoaded } = await freshModule()
      plChunk.failUntilAttempt = 1

      // Today this rejection propagates. From `+layout.server.ts` that is an
      // unhandled load failure and the reader gets a 500 — for a translation
      // file. Degrading to English is the proportionate response.
      await expect(ensureLoaded('pl')).resolves.toBeUndefined()

      expect(logged.warn.length + logged.error.length).toBe(1)
      expect(JSON.stringify([...logged.warn, ...logged.error])).toContain('pl')
    })

    it('leaves the locale uncached so lookups fall back to en', async () => {
      const { ensureLoaded, getDictionary, translate } = await freshModule()
      plChunk.failUntilAttempt = 1

      await ensureLoaded('pl')

      // Nothing half-built left behind: no empty dictionary that would make
      // every key resolve to itself instead of to English.
      expect(getDictionary('pl')).toBeUndefined()
      expect(translate('pl', 'account.login')).toBe('Log in')
    })

    it('retries on the next call rather than caching the failure', async () => {
      const { ensureLoaded, getDictionary } = await freshModule()
      plChunk.failUntilAttempt = 1

      await ensureLoaded('pl')
      expect(plChunk.attempts).toBe(1)
      expect(getDictionary('pl')).toBeUndefined()

      // A chunk fetch fails for transient reasons — a flaky network, a deploy
      // in flight. Remembering the failure would strand that reader in English
      // for the life of the tab.
      await ensureLoaded('pl')

      expect(plChunk.attempts).toBe(2)
      expect(getDictionary('pl')).toBeDefined()
      expect(lookupOnce(await freshModule(), 'pl')).toBe('Zaloguj się')
    })
  })
})
