import type { RequestEvent } from '@sveltejs/kit'

/**
 * Indirection so universal modules can reach the current server request.
 *
 * Code under `$lib/app` runs in both the browser and the server bundle, so it
 * cannot import `$app/server` — SvelteKit's build guard rejects that import
 * from a universal module even when it is guarded at runtime. Instead
 * `src/hooks.server.ts` (a server-only file) installs an accessor wrapping
 * `getRequestEvent()`, and universal code reads it through
 * {@link currentRequestEvent}.
 *
 * The accessor is consulted on every read rather than cached, so it returns
 * the event of the request executing at that moment. Under adapter-node
 * `getRequestEvent()` is backed by AsyncLocalStorage, which makes that correct
 * across concurrent requests and across an `await`. On a runtime without
 * `async_hooks` Kit falls back to a synchronous store, where a read after an
 * `await` can observe a different request — so on those runtimes, read the
 * event before you await, not after. When no accessor is installed — in the
 * browser, or in tests — reads yield `undefined`.
 */
type RequestEventAccessor = () => RequestEvent | undefined

let accessor: RequestEventAccessor | undefined

/**
 * Install the accessor used to resolve the in-flight request event. Replaces
 * any previously installed accessor, since `hooks.server.ts` re-evaluates on
 * HMR.
 */
export const installRequestEventAccessor = (fn: RequestEventAccessor): void => {
  accessor = fn
}

/**
 * The request event currently being handled, or `undefined` if there is none.
 *
 * An accessor that throws is answered with `undefined` rather than a rethrow.
 * Every caller here is a log line or a diagnostic, so a context lookup that
 * threw would turn a logged failure into an unlogged crash — the absence of
 * context has to look like every other absence. `hooks.server.ts` guards its
 * own `getRequestEvent()` too; this is the backstop for any other installer.
 */
export const currentRequestEvent = (): RequestEvent | undefined => {
  try {
    return accessor?.()
  } catch {
    return undefined
  }
}
