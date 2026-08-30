/**
 * Secret redaction for log lines.
 *
 * Universal: this module reads no environment and no request context, so it is
 * safe in the browser bundle as well as on the server. It is the single place
 * that knows what a credential looks like in text.
 *
 * The SERVER emitter cleans every string through `scrub` before the line
 * reaches stderr, which is where a leaked secret would be archived. The
 * browser path is deliberately raw — see `./index.ts` for why.
 */

/** Token substituted for every secret value. Keys and separators are preserved. */
export const REDACTED = '[REDACTED]'

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
  // URL userinfo — `scheme://user:pass@host`. This credential names itself
  // nowhere: the `://…@` shape is the only thing announcing it, so no key rule
  // can catch it. The whole userinfo segment goes, since a bare `user@` is a
  // credential too; the host and path survive because they are the diagnostic.
  // `[^/?#\s@]+` cannot cross into the path, so an `@` in a query string (or
  // in `/c/name@instance`) is left alone. Idempotent: re-running matches the
  // substituted `[REDACTED]@` and rewrites it to itself.
  {
    pattern: /([a-z][a-z0-9+.-]*:\/\/)[^/?#\s@]+@/gi,
    replacement: `$1${REDACTED}@`,
  },
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
 * Whether a NAME is one whose value is always a credential — the same
 * vocabulary the text rules use, anchored so it matches the name entire.
 *
 * A structured field is the case `scrub` cannot see: `{ authToken: 'abc' }`
 * carries no `key=value` text for a pattern to key off, so the name has to be
 * what condemns the value. `keyBoundary` supplies the asymmetric boundary, so
 * `DB_PASSWORD` and `authToken` match while `secretary` does not.
 */
const SECRET_KEY_NAME = new RegExp(
  `^${keyBoundary([...SECRET_KEYS, 'authorization'])}$`,
  'i',
)

export function isSecretKey(name: string): boolean {
  return SECRET_KEY_NAME.test(name)
}

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
