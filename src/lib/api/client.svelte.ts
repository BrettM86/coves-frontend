import { browser } from '$app/environment'
import { profile } from '$lib/app/state/auth.svelte'
import { DEFAULT_INSTANCE_URL } from '$lib/app/state/instance.svelte'
import { instanceToURL } from '$lib/app/util/url'
import { log } from '$lib/app/util/log'
import { currentRequestEvent } from '$lib/app/util/request-event'
import { error } from '@sveltejs/kit'
import { BaseClient, DEFAULT_CLIENT_TYPE, type ClientType } from './base'
import { CovesClient } from './coves'
import { LemmyClient } from './lemmy/adapter'
import { PiefedClient } from './piefed/adapter'
import type { GetSiteResponse } from './types'

class SiteData {
  #data = $state<GetSiteResponse>()

  get data() {
    return this.#data
  }

  set data(value) {
    this.#data = value
  }
}

export const site = new SiteData()

/**
 * Converts an API URL to use the proxy path for client-side requests.
 * Server-side requests continue to use direct URLs.
 *
 * @param input - The original API URL (e.g., https://coves.social/xrpc/social.coves.feed.getPosts)
 * @returns The proxied URL for client-side, or original URL for server-side
 */
function toProxyUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!browser) return input

  const url = input instanceof Request ? input.url : input.toString()

  // Extract the path from the URL (everything after the host)
  try {
    const parsed = new URL(url)
    // Convert to proxy path: /api/proxy/{path}
    const proxyPath = `/api/proxy${parsed.pathname}${parsed.search}`
    return input instanceof Request ? new Request(proxyPath, input) : proxyPath
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
 * The session token of the request being rendered, if it may be sent to
 * `input`.
 *
 * On the server there is no proxy to inject auth, so a render's upstream calls
 * have to carry the token from the request that is executing. That token is a
 * session credential for our own upstream only, so it is released solely when
 * the target's origin equals the account's instance origin (fail closed): a call aimed at a remote instance, an image host,
 * or anywhere a route param could name goes out unauthenticated rather than
 * handing a session credential to a third party.
 */
function requestToken(input: RequestInfo | URL): string | undefined {
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

/**
 * Custom fetch function that handles:
 * - Client-side: Routes through /api/proxy for auth injection
 * - Server-side: direct call; Authorization is set from an explicit `auth`,
 *   else from the in-flight request's session token when the target origin is
 *   the account's own instance (see `requestToken`)
 * - User-Agent header addition
 *
 * @throws Calls SvelteKit's `error()` with the status code and response body on non-ok responses.
 */
async function customFetch(
  func:
    | ((
        input: RequestInfo | URL,
        init?: RequestInit | undefined,
      ) => Promise<Response>)
    | undefined,
  input: RequestInfo | URL,
  init?: RequestInit | undefined,
  auth?: string,
): Promise<Response> {
  const f = func ?? fetch

  const headers = new Headers(init?.headers)
  headers.set('User-Agent', `Coves/${__VERSION__}`)

  if (browser) {
    // Client-side: Route through proxy, which injects auth from session cookie
    const proxyInput = toProxyUrl(input)
    const proxyInit: RequestInit = {
      ...init,
      headers,
      credentials: 'include', // Send cookies for session
    }

    // Don't cache authenticated requests
    if (profile.isAuthenticated) {
      proxyInit.cache = 'no-store'
    }

    const generation = profile.sessionGeneration
    const authenticated = profile.isAuthenticated
    const res = await f(proxyInput, proxyInit)
    if (authenticated && res.status === 401) profile.expireSession(generation)
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText)
      error(res.status, body)
    }
    return res
  } else {
    // Server-side: direct call, so the auth header is ours to set. An
    // explicitly passed token wins; otherwise it comes from the in-flight
    // request.
    const token = auth ?? requestToken(input)
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    const serverInit: RequestInit = {
      ...init,
      headers,
    }

    // An authenticated response is per-user and must never be cached.
    if (token) {
      serverInit.cache = 'no-store'
    }

    const res = await f(input, serverInit)
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText)
      error(res.status, body)
    }
    return res
  }
}

export function client({
  instanceURL,
  func,
  auth,
  clientType,
}: {
  instanceURL?: string
  func?: (
    input: RequestInfo | URL,
    init?: RequestInit | undefined,
  ) => Promise<Response>
  auth?: string
  clientType?: ClientType
} = {}): BaseClient {
  if (!instanceURL)
    instanceURL = profile.current.instance || DEFAULT_INSTANCE_URL

  if (!clientType) {
    // TODO(coves-migration): Replace with Coves client when ready
    clientType = DEFAULT_CLIENT_TYPE
  }

  // Auth handling:
  // - Client-side: the proxy at /api/proxy injects auth from the session cookie
  // - Server-side: an explicit `auth` wins; otherwise `customFetch` falls back
  //   to the in-flight request's token, and only for our own upstream origin
  //
  // NOTE: profile.current?.jwt is just the literal 'authenticated' marker, not
  // a real token, and is never used as one.
  const authToken = auth

  // TODO(coves-migration): Use CovesClient (see `coves()`) once Lemmy/PieFed adapters are removed
  return new (clientType?.name == 'piefed' ? PiefedClient : LemmyClient)(
    instanceToURL(instanceURL),
    {
      fetchFunction: (input, init) => customFetch(func, input, init, authToken),
      headers: {},
    },
  )
}

/**
 * Custom fetch for the Coves XRPC client.
 *
 * Unlike `customFetch`, this does NOT throw on non-ok responses. Instead it
 * returns the raw Response so that XrpcClient can parse structured XRPC error
 * bodies and throw typed `XrpcError` instances.
 */
async function covesCustomFetch(
  func:
    | ((
        input: RequestInfo | URL,
        init?: RequestInit | undefined,
      ) => Promise<Response>)
    | undefined,
  input: RequestInfo | URL,
  init?: RequestInit | undefined,
  auth?: string,
): Promise<Response> {
  const f = func ?? fetch

  const headers = new Headers(init?.headers)
  headers.set('User-Agent', `Coves/${__VERSION__}`)

  if (browser) {
    const proxyInput = toProxyUrl(input)
    const proxyInit: RequestInit = {
      ...init,
      headers,
      credentials: 'include',
    }

    if (profile.isAuthenticated) {
      proxyInit.cache = 'no-store'
    }

    const generation = profile.sessionGeneration
    const authenticated = profile.isAuthenticated
    const response = await f(proxyInput, proxyInit)
    if (authenticated && response.status === 401)
      profile.expireSession(generation)
    return response
  } else {
    const token = auth ?? requestToken(input)
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    const serverInit: RequestInit = {
      ...init,
      headers,
    }

    // An authenticated response is per-user and must never be cached.
    if (token) {
      serverInit.cache = 'no-store'
    }

    return f(input, serverInit)
  }
}

export function coves({
  instanceURL,
  func,
  auth,
}: {
  instanceURL?: string
  func?: typeof fetch
  auth?: string
} = {}): CovesClient {
  if (!instanceURL)
    instanceURL = profile.current.instance || DEFAULT_INSTANCE_URL

  const baseUrl = instanceToURL(instanceURL)

  return new CovesClient({
    baseUrl,
    fetchFn: (input, init) => covesCustomFetch(func, input, init, auth),
  })
}

/** @deprecated Use {@link client} instead. */
export function getClient(
  instanceURL?: string,
  func?: (
    input: RequestInfo | URL,
    init?: RequestInit | undefined,
  ) => Promise<Response>,
  auth?: string,
) {
  return client({ instanceURL, func, auth })
}
