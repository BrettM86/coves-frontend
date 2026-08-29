import { log } from '$lib/server/log'

/**
 * Latch for the client-address diagnostic below. The condition it reports is a
 * deployment fault that persists for the life of the process, so logging it per
 * request would emit one line per upstream call and bury the diagnostic in its
 * own noise. Shared across every call site on purpose: the fault is the same
 * whichever hop notices it first.
 */
let addressResolutionLogged = false

/**
 * Stamps the observed client address onto a set of upstream request headers as
 * `X-Forwarded-For` and `X-Real-IP`.
 *
 * This is the address the backend rate-limits and audit-logs on, so it must be
 * the observed connection, never a client claim — callers strip any inbound
 * `x-forwarded-for` / `x-real-ip` / `forwarded` before calling this, and this
 * function only ever SETS (replace semantics), never appends.
 *
 * Every server-to-backend hop must go through here. The `/api/me` session
 * check in `hooks.server.ts` runs once per authenticated page view; without a
 * stamp the backend keys its global limiter on this container's own address and
 * the whole site shares one bucket — past the limit every logged-in user is
 * silently rendered as a guest.
 *
 * The call is guarded: adapter-node throws from `getClientAddress()` when
 * `ADDRESS_HEADER` is configured but the header is absent from the request.
 * That is a deployment/proxy misconfiguration, not a client fault, and it must
 * degrade to "no address claim at all" rather than fail the request or let an
 * unverified address through. DEPLOYMENT NOTE: behind a reverse proxy,
 * `ADDRESS_HEADER` must be set (see docs/ENVIRONMENT.md) or every user appears
 * to the backend as the proxy's own address.
 *
 * @param headers - the upstream request headers, mutated in place
 * @param getClientAddress - the request event's `getClientAddress`
 * @param site - short label for the log line (`proxy`, `hooks`)
 */
export function stampClientAddress(
  headers: Headers,
  getClientAddress: () => string,
  site: string,
): void {
  try {
    const clientAddress = getClientAddress()
    headers.set('X-Forwarded-For', clientAddress)
    headers.set('X-Real-IP', clientAddress)
  } catch (error) {
    if (!addressResolutionLogged) {
      addressResolutionLogged = true
      log.error(
        `[${site}] could not determine the client address; upstream requests ` +
          'will carry no address stamp and the backend cannot rate limit per ' +
          'caller. Check ADDRESS_HEADER against what the reverse proxy sets ' +
          '(see docs/ENVIRONMENT.md)',
        undefined,
        error,
      )
    }
  }
}
