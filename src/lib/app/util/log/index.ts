/**
 * Isomorphic logging.
 *
 * The same `log.error` / `log.warn` call works in a universal module, but the
 * two runtimes want opposite things:
 *
 * - On the SERVER a line is machine-read. It goes out as ONE JSON string so a
 *   shipper cannot split a record. Every string is scrubbed and capped, and
 *   objects are reduced to their class tag plus key names — stderr is a place
 *   secrets get archived.
 * - In the BROWSER a line is human-read. `msg`, the Error and the fields are
 *   passed as separate console arguments, deliberately RAW: devtools can then
 *   expand the object and keep the stack clickable, nothing is shipped to a
 *   sink, and the user already holds their own secrets.
 *
 * Request context (`requestId`, `method`, `path`) is picked up ambiently from
 * `currentRequestEvent()`, so callers never thread it through. Server callers
 * that already hold a `LogContext` may pass it explicitly; it overrides the
 * ambient values.
 *
 * Caller-supplied `fields` are always nested under `fields`, never merged into
 * the envelope, so a field named `level` or `requestId` cannot forge one.
 *
 * This module reads no environment: `$env/dynamic/private` is server-only, and
 * importing it here would put the browser bundle out of reach. Stack policy
 * therefore arrives through `installServerLogPolicy`, which `$lib/server/log`
 * calls at module load. It also must not branch on `dev`: that is a build-time
 * constant, and Vitest mocks it per test file, so a `dev` branch here would
 * silently behave one way under test and another in production.
 */
import { browser } from '$app/environment'
import { currentRequestEvent } from '$lib/app/util/request-event'
import {
  clean,
  describeValue,
  MAX_MESSAGE,
  safeRead,
  serializeError,
  UNSERIALIZABLE,
} from './serialize'
import { isSecretKey, REDACTED } from './scrub'

/**
 * Structured extras for one line. Strings are scrubbed and capped, numbers and
 * booleans and `null` ride as-is, and an object is DESCRIBED — its class tag
 * and own key names — never dumped, because values are what leak. `undefined`
 * drops out entirely.
 */
export type LogFields = Record<
  string,
  string | number | boolean | null | undefined | object
>

/** Request-scoped context attached to a log line. Any key may be omitted. */
export interface LogContext {
  readonly requestId?: string
  readonly method?: string
  readonly path?: string
  readonly status?: number
}

const CONTEXT_KEYS = ['requestId', 'method', 'path', 'status'] as const

/** How the server decides whether stacks are included. */
export interface ServerLogPolicy {
  readonly includeStack: () => boolean
}

let policy: ServerLogPolicy | undefined

/**
 * Installs the server's stack policy. Called by `$lib/server/log` at module
 * load — the one place allowed to read `LOG_STACKS`. Re-installing replaces,
 * since that module re-evaluates under HMR.
 */
export function installServerLogPolicy(next: ServerLogPolicy): void {
  policy = next
}

/** Stacks are in by default; only an installed policy can switch them off. */
function includeStack(): boolean {
  return policy?.includeStack() ?? true
}

type Level = 'error' | 'warn'

/** What one call can attach to a line, beyond the message itself. */
interface LogPayload {
  readonly ctx?: LogContext
  readonly err?: unknown
  readonly fields?: LogFields
}

/**
 * Renders one field value. Mirrors the rules on {@link LogFields}, and holds
 * for values the type does not admit — an untyped caller, a widened `unknown`
 * or a plain `.js` module can hand over anything.
 *
 * A function and a symbol are reduced to a fixed tag, never stringified: a
 * closure's source prints its body verbatim, secrets and all, and a symbol
 * carries its description. Everything else is DESCRIBED and then cleaned,
 * because `describeObject` prints key names and a key name is as much a place
 * to hide a secret as a value is.
 */
function renderField(value: unknown): unknown {
  if (typeof value === 'string') return clean(value, MAX_MESSAGE)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value === null) return null
  if (typeof value === 'function') return '[function]'
  if (typeof value === 'symbol') return '[symbol]'
  return clean(describeValue(value), MAX_MESSAGE)
}

/**
 * Marks a key whose value could not be read at all. Distinct from `undefined`,
 * which is a value the caller really passed and which drops out of the line.
 */
const UNREADABLE = Symbol('unreadable')

/** Reads one field, telling a throwing getter apart from a real `undefined`. */
function readField(fields: LogFields, key: string): unknown {
  try {
    return (fields as Record<string, unknown>)[key]
  } catch {
    return UNREADABLE
  }
}

