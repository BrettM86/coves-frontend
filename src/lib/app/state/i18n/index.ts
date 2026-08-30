/**
 * The app's i18n surface: `t`, `locale`, `locales`,
 * `loadTranslations` and `aliases`.
 *
 * The server renders every request in one Node process, so `t` and `locale`
 * must not hold a value of their own. They are hand-rolled stores that
 * recompute on every subscribe, resolving the language from the request that
 * is currently executing (`locals.lang`, reached through the request-event
 * accessor, which is backed by AsyncLocalStorage). A svelte `readable()` or
 * `derived()` would hold one module-level value and leak one visitor's
 * language into another's render.
 *
 * In the browser there is no request and only ever one user, so the locale is
 * ordinary module state that `locale.set` and `loadTranslations` steer, and
 * subscribers are notified when it changes.
 */
import { browser } from '$app/environment'
import type { Readable, Subscriber, Unsubscriber } from 'svelte/store'
import { currentRequestEvent } from '$lib/app/util/request-event'
import { log } from '$lib/app/util/log'
import {
  AVAILABLE_LOCALES,
  ensureLoaded,
  FALLBACK_LOCALE,
  getDictionary,
  translate,
} from './dictionary'

/** Translates a dotted key, interpolating `params` into the result. */
export type TranslateFn = (
  key: string,
  params?: Record<string, unknown>,
) => string

/** `$t(key, params)` in markup; `t.get(key, params)` outside it. */
export interface TranslationStore extends Readable<TranslateFn> {
  get(key: string, params?: Record<string, unknown>): string
}

/** `$locale` in markup; `locale.get()` / `locale.set()` outside it. */
export interface LocaleStore extends Readable<string> {
  get(): string
  /** Ignored on the server, where the in-flight request decides the language. */
  set(value: string): void
}

/** The locale codes the app ships dictionaries for. */
export interface LocalesStore extends Readable<readonly string[]> {
  get(): readonly string[]
}

/**
 * Regional codes mapped onto the dictionary that serves them, so a visitor
 * asking for `de-AT` gets German rather than the `en` fallback.
 */
export const aliases = new Map([
  ['zh-CN', 'zh-Hans'],
  ['zh-TW', 'zh-Hant'],
  ['en-US', 'en'],
  ['en-GB', 'en'],
  ['en-AU', 'en'],
  ['en-CA', 'en'],
  ['fr-FR', 'fr'],
  ['fr-CA', 'fr'],
  ['fr-BE', 'fr'],
  ['de-DE', 'de'],
  ['de-AT', 'de'],
  ['de-CH', 'de'],
  ['pt-BR', 'pt'],
  ['pt-PT', 'pt'],
  ['fi-FI', 'fi'],
  ['et-EE', 'et'],
  ['he-IL', 'he'],
])

/** The code whose dictionary actually serves `code`. */
function resolveLocale(code: string): string {
  return aliases.get(code) ?? code
}

const noop = (): void => {}

/** Browser-only. On the server this is never read. */
let clientLocale = FALLBACK_LOCALE

/**
 * The language of the render in progress.
 *
 * Server: whatever the in-flight request resolved, never a module-level value.
 * Falls back to `en` outside a request — module evaluation, a unit test, a
 * background job — so reads degrade instead of throwing.
 */
function currentLocale(): string {
  if (browser) return clientLocale
  return currentRequestEvent()?.locals.lang ?? FALLBACK_LOCALE
}

interface RecomputingStore<T> {
  subscribe(run: Subscriber<T>): Unsubscriber
  /** Pushes a freshly computed value to every subscriber. Browser only. */
  notify(): void
}

/**
 * A store whose value is computed at subscribe time rather than held.
 *
 * On the server nothing is retained: each subscribe computes against the
 * request that is executing, and there is no subscriber registry to accumulate
 * across requests. In the browser subscribers are tracked so that a language
 * change re-renders what is already on screen.
 */
