/**
 * Shared `Intl` formatters. Constructing one resolves its locale and options
 * every time, which is far costlier than formatting with it, and the feed and
 * comment threads format a relative date and a few numbers for every row they
 * render. Formatters are immutable, so one per locale and options serves them
 * all. The key space is small: a handful of locales times the few option sets
 * the app uses.
 *
 * Deliberately no `DateTimeFormat`: without an explicit `timeZone` one
 * captures the zone current when it was built, and a cached one would keep
 * formatting in it after the zone changes.
 *
 * Construction errors (an unknown locale tag) are not cached; they throw to
 * the caller exactly as `new Intl.*` would.
 */
const cache = new Map<string, Intl.NumberFormat | Intl.RelativeTimeFormat>()

function cached<T extends Intl.NumberFormat | Intl.RelativeTimeFormat>(
  kind: string,
  locale: string | undefined,
  options: object | undefined,
  create: () => T,
): T {
  // Keys sorted, so the same options written in another order share a
  // formatter. Every `Intl` option value is a primitive, so the top-level keys
  // are all there is to order.
  const optionKeys = Object.keys(options ?? {}).sort()
  const key = `${kind}\u0000${locale ?? ''}\u0000${JSON.stringify(options ?? {}, optionKeys)}`
  let formatter = cache.get(key) as T | undefined
  if (!formatter) {
    formatter = create()
    cache.set(key, formatter)
  }
  return formatter
}

export function numberFormat(
  locale?: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  return cached(
    'number',
    locale,
    options,
    () => new Intl.NumberFormat(locale, options),
  )
}

export function relativeTimeFormat(
  locale?: string,
  options?: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  return cached(
    'relative',
    locale,
    options,
    () => new Intl.RelativeTimeFormat(locale, options),
  )
}
