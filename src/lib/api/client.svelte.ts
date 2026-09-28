import { browser } from '$app/environment'
import { profile } from '$lib/app/state/auth.svelte'
import { DEFAULT_INSTANCE_URL } from '$lib/app/state/instance.svelte'
import { instanceToURL } from '$lib/app/util/url'
import { CovesClient } from './coves'
import { proxyPath, requestToken, toProxyUrl } from './transport'

/**
 * Custom fetch for the Coves XRPC client.
 *
 * Unlike the legacy `customFetch`, this does NOT throw on non-ok responses. Instead it
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
    // A load's `fetch` (Kit's `event.fetch`) goes to the proxy too, which Kit
    // dispatches in-process with the visitor's cookie; the proxy injects the
    // credential and stamps the client address exactly as it does for the
    // browser. The point is the key Kit serializes the response under: it is
    // the proxy path the browser will ask for while hydrating, so hydration is
    // served from the page instead of fetching every SSR response a second
    // time. A direct upstream URL can never match, and the browser used to
    // repeat all of them.
    if (func && auth === undefined && !(input instanceof Request)) {
      return f(proxyPath(input.toString()), { ...init, headers })
    }

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
