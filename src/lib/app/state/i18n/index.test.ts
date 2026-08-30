/**
 * The public i18n module, exercised on the SERVER path.
 *
 * One Node process renders every request, so `t` and `locale` cannot hold a
 * single module-level value: they must resolve against whichever request is
 * executing when they are read. These tests hold two request contexts open at
 * once through `AsyncLocalStorage` — the same mechanism SvelteKit's
 * `getRequestEvent()` uses — and read the SAME store objects from both.
 *
 * A svelte `readable()`/`derived()` singleton cannot satisfy the isolation
 * test by construction: it computes once and pushes one value to every
 * subscriber. Passing it requires stores that recompute on every subscribe.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { RequestEvent } from '@sveltejs/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { TranslateFn } from './index'

vi.mock('$app/environment', () => ({
  browser: false,
  dev: false,
  building: false,
  version: 'test',
}))

const LOGIN_EN = 'Log in'
const LOGIN_DE = 'Anmelden'
const LOGIN_FR = 'Connexion'

/** Every locale the app ships a dictionary for. */
const EXPECTED_LOCALES = [
  'ar',
  'bg',
  'de',
  'en',
  'es',
  'et',
  'fi',
  'fr',
  'he',
  'hu',
  'ja',
  'nl',
  'pl',
  'pt',
  'pt-BR',
  'ru',
  'tr',
  'zh-Hans',
  'zh-Hant',
]

const asEvent = (lang: string): RequestEvent =>
  ({ locals: { lang } }) as unknown as RequestEvent

/**
 * A fresh module registry per test.
 *
 * `request-event` is imported from the SAME registry as `index`, otherwise the
 * accessor would be installed on a different copy of the module than the one
 * `index` reads through, and every server test would silently fall back to en.
 * Resetting also clears the dictionary cache, which is what lets the
 * "before anything loaded de" case be asserted at all.
 */
async function freshI18n() {
  vi.resetModules()
  const { installRequestEventAccessor } =
    await import('$lib/app/util/request-event')
  const i18n = await import('./index')
  return { ...i18n, installRequestEventAccessor }
}

beforeEach(() => {
  vi.resetModules()
})

describe('i18n public module — server path', () => {
  describe('reads the locale from the in-flight request', () => {
    it('resolves t and locale from locals.lang', async () => {
      const { t, locale, loadTranslations, installRequestEventAccessor } =
        await freshI18n()
      installRequestEventAccessor(() => asEvent('de'))
      await loadTranslations('de')
      // Loaded AFTER de, so any implementation holding one process-wide
      // "current locale" is now pointing at fr while this request wants de.
      // Without this line the test passes on a global-locale design by
      // coincidence.
      await loadTranslations('fr')

      expect(get(t)('account.login')).toBe(LOGIN_DE)
      expect(t.get('account.login')).toBe(LOGIN_DE)
      expect(get(locale)).toBe('de')
      expect(locale.get()).toBe('de')
    })

    it('ignores locale.set — on the server the request is the only source of truth', async () => {
      const { t, locale, loadTranslations, installRequestEventAccessor } =
        await freshI18n()
      installRequestEventAccessor(() => asEvent('de'))
      await loadTranslations('de')
      await loadTranslations('fr')

      // A component reaching for `locale.set` during SSR must not be able to
      // repoint a render that another request is also using.
      locale.set('fr')

      expect(get(locale)).toBe('de')
      expect(get(t)('account.login')).toBe(LOGIN_DE)
      expect(t.get('account.login')).toBe(LOGIN_DE)
    })

    it('falls back to en when no accessor is installed', async () => {
      // Module-evaluation time, a server-side unit test, a background job:
      // there is no request, and reads must degrade rather than throw.
      const { t } = await freshI18n()

      expect(t.get('account.login')).toBe(LOGIN_EN)
      expect(get(t)('account.login')).toBe(LOGIN_EN)
    })
  })

  describe('concurrent requests do not share a locale', () => {
    it('yields a different language per context from the same store objects', async () => {
      const { t, locale, loadTranslations, installRequestEventAccessor } =
        await freshI18n()

      const als = new AsyncLocalStorage<RequestEvent>()
      installRequestEventAccessor(() => als.getStore())

      await loadTranslations('de')
      await loadTranslations('fr')

      // Captured once, outside both contexts: the two renders below read the
      // very same store objects, and must still disagree.
      const tStore = t
      const localeStore = locale

      const ROUNDS = 10
      const render = (lang: string): Promise<string[]> =>
        als.run(asEvent(lang), async () => {
          const seen: string[] = []
          for (let round = 0; round < ROUNDS; round++) {
            seen.push(`${get(localeStore)}:${get(tStore)('account.login')}`)
            // Yield, so the other context runs between two reads of ours.
            await Promise.resolve()
          }
          return seen
        })

      const [german, french] = await Promise.all([render('de'), render('fr')])

      expect(german).toEqual(Array<string>(ROUNDS).fill(`de:${LOGIN_DE}`))
      expect(french).toEqual(Array<string>(ROUNDS).fill(`fr:${LOGIN_FR}`))
    })
  })

  describe('translations are readable synchronously once loaded', () => {
    it('returns the en string before the requested locale has loaded', async () => {
      const { t, installRequestEventAccessor } = await freshI18n()
      installRequestEventAccessor(() => asEvent('de'))

      // Nothing has loaded de. A server render is synchronous, so this must
      // produce the fallback rather than throwing or returning a promise.
      expect(t.get('account.login')).toBe(LOGIN_EN)
    })

    it('returns the locale string synchronously after it has loaded', async () => {
      const { t, loadTranslations, installRequestEventAccessor } =
        await freshI18n()
      installRequestEventAccessor(() => asEvent('de'))

      await loadTranslations('de')
      // Again loaded last, so a global-locale design cannot pass this by
      // happening to point at de.
      await loadTranslations('fr')

      // No await between the load and the read: a server render is
      // synchronous and cannot wait for a dictionary here.
      expect(t.get('account.login')).toBe(LOGIN_DE)
    })
  })

  describe('locales and aliases', () => {
    it('lists every shipped locale', async () => {
      const { locales } = await freshI18n()

      expect([...get(locales)].sort()).toEqual(EXPECTED_LOCALES)
      expect([...locales.get()].sort()).toEqual(EXPECTED_LOCALES)
    })

    it('maps regional codes onto the dictionary that serves them', async () => {
      const { aliases } = await freshI18n()

      expect(aliases.get('zh-CN')).toBe('zh-Hans')
      expect(aliases.get('zh-TW')).toBe('zh-Hant')
      expect(aliases.get('de-AT')).toBe('de')
      expect(aliases.get('en-GB')).toBe('en')
    })
  })

  describe('a captured translator keeps its language', () => {
    it('renders the request it came from even when called outside it', async () => {
      const { t, loadTranslations, installRequestEventAccessor } =
        await freshI18n()
      const als = new AsyncLocalStorage<RequestEvent>()
      installRequestEventAccessor(() => als.getStore())
      await loadTranslations('de')

      let captured: TranslateFn | undefined
      als.run(asEvent('de'), () => {
        const unsubscribe = t.subscribe((translate) => {
          captured = translate
        })
        unsubscribe()
      })

      // A render routinely hands `$t` to something that runs later — a toast
      // callback, an error formatter, a promise continuation — by which time
      // the request context is gone. The translator carries its language with
      // it rather than falling back to en at the moment it is invoked.
      expect(captured?.('account.login')).toBe(LOGIN_DE)
    })
  })
})
