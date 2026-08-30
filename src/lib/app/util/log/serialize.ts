/**
 * Bounded, scrubbed rendering of unknown thrown values and of the text that
 * goes into a log line.
 *
 * Universal: no environment and no request context is read here. Stack
 * inclusion is policy, not something this module can decide, so it arrives as
 * the `includeStack` parameter of `serializeError`, which the server logger
 * gates on `LOG_STACKS`. The browser path never calls in here at all: it hands
 * the Error itself to devtools rather than serializing it.
 */
import { scrub } from './scrub'

/** Marks a value that was cut short, so a truncated line is never mistaken for a whole one. */
const TRUNCATED = '…[truncated]'

/** A hostile value can refuse to stringify; we log that fact instead of throwing. */
export const UNSERIALIZABLE = '[unserializable]'

// Caps keep one record within the line-size limit log shippers impose before
// they split or drop a line; a truncated line still parses as JSON.
export const MAX_MESSAGE = 2000
const MAX_STACK = 8000
const MAX_NAME = 200

/** How many `cause` links to follow. Bounds both line size and a hostile chain. */
const MAX_CAUSE_DEPTH = 2

/** Reads a value, absorbing a getter or proxy trap that throws. */
export function safeRead(read: () => unknown): unknown {
  try {
    return read()
  } catch {
    return undefined
  }
}

/** Stringifies whatever `read()` yields, absorbing a throwing getter or `toString`. */
function safeText(read: () => unknown): string {
  try {
    return String(read())
  } catch {
    return UNSERIALIZABLE
  }
}

/** `instanceof` invokes a proxy's `getPrototypeOf` trap, which may throw. */
function isError(value: unknown): boolean {
  try {
    return value instanceof Error
  } catch {
    return false
  }
}

/** Scrubs first, then caps length: a cut must never expose the tail of a secret. */
export function clean(text: string, limit: number): string {
  const scrubbed = scrub(text)
  return scrubbed.length > limit
    ? `${scrubbed.slice(0, limit)}${TRUNCATED}`
    : scrubbed
}

/**
 * How much key list to build. Callers cap the result at `MAX_MESSAGE` anyway,
 * so anything past this is assembled only to be thrown away — and a 10k-key
 * object would build an 80KB string first. Stopping just past the cap leaves
 * `clean` something to truncate, so a cut list still says it was cut.
 */
const MAX_KEY_LIST = MAX_MESSAGE

/**
 * Describes an object without dumping it: its class tag plus its own key
 * NAMES, sorted. Names say what was thrown; values are what leaks.
 *
 * A list that had to be cut is prefixed with the total count, which is the
 * part worth keeping — it goes in front because `clean` truncates the tail.
 */
function describeObject(value: object): string {
  const tag = safeText(() => Object.prototype.toString.call(value))
  const keys = safeRead(() => Object.keys(value).sort())
  if (!Array.isArray(keys) || keys.length === 0) return tag

  let list = ''
  let shown = 0
  for (const key of keys) {
    if (list.length > MAX_KEY_LIST) break
    list += shown === 0 ? String(key) : `, ${String(key)}`
    shown += 1
  }
  return shown < keys.length
    ? `${tag} ${keys.length} keys: ${list}`
    : `${tag} keys: ${list}`
}

/** Reduces any non-Error throwable to one line of text. */
export function describeValue(value: unknown): string {
  return typeof value === 'object' && value !== null
    ? describeObject(value)
    : safeText(() => value)
}

export interface SerializedError {
  readonly name: string
  readonly message: string
  readonly stack?: string
  readonly code?: string
  readonly cause?: SerializedError
  readonly errorCount?: number
  readonly errors?: readonly SerializedError[]
}

/**
 * Reduces an unknown thrown value to a bounded, scrubbed record.
 *
 * Only `name`, `message`, a policy-gated `stack`, a string `code`, a
 * depth-capped `cause` chain and an `AggregateError`'s first entry are read.
 * Nothing else is walked, and a non-Error is described rather than serialized,
 * so a thrown object full of cookies or headers cannot be dumped.
 */
export function serializeError(
  err: unknown,
  depth: number,
  seen: Set<unknown>,
  includeStack: boolean,
): SerializedError {
  if (!isError(err)) {
    return { name: 'Error', message: clean(describeValue(err), MAX_MESSAGE) }
  }
  const error = err as Error

  const rawStack = includeStack ? safeRead(() => error.stack) : undefined
  const stack =
    typeof rawStack === 'string' ? clean(rawStack, MAX_STACK) : undefined

  const rawCode = safeRead(() => (error as { code?: unknown }).code)
  const code =
    typeof rawCode === 'string' ? clean(rawCode, MAX_NAME) : undefined

  const rawCause =
    depth < MAX_CAUSE_DEPTH
      ? safeRead(() => (error as { cause?: unknown }).cause)
      : undefined
  let cause: SerializedError | undefined
  if (rawCause !== undefined && !seen.has(rawCause)) {
    seen.add(rawCause)
    cause = serializeError(rawCause, depth + 1, seen, includeStack)
  }

  // AggregateError: the count is the diagnostic, the first entry is the sample.
  // Both are read through `safeRead` — `errors` can be a proxy whose `length`
  // or index traps throw — and the sample is walked under the SAME depth and
  // cycle bounds as `cause`, because `errors` is the same shape of unbounded
  // recursion: an aggregate that contains itself would otherwise never bottom
  // out.
  const rawErrors = safeRead(() => (error as { errors?: unknown }).errors)
  const aggregate = Array.isArray(rawErrors) ? rawErrors : undefined
  const rawCount = safeRead(() => aggregate?.length)
  const errorCount = typeof rawCount === 'number' ? rawCount : undefined

  let sample: SerializedError | undefined
  if (errorCount !== undefined && errorCount > 0 && depth < MAX_CAUSE_DEPTH) {
    const first = safeRead(() => aggregate?.[0])
    if (!seen.has(first)) {
      seen.add(first)
      sample = serializeError(first, depth + 1, seen, includeStack)
    }
  }

  return {
    name: clean(
      safeText(() => error.name),
      MAX_NAME,
    ),
    message: clean(
      safeText(() => error.message),
      MAX_MESSAGE,
    ),
    ...(stack !== undefined && { stack }),
    ...(code !== undefined && { code }),
    ...(cause !== undefined && { cause }),
    ...(errorCount !== undefined && { errorCount }),
    ...(sample !== undefined && { errors: [sample] }),
  }
}
