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
 * `LOG_STACKS=0` to drop them (see `docs/ENVIRONMENT.md`, and
 * `.env.prod.example` for the value in context).
 *
 * The line is built by the isomorphic emitter in `$lib/app/util/log`, which
 * reads no environment; this module is the server face of it. It keeps the
 * `(msg, ctx?, err?)` signature server callers already use — where the caller
 * holds the request context in hand — and re-exports `scrub` and `LogContext`
 * so those imports keep working. It is the ONLY place that reads `LOG_STACKS`,
 * which it hands to the emitter as policy at module load; loading it is what
 * makes that setting govern universal callers too.
 */
import { env } from '$env/dynamic/private'
import { emit, installServerLogPolicy } from '$lib/app/util/log'
import type { LogContext } from '$lib/app/util/log'

export { scrub } from '$lib/app/util/log/scrub'
export type { LogContext } from '$lib/app/util/log'

// Read per line rather than captured once: `env` is resolved at runtime, so a
// value set after this module loads still takes effect.
installServerLogPolicy({ includeStack: () => env.LOG_STACKS !== '0' })

export const log = {
  error(msg: string, ctx?: LogContext, err?: unknown): void {
    emit('error', msg, { ctx, err })
  },
  warn(msg: string, ctx?: LogContext, err?: unknown): void {
    emit('warn', msg, { ctx, err })
  },
} as const
