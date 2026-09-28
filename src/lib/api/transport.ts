/**
 * Request routing shared by the Coves client (`client.svelte.ts`) and the
 * legacy Lemmy/PieFed one (`legacy-client.ts`).
 */
import { browser } from '$app/environment'
import { instanceToURL } from '$lib/app/util/url'
import { log } from '$lib/app/util/log'
import { currentRequestEvent } from '$lib/app/util/request-event'

/**
 * The same-origin proxy path for an upstream API URL: its path and query under
 * `/api/proxy`. The browser always goes through it, and so do server loads
 * (see `covesCustomFetch`), so both sides request the same key.
 *
 * @param url - The original API URL (e.g., https://coves.social/xrpc/social.coves.feed.getPosts)
 */
export function proxyPath(url: string): string {
  try {
    const parsed = new URL(url)
    return `/api/proxy${parsed.pathname}${parsed.search}`
  } catch (err) {
    // URL parsing failure indicates a malformed URL - this should not happen
    // in normal operation and could indicate a security issue or bug
    log.error(
      '[client] Failed to parse URL for proxy routing - aborting request',
      err,
      { url },
    )
    throw new Error(
      `Invalid URL for API request: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Converts an API URL to use the proxy path for client-side requests.
 * Server-side requests are returned unchanged.
 *
 * @returns The proxied URL for client-side, or original URL for server-side
 */
export function toProxyUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!browser) return input

  const url = input instanceof Request ? input.url : input.toString()
  const path = proxyPath(url)
  return input instanceof Request ? new Request(path, input) : path
}

/**
 * The session token of the request being rendered, if it may be sent to
 * `input`.
 *
 * Server-side calls made without a load's `fetch` go to the upstream directly,
 * with no proxy to inject auth, so they have to carry the token from the
 * request that is executing. (A load's own requests go through the proxy; see
 * `covesCustomFetch`.) That token is a session credential for our own upstream
 * only, so it is released solely when the target's origin equals the
 * account's instance origin (fail closed): a call aimed at a remote instance,
 * an image host, or anywhere a route param could name goes out
 * unauthenticated rather than handing a session credential to a third party.
 */
export function requestToken(input: RequestInfo | URL): string | undefined {
  const auth = currentRequestEvent()?.locals.auth
  // An anonymous render, or no request at all, is the ordinary case and not a
  // fault. Reporting it would bury the two diagnostics below under one line
  // per page view.
  if (!auth?.authenticated) return undefined

  const target = input instanceof Request ? input.url : String(input)
  const instance = auth.account.instance

  let targetOrigin: string
  let upstreamOrigin: string
  try {
    targetOrigin = new URL(target).origin
    upstreamOrigin = new URL(instanceToURL(instance)).origin
  } catch (err) {
    // A config or programming fault rather than a runtime condition: an
    // account whose instance cannot be parsed can never authenticate
    // anything, and degrading to anonymous renders in silence is how that
    // survives a release unnoticed.
    log.error(
      '[client] requestToken: unparseable instance or target, withholding session token',
      err,
      { instance, target },
    )
    return undefined
  }

  if (targetOrigin !== upstreamOrigin) {
    // Only a warning: fetching a remote instance or an image host is
    // legitimate and the token is correctly withheld. Worth seeing anyway,
    // because it is also what a mis-set PUBLIC_INTERNAL_INSTANCE looks like.
    log.warn(
      '[client] requestToken: origin mismatch, withholding session token',
      undefined,
      { target: targetOrigin, upstream: upstreamOrigin },
    )
    return undefined
  }

  return auth.authToken
}
