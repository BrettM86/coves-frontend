/**
 * Locale dictionary loading and key lookup.
 *
 * Dictionaries are flattened to dotted keys on load, cached immutably per
 * locale, and fall back to `en`. Pinned by `dictionary.test.ts`.
 *
 * `en` is imported statically rather than through a loader: a server render is
 * synchronous, so the fallback locale has to be readable before any await.
 */
import { log } from '$lib/app/util/log'
import enSource from './en.json'
import { interpolate } from './interpolate'

/** The locale every lookup falls back to; always available without loading. */
export const FALLBACK_LOCALE = 'en'

/** A loaded dictionary: dotted key -> template string. */
export type Dictionary = Readonly<Record<string, string>>

/** One lazily-imported json file per translatable locale, keyed by its code. */
const loaders: Readonly<
  Record<string, () => Promise<{ readonly default: unknown }>>
> = {
  ar: () => import('./ar.json'),
  bg: () => import('./bg.json'),
  de: () => import('./de.json'),
  es: () => import('./es.json'),
  et: () => import('./et.json'),
  fi: () => import('./fi.json'),
  fr: () => import('./fr.json'),
  he: () => import('./he.json'),
  hu: () => import('./hu.json'),
  ja: () => import('./ja.json'),
  nl: () => import('./nl.json'),
  pl: () => import('./pl.json'),
  pt: () => import('./pt.json'),
  'pt-BR': () => import('./pt-BR.json'),
  ru: () => import('./ru.json'),
  tr: () => import('./tr.json'),
  'zh-Hans': () => import('./zh-Hans.json'),
  'zh-Hant': () => import('./zh-Hant.json'),
}

/**
 * Every locale code the app ships a dictionary for, `en` included.
 * Derived from the loader map so the two can never drift apart.
 */
export const AVAILABLE_LOCALES: readonly string[] = Object.freeze([
  FALLBACK_LOCALE,
  ...Object.keys(loaders),
])

/**
 * Collects the string leaves of `node` into `flat` under dotted paths.
 * Interior nodes are not themselves translatable, so they get no entry.
 */
function collect(
  node: unknown,
  prefix: string,
  flat: Record<string, string>,
): void {
  if (node === null || typeof node !== 'object') return
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') {
      flat[path] = value
    } else {
      collect(value, path, flat)
    }
  }
}

function toDictionary(source: unknown): Dictionary {
  const flat: Record<string, string> = {}
  collect(source, '', flat)
  return Object.freeze(flat)
}

const cache = new Map<string, Dictionary>([
  [FALLBACK_LOCALE, toDictionary(enSource)],
])

/** Loads `locale`'s dictionary into the cache. A no-op once cached. */
export async function ensureLoaded(locale: string): Promise<void> {
  if (cache.has(locale)) return
  // Locale codes arrive from an Accept-Language header or a query param, and
  // `loaders` is a plain object: `loaders['__proto__']` yields Object.prototype
  // and `loaders['constructor']` a function, neither of which is a loader.
  if (!Object.hasOwn(loaders, locale)) return

  let dictionary: Dictionary
  try {
    const loaded = await loaders[locale]()
    dictionary = toDictionary(loaded.default)
  } catch (err) {
    // A chunk fetch fails for transient reasons — a flaky network, or a client
    // that survived a redeploy asking for a hashed chunk that is gone. Letting
    // it reject would fail the whole page load over a translation file, so the
    // locale is simply left uncached: lookups fall back to en, and the next
    // call retries rather than being stranded by a remembered failure.
    log.warn(
      '[i18n] dictionary failed to load, falling back to en',
      err,
      { locale },
    )
    return
  }

  // Another caller may have finished this locale while the import was in
  // flight; keep the dictionary that is already cached so its identity holds.
  if (cache.has(locale)) return
  cache.set(locale, dictionary)
}

/** The cached dictionary for `locale`, or undefined if it is not loaded. */
export function getDictionary(locale: string): Dictionary | undefined {
  return cache.get(locale)
}

/** The raw template for `key` in `locale`, or undefined. No fallback. */
export function lookup(locale: string, key: string): string | undefined {
  const dictionary = cache.get(locale)
  // `hasOwn` keeps inherited names (`toString`, `constructor`) from resolving.
  if (dictionary === undefined || !Object.hasOwn(dictionary, key)) {
    return undefined
  }
  return dictionary[key]
}

/** `lookup` + fallback to `en` + interpolation; returns `key` if unknown. */
export function translate(
  locale: string,
  key: string,
  params?: Record<string, unknown>,
): string {
  const template = lookup(locale, key) ?? lookup(FALLBACK_LOCALE, key)
  if (template === undefined) return key
  // The template may come from `en` while numbers still format in `locale`.
  return interpolate(template, params, locale)
}
