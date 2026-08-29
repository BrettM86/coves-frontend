/**
 * Structured server-side logging.
 *
 * Every line is a single JSON string written to `console.error` / `console.warn`,
 * so log shippers can parse it and so a secret that leaks into an error message,
 * a stack or a URL never reaches stderr in the clear.
 *
 * Channel policy: `error` means a human operator needs to look at this; `warn`
 * means the request degraded but was handled and the process carried on.
 *
 * Stacks are included by default and are scrubbed like everything else; set
 * `LOG_STACKS=0` to drop them (see `.env.prod.example`).
 */
import { env } from '$env/dynamic/private'

/** Token substituted for every secret value. Keys and separators are preserved. */
const REDACTED = '[REDACTED]'

/** A quote around a key or value, optionally backslash-escaped (JSON inside a JSON string). */
const QUOTE = '\\\\?["\']'
const OPT_QUOTE = `(?:${QUOTE})?`

/** `=`, `:` or a URL-encoded `=`, with optional surrounding space. */
const SEP = '\\s*(?:[=:]|%3D)\\s*'

/** An unquoted value: runs to the next whitespace, `&`, `;`, `,` or quote. */
const UNQUOTED = '[^\\s&;,"\']+'

/**
 * Wraps a key alternation in its boundary. The boundary is deliberately
 * ASYMMETRIC, because `\b` is useless here — `_` is a word character, so no
 * boundary ever fires inside `DB_PASSWORD`:
 *
 * - LEFT: any run of word characters may precede a key. An env-var name or a
 *   namespace wraps the key it carries — `DB_PASSWORD`, `oauth_client_secret`,
 *   `mypassword` — and the value after it is still the secret.
 * - RIGHT: only `_`/`-`-joined segments may follow — `STRIPE_SECRET_KEY` is a
 *   secret, `secretary` is a different word that merely starts with one.
 *
 * Each trailing segment carries its own separator and holds no underscore, so
 * a run like `A_B_C` has exactly one parse and cannot backtrack.
 *
 * The leading `\b` costs nothing — a match whose prefix is `\w*` always begins
 * at a word start anyway — but it keeps the scan linear: without it the engine
 * retries the prefix from every index inside a long word, which is quadratic on
 * a hostile message, and messages are scrubbed in full before being truncated.
 */
function keyBoundary(keys: readonly string[]): string {
  return `\\b\\w*(?:${keys.join('|')})(?:[_-][^\\W_]+)*`
}

/**
 * Builds a matcher for `key=value`, `key: value`, `"key":"value"` and the
 * backslash-escaped and `%3D` spellings of each.
 *
 * Three alternatives share one prefix so the closing quote is never consumed:
 * a double-quoted value, a single-quoted value (both may contain spaces), and
 * a bare value that stops at whitespace. Exactly one of the three groups is
 * defined per match; the other two substitute as empty strings.
 *
 * `infix` lets a rule keep something between the separator and the value —
 * the auth scheme word, which is diagnostic rather than secret.
 */
function secretKeys(keys: readonly string[], infix = ''): RegExp {
  const pre = `${OPT_QUOTE}${keyBoundary(keys)}${OPT_QUOTE}${SEP}${infix}`
  return new RegExp(
    `(${pre}\\\\?")[^"\\\\]*|(${pre}\\\\?')[^'\\\\]*|(${pre})${UNQUOTED}`,
    'gi',
  )
}

/** Builds a matcher for the JSON form only — `"key":"value"` — quotes required on both. */
function jsonKeys(keys: readonly string[]): RegExp {
  return new RegExp(
    `(${QUOTE}${keyBoundary(keys)}${QUOTE}\\s*:\\s*${QUOTE})[^"'\\\\]*`,
    'gi',
  )
}

interface Redaction {
  readonly pattern: RegExp
  readonly replacement: string
}

/** Names whose value is always a credential, in any spelling or casing. */
const SECRET_KEYS = [
  'password',
  'api[_-]?key',
  'client_secret',
  'secret',
  'dpop_nonce',
  'dpop',
  'access_token',
  'refresh_token',
  'accessToken',
  'refreshToken',
  'sealedToken',
  'token',
  'coves_session',
  'kelp_pending_auth',
  '(?:set-)?cookie',
] as const

