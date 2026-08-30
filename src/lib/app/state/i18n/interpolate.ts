/**
 * Placeholder interpolation for the i18n dictionaries.
 *
 * Replaces `@sveltekit-i18n/parser-default` 1.1.1, behaviour-preserving except
 * that `undefined:` variants are honoured for a missing param (see the
 * DELIBERATE DIVERGENCE cases in `interpolate.forms.test.ts`). The spec is the
 * test trio: `interpolate.test.ts`, `interpolate.forms.test.ts`,
 * `interpolate.security.test.ts` — not this comment.
 *
 * Three forms appear in the dictionaries:
 *   `{{name}}`                      the param, stringified
 *   `{{votes:number}}`              the param, locale-formatted
 *   `{{users; 1:user; default:us;}}` a variant chosen by the param's value
 *
 * Variant values may themselves contain placeholders (`default:{{name}}.`), so
 * scanning is nesting-aware throughout: never split a body on a bare `;` or `:`
 * without first accounting for an inner `{{ … }}`.
 */

const OPEN = '{{'
const CLOSE = '}}'

/** Variant key selected when the param's value matches no other. */
const DEFAULT_VARIANT = 'default'

/** The only modifier the dictionaries use. */
const NUMBER_MODIFIER = 'number'

/** A parsed placeholder body: `name[:modifier][; key:value]…`. */
interface Placeholder {
  readonly name: string
  readonly modifier: string | undefined
  /** Empty when the placeholder declares no variants. */
  readonly variants: ReadonlyMap<string, string>
}

/**
 * Index of the `}}` that closes a placeholder whose body starts at `from`,
 * or -1 if the template never closes it.
 */
function findClose(template: string, from: number): number {
  let depth = 0
  let index = from
  while (index < template.length) {
    if (template.startsWith(OPEN, index)) {
      depth += 1
      index += OPEN.length
    } else if (template.startsWith(CLOSE, index)) {
      if (depth === 0) return index
      depth -= 1
      index += CLOSE.length
    } else {
      index += 1
    }
  }
  return -1
}

/** Splits on `separator`, ignoring separators inside a nested placeholder. */
function splitTopLevel(body: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let index = 0
  while (index < body.length) {
    if (body.startsWith(OPEN, index)) {
      depth += 1
      index += OPEN.length
    } else if (body.startsWith(CLOSE, index)) {
      depth = Math.max(0, depth - 1)
      index += CLOSE.length
    } else {
      if (depth === 0 && body[index] === separator) {
        parts.push(body.slice(start, index))
        start = index + 1
      }
      index += 1
    }
  }
  parts.push(body.slice(start))
  return parts
}

/** First index of `character` outside any nested placeholder, or -1. */
function indexOfTopLevel(text: string, character: string): number {
  let depth = 0
  let index = 0
  while (index < text.length) {
    if (text.startsWith(OPEN, index)) {
      depth += 1
      index += OPEN.length
    } else if (text.startsWith(CLOSE, index)) {
      depth = Math.max(0, depth - 1)
      index += CLOSE.length
    } else {
      if (depth === 0 && text[index] === character) return index
      index += 1
    }
  }
  return -1
}

function parsePlaceholder(body: string): Placeholder {
  const [head = '', ...rest] = splitTopLevel(body, ';')

  const modifierAt = indexOfTopLevel(head, ':')
  const name = (modifierAt === -1 ? head : head.slice(0, modifierAt)).trim()
  const modifier =
    modifierAt === -1 ? undefined : head.slice(modifierAt + 1).trim()

  const variants = new Map<string, string>()
  for (const segment of rest) {
    const valueAt = indexOfTopLevel(segment, ':')
    if (valueAt === -1) continue
    const key = segment.slice(0, valueAt).trim()
    // First declaration of a key wins; a trailing `;` yields an empty segment.
    if (key === '' || variants.has(key)) continue
    variants.set(key, segment.slice(valueAt + 1).trim())
  }

  return { name, modifier, variants }
}

/**
 * Formats `value` the way the parser did: coerced to a number, unparseable
 * values falling back to zero, at most two fraction digits in `locale`.
 *
 * An empty locale is pinned to render nothing — `Intl` cannot be constructed
 * without one — and a locale tag `Intl` rejects degrades the same way rather
 * than throwing mid-render.
 */
function formatNumber(value: unknown, locale: string): string {
  if (locale === '') return ''
  const numeric = Number(value)
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
      Number.isFinite(numeric) ? numeric : 0,
    )
  } catch {
    return ''
  }
}

function resolve(
  placeholder: Placeholder,
  params: Record<string, unknown> | undefined,
  locale: string,
): string {
  const value = params?.[placeholder.name]

  if (placeholder.modifier === NUMBER_MODIFIER && value !== undefined) {
    return formatNumber(value, locale)
  }

  if (placeholder.variants.size === 0) {
    // A missing param renders nothing; a falsy one still renders.
    return value === undefined ? '' : String(value)
  }

  // `String(undefined)` is `'undefined'` — the variant key ten dictionaries
  // use for "the param was not supplied" — so an absent param selects an
  // `undefined:` option before falling through to `default:`.
  const chosen =
    placeholder.variants.get(String(value)) ??
    placeholder.variants.get(DEFAULT_VARIANT)

  // A variant's text may itself hold placeholders (`default:{{name}}.`).
  return chosen === undefined ? '' : interpolate(chosen, params, locale)
}

/** Replaces every `{{…}}` in `template`, preserving the literal text around it. */
export function interpolate(
  template: string,
  params: Record<string, unknown> | undefined,
  locale: string,
): string {
  let result = ''
  let index = 0

  while (index < template.length) {
    const start = template.indexOf(OPEN, index)
    if (start === -1) break

    const end = findClose(template, start + OPEN.length)
    if (end === -1) break

    result += template.slice(index, start)
    result += resolve(
      parsePlaceholder(template.slice(start + OPEN.length, end)),
      params,
      locale,
    )
    index = end + CLOSE.length
  }

  return result + template.slice(index)
}