function recomputingStore<T>(compute: () => T): RecomputingStore<T> {
  if (!browser) {
    return {
      subscribe(run: Subscriber<T>): Unsubscriber {
        run(compute())
        return noop
      },
      notify: noop,
    }
  }

  const subscribers = new Set<Subscriber<T>>()
  return {
    subscribe(run: Subscriber<T>): Unsubscriber {
      subscribers.add(run)
      run(compute())
      return () => {
        subscribers.delete(run)
      }
    },
    notify(): void {
      const value = compute()
      for (const run of subscribers) run(value)
    },
  }
}

const localeStore = recomputingStore(currentLocale)

// The locale is captured when the store is subscribed, so a `$t` handed to a
// callback keeps rendering the language of the request it came from even if it
// is invoked after that request's context has gone.
const translationStore = recomputingStore<TranslateFn>(() => {
  const at = currentLocale()
  return (key, params) => translate(at, key, params)
})

/** Tells subscribers the language or its dictionary changed. */
function announce(): void {
  localeStore.notify()
  translationStore.notify()
}

/**
 * Which language request is the current one.
 *
 * Loading a dictionary is asynchronous, so two requests can be in flight at
 * once — a `locale.set` from a language menu while `loadTranslations` is still
 * fetching the previous choice. Only the newest may commit, otherwise the load
 * that finishes last wins and flips the reader back to a language they have
 * already moved on from.
 */
let latestRequest = 0

function beginRequest(): number {
  latestRequest += 1
  return latestRequest
}

/** Points the browser at `code` and tells subscribers. Browser only. */
function commit(code: string): void {
  clientLocale = code
  announce()
}

export const t: TranslationStore = {
  subscribe: translationStore.subscribe,
  get: (key, params) => translate(currentLocale(), key, params),
}

export const locale: LocaleStore = {
  subscribe: localeStore.subscribe,
  get: currentLocale,
  set(value: string): void {
    // A component reaching for `locale.set` during SSR must not be able to
    // repoint a render another request is also using.
    if (!browser) return

    const resolved = resolveLocale(value)
    const request = beginRequest()

    // Committed before the dictionary arrives: the chosen language is current
    // straight away, and its keys read as `en` until the load lands. Whoever
    // calls this is a language menu, not a loader — nobody else is going to
    // fetch the dictionary on its behalf.
    commit(resolved)

    // Whether a load is needed at all is `ensureLoaded`'s decision, not one to
    // second-guess here; this only records whether anything NEW can arrive, so
    // an already-cached language does not push a redundant re-render.
    const hadDictionary = getDictionary(resolved) !== undefined

    void ensureLoaded(resolved)
      .then(() => {
        // A newer request has won in the meantime; announcing now would render
        // that language with this one's dictionary.
        if (request !== latestRequest) return
        if (hadDictionary) return
        announce()
      })
      .catch((err: unknown) => {
        // A warning, not an error: the UI still works, in English. The locale
        // stays committed so the language menu keeps showing what the reader
        // picked rather than snapping back on its own. Reported whether or not
        // this request is still the current one — the load really did fail.
        log.warn(
          '[i18n] locale.set: dictionary failed to load, falling back to en',
          err,
          { locale: resolved },
        )
      })
  },
}

export const locales: LocalesStore = {
  subscribe(run: Subscriber<readonly string[]>): Unsubscriber {
    run(AVAILABLE_LOCALES)
    return noop
  },
  get: () => AVAILABLE_LOCALES,
}

/**
 * Ensures `code`'s dictionary is cached, and in the browser switches to it.
 *
 * On the server the language belongs to the request, so this only warms the
 * cache — the render then reads it synchronously.
 */
export async function loadTranslations(code: string): Promise<void> {
  if (!browser) {
    // The server's language belongs to the request, so this only warms the
    // cache — the render then reads it synchronously.
    await ensureLoaded(code)
    return
  }

  const request = beginRequest()
  await ensureLoaded(code)
  // A language requested after this one has already been committed; landing
  // now would undo the reader's newer choice.
  if (request !== latestRequest) return
  commit(code)
}