/**
 * Walks `fields` defensively: a hostile or merely buggy getter costs its own
 * key, not the whole line, and an object that refuses to list its keys costs
 * only the bag. Both are MARKED rather than dropped — a silently missing key
 * reads as "the caller never passed it", which sends whoever is debugging the
 * failure down the wrong path.
 *
 * A key that names a credential loses its value whatever the value is. Text
 * scrubbing only fires on `key=value` shapes, so a bare token sitting alone in
 * a field looks like ordinary data; here the NAME is what condemns it.
 *
 * Returns undefined when nothing survives, so the envelope carries no empty
 * `fields`.
 */
function renderFields(
  fields: LogFields,
): Record<string, unknown> | string | undefined {
  const keys = safeRead(() => Object.keys(fields))
  if (!Array.isArray(keys)) return UNSERIALIZABLE

  const rendered: Record<string, unknown> = {}
  for (const key of keys) {
    const value = readField(fields, key)
    if (value === UNREADABLE) {
      rendered[key] = UNSERIALIZABLE
      continue
    }
    if (value === undefined) continue
    rendered[key] = isSecretKey(key) ? REDACTED : renderField(value)
  }
  return Object.keys(rendered).length > 0 ? rendered : undefined
}

/**
 * The context of the request being handled, read off the accessor
 * `hooks.server.ts` installs. Absent in the browser, and outside a request.
 *
 * Only the pathname is taken from the URL: a query string is exactly where
 * OAuth codes and tokens live.
 */
function ambientContext(): LogContext | undefined {
  const event = currentRequestEvent()
  if (!event) return undefined

  // Narrowed, not cast: `locals` is app-owned and typed only by convention, so
  // a producer that puts a number in `requestId` is broken rather than
  // authoritative. The declared type says string, so anything else is dropped.
  const asString = (read: () => unknown): string | undefined => {
    const value = safeRead(read)
    return typeof value === 'string' ? value : undefined
  }

  return {
    // Presence over truthiness everywhere else, but an empty request id is not
    // a real one — it would read as a correlatable value that correlates nothing.
    requestId: asString(() => event.locals.requestId) || undefined,
    method: asString(() => event.request.method),
    path: asString(() => event.url.pathname),
  }
}

/** Writes the context keys in a fixed order, explicit values winning. */
function writeContext(
  line: Record<string, unknown>,
  ctx: LogContext | undefined,
): void {
  for (const key of CONTEXT_KEYS) {
    const value = ctx?.[key]
    // Presence, not truthiness: `status: 0` is a real value worth keeping.
    if (value === undefined) continue
    // A path can carry a query string, so context is scrubbed like everything else.
    line[key] = typeof value === 'string' ? clean(value, MAX_MESSAGE) : value
  }
}

/**
 * Builds and writes one line. Exported for `$lib/server/log`, whose public
 * signature puts `ctx` where this module's `log` puts `err`; everything else
 * about the two is identical, and there must be exactly one emitter.
 */
export function emit(
  level: Level,
  msg: string,
  { ctx, err, fields }: LogPayload = {},
): void {
  // Called through `console` rather than captured into a variable: a detached
  // console method loses its receiver in some runtimes, and a test spy is
  // installed on the property.
  const write = (...args: readonly unknown[]): void => {
    if (level === 'error') {
      console.error(...args)
    } else {
      console.warn(...args)
    }
  }

  if (browser) {
    // Raw and unscrubbed, by design — see the module comment.
    const args: unknown[] = [msg]
    if (err !== undefined) args.push(err)
    if (fields !== undefined) args.push(fields)
    write(...args)
    return
  }

  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: clean(msg, MAX_MESSAGE),
  }
  writeContext(line, ambientContext())
  writeContext(line, ctx)

  if (fields !== undefined) {
    const rendered = renderFields(fields)
    if (rendered !== undefined) line.fields = rendered
  }
  // Presence, not truthiness: a thrown `null` is still something that was thrown.
  if (err !== undefined) {
    line.err = serializeError(err, 0, new Set([err]), includeStack())
  }

  write(JSON.stringify(line))
}

export const log = {
  error(msg: string, err?: unknown, fields?: LogFields): void {
    emit('error', msg, { err, fields })
  },
  warn(msg: string, err?: unknown, fields?: LogFields): void {
    emit('warn', msg, { err, fields })
  },
} as const
