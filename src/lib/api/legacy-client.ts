/**
 * The Lemmy/PieFed-shaped client inherited from Photon. It lives apart from
 * `client.svelte.ts` so that routes using only `coves()` do not pull
 * `lemmy-js-client` and both adapters into their bundles; only the few
 * screens still on the legacy API import this module.
 *
 * TODO(coves-migration): delete once the remaining callers move to Coves XRPC.
 */
import { browser } from '$app/environment'
import { profile } from '$lib/app/state/auth.svelte'
import { DEFAULT_INSTANCE_URL } from '$lib/app/state/instance.svelte'
import { instanceToURL } from '$lib/app/util/url'
import { error } from '@sveltejs/kit'
import { BaseClient, DEFAULT_CLIENT_TYPE, type ClientType } from './base'
import { requestToken, toProxyUrl } from './transport'
import { LemmyClient } from './lemmy/adapter'
import { PiefedClient } from './piefed/adapter'

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