const REDACTIONS: readonly Redaction[] = [
  // A cookie header owns its whole line: `Cookie: a=b; c=d` is all secret, and
  // picking out individual pairs would leave the rest exposed. Anchored to the
  // line start so prose that merely mentions `Cookie:` mid-sentence keeps its
  // trailing words and falls through to the ordinary key rule below.
  {
    pattern: /^([ \t]*(?:set-)?cookie[ \t]*:[ \t]*)[^\n]*/gim,
    replacement: `$1${REDACTED}`,
  },
  // A bare `Bearer <token>` with no `authorization` key in front of it.
  // A bare `Bearer` with no token is left alone.
  { pattern: /(\bbearer\s+)\S+/gi, replacement: `$1${REDACTED}` },
  // `authorization` in any form. The scheme word survives — it says how the
  // client authenticated, which is diagnostic; the credential after it does not.
  {
    pattern: secretKeys(
      ['authorization'],
      '(?:(?:Bearer|Basic|DPoP|Digest|Negotiate|Token)\\s+)?',
    ),
    replacement: `$1$2$3${REDACTED}`,
  },
  // Everything whose value is a credential wherever it appears.
  { pattern: secretKeys(SECRET_KEYS), replacement: `$1$2$3${REDACTED}` },
  // `code` and `state` are ordinary words in diagnostics ("exit code=1",
  // "state: ready"), so they are redacted only where they are unambiguously
  // OAuth parameters: delimited by `?`/`&` in a URL, or quoted in JSON.
  {
    pattern: /([?&](?:code|state)=)[^&\s"']+/gi,
    replacement: `$1${REDACTED}`,
  },
  { pattern: jsonKeys(['code', 'state']), replacement: `$1${REDACTED}` },
]

/**
 * Replaces known secret values in `text` with `[REDACTED]`, leaving keys,
 * separators, quotes and surrounding text verbatim. Idempotent.
 */
export function scrub(text: string): string {
  return REDACTIONS.reduce(
    (acc, { pattern, replacement }) => acc.replace(pattern, replacement),
    text,
  )
}

/** Marks a value that was cut short, so a truncated line is never mistaken for a whole one. */
const TRUNCATED = '…[truncated]'

/** A hostile value can refuse to stringify; we log that fact instead of throwing. */
const UNSERIALIZABLE = '[unserializable]'

// Caps keep one record within the line-size limit log shippers impose before
// they split or drop a line; a truncated line still parses as JSON.
const MAX_MESSAGE = 2000
const MAX_STACK = 8000
const MAX_NAME = 200

/** How many `cause` links to follow. Bounds both line size and a hostile chain. */
const MAX_CAUSE_DEPTH = 2

/** Reads a value, absorbing a getter or proxy trap that throws. */
function safeRead(read: () => unknown): unknown {
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
function clean(text: string, limit: number): string {
  const scrubbed = scrub(text)
  return scrubbed.length > limit
    ? `${scrubbed.slice(0, limit)}${TRUNCATED}`
    : scrubbed
}

/**
 * Describes an object without dumping it: its class tag plus its own key
 * NAMES, sorted. Names say what was thrown; values are what leaks.
 */
function describeObject(value: object): string {
  const tag = safeText(() => Object.prototype.toString.call(value))
  const keys = safeRead(() => Object.keys(value).sort())
  return Array.isArray(keys) && keys.length > 0
    ? `${tag} keys: ${keys.join(', ')}`
    : tag
}

/** Reduces any non-Error throwable to one line of text. */
function describeValue(value: unknown): string {
  return typeof value === 'object' && value !== null
    ? describeObject(value)
    : safeText(() => value)
}

/** Request-scoped context attached to a log line. Any key may be omitted. */
export interface LogContext {
  readonly requestId?: string
  readonly method?: string
  readonly path?: string
  readonly status?: number
}

const CONTEXT_KEYS = ['requestId', 'method', 'path', 'status'] as const

interface SerializedError {
  readonly name: string
  readonly message: string
  readonly stack?: string
  readonly code?: string
  readonly cause?: SerializedError
  readonly errorCount?: number
  readonly errors?: readonly SerializedError[]
}

/** Stacks name internal paths, so an operator can switch them off. */
function includeStack(): boolean {
  return env.LOG_STACKS !== '0'
}

/**
 * Reduces an unknown thrown value to a bounded, scrubbed record.
 *
 * Only `name`, `message`, a policy-gated `stack`, a string `code`, a
 * depth-capped `cause` chain and an `AggregateError`'s first entry are read.
 * Nothing else is walked, and a non-Error is described rather than serialized,
 * so a thrown object full of cookies or headers cannot be dumped.
 */
function serializeError(
  err: unknown,
  depth: number,
  seen: Set<unknown>,
): SerializedError {
  if (!isError(err)) {
    return { name: 'Error', message: clean(describeValue(err), MAX_MESSAGE) }
  }
  const error = err as Error

  const rawStack = includeStack() ? safeRead(() => error.stack) : undefined
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
    cause = serializeError(rawCause, depth + 1, seen)
  }

  // AggregateError: the count is the diagnostic, the first entry is the sample.
  const rawErrors = safeRead(() => (error as { errors?: unknown }).errors)
  const aggregate = Array.isArray(rawErrors) ? rawErrors : undefined

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
    ...(aggregate !== undefined && { errorCount: aggregate.length }),
    ...(aggregate !== undefined &&
      aggregate.length > 0 && {
        errors: [serializeError(aggregate[0], depth + 1, seen)],
      }),
  }
}

type Level = 'error' | 'warn'

/** Builds the line and writes it as one string, so a log record is never split. */
function emit(
  level: Level,
  msg: string,
  ctx?: LogContext,
  err?: unknown,
): void {
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: clean(msg, MAX_MESSAGE),
  }
  for (const key of CONTEXT_KEYS) {
    const value = ctx?.[key]
    // Presence, not truthiness: `status: 0` is a real value worth keeping.
    if (value === undefined) continue
    // A path can carry a query string, so context is scrubbed like everything else.
    line[key] = typeof value === 'string' ? clean(value, MAX_MESSAGE) : value
  }
  if (err !== undefined) line.err = serializeError(err, 0, new Set([err]))

  const serialized = JSON.stringify(line)
  if (level === 'error') {
    console.error(serialized)
  } else {
    console.warn(serialized)
  }
}

export const log = {
  error(msg: string, ctx?: LogContext, err?: unknown): void {
    emit('error', msg, ctx, err)
  },
  warn(msg: string, ctx?: LogContext, err?: unknown): void {
    emit('warn', msg, ctx, err)
  },
} as const
