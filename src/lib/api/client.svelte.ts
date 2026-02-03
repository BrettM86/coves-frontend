import { browser } from '$app/environment'
import { profile } from '$lib/app/auth.svelte'
import { DEFAULT_INSTANCE_URL } from '$lib/app/instance.svelte'
import { instanceToURL } from '$lib/app/util.svelte'
import { error } from '@sveltejs/kit'
import { BaseClient, DEFAULT_CLIENT_TYPE, type ClientType } from './base'
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
 * @param input - The original API URL (e.g., https://coves.social/api/v3/posts)
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
    return input instanceof Request
      ? new Request(proxyPath, input)
      : proxyPath
  } catch (err) {
    // URL parsing failure indicates a malformed URL - this should not happen
    // in normal operation and could indicate a security issue or bug
    console.error(
      '[client] Failed to parse URL for proxy routing - aborting request:',
      { url, error: err instanceof Error ? err.message : String(err) }
    )
    throw new Error(
      `Invalid URL for API request: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * Custom fetch function that handles:
 * - Client-side: Routes through /api/proxy for auth injection
 * - Server-side: Direct calls with auth header (when func is SvelteKit's fetch)
 * - User-Agent header addition
 * - Error handling
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

  // Initialize headers
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
    'User-Agent': `Photon/${__VERSION__}`,
  }

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

    const res = await f(proxyInput, proxyInit)
    if (!res.ok) error(res.status, await res.text())
    return res
  } else {
    // Server-side: Direct call with auth header (token from locals)
    if (auth) {
      headers['Authorization'] = `Bearer ${auth}`
    }

    const serverInit: RequestInit = {
      ...init,
      headers,
    }

    if (auth) {
      serverInit.cache = 'no-store'
    }

    const res = await f(input, serverInit)
    if (!res.ok) error(res.status, await res.text())
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
  // - Client-side: The proxy at /api/proxy injects auth from the session cookie
  // - Server-side: The caller MUST pass `auth` explicitly from locals.auth.authToken
  //
  // NOTE: profile.current?.jwt is now just the literal 'authenticated' marker (not a real token).
  // Server-side requests that need auth MUST pass the auth parameter explicitly.
  // We use nullish coalescing so that auth = '' can explicitly disable auth.
  const authToken = auth ?? (browser ? undefined : undefined)

  // TODO(coves-migration): Replace with CovesClient when implemented
  return new (clientType?.name == 'piefed' ? PiefedClient : LemmyClient)(
    instanceToURL(instanceURL),
    {
      // customFetch handles auth header injection for both client and server
      fetchFunction: (input, init) => customFetch(func, input, init, authToken),
      headers: {},
    },
  )
}

// here for parts where i forgor to switch
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

/**
 * Result of instance validation.
 * Either valid with no error, or invalid with an error message.
 */
export type ValidateInstanceResult =
  | { valid: true }
  | { valid: false; error: string }

export async function validateInstance(
  instance: string,
  type: ClientType,
): Promise<ValidateInstanceResult> {
  if (instance == '') {
    console.warn('[validateInstance] Validation failed: instance URL is empty')
    return { valid: false, error: 'Instance URL cannot be empty' }
  }

  try {
    await client({
      instanceURL: instance,
      clientType: type,
      auth: '',
    }).getSite()

    return { valid: true }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.warn(
      '[validateInstance] Validation failed for instance:',
      { instance, clientType: type?.name ?? 'default' },
      'Error:',
      errorMessage
    )
    return { valid: false, error: errorMessage }
  }
}
