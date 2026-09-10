import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DidNotFoundError,
  FailedHandleResolutionError,
} from '@atcute/identity-resolver'

/**
 * Mutable env, so a test can describe a different deployment (internal
 * backend, public-only) without a second test file. The objects are mutated in
 * place rather than reassigned: `$lib/server/instance` captures the reference
 * at import time.
 */
const mockPrivateEnv = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
}))
const mockPublicEnv = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
}))
vi.mock('$env/dynamic/private', () => mockPrivateEnv)
vi.mock('$env/dynamic/public', () => mockPublicEnv)

const HANDLE = 'jerry.coves.social'
const DID = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'
const INTERNAL = 'http://appview:8080'
const PUBLIC = 'https://coves.social'
/** TEST-NET-3 (RFC 5737), so a real address can never match by accident. */
const CLIENT_ADDRESS = '203.0.113.7'

const mockFetch = vi.fn<typeof fetch>()

/** The stand-in for a request event's `getClientAddress`. */
function clientAddress(address = CLIENT_ADDRESS): () => string {
  return () => address
}

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
  for (const key of Object.keys(mockPrivateEnv.env))
    delete mockPrivateEnv.env[key]
  for (const key of Object.keys(mockPublicEnv.env))
    delete mockPublicEnv.env[key]
})
afterEach(() => vi.unstubAllGlobals())

/** Imports the module under test against the env the test just described. */
async function loadResolver() {
  vi.resetModules()
  return (await import('./resolve-login-handle')).resolveLoginHandle
}

/** The AppView's answer for a handle it resolved. */
function xrpcHit(did: string): Response {
  return Response.json({ did })
}

/**
 * The AppView's answer for a handle that resolves to no account. The status is
 * the load-bearing part — atcute reads 400 as "no such handle" and any other
 * failure as an outage — but the body is the real one so this test still
 * describes the endpoint the backend actually serves.
 */
function xrpcMiss(): Response {
  return Response.json(
    { error: 'InvalidRequest', message: 'Unable to resolve handle' },
    { status: 400 },
  )
}

/**
 * Answers whatever the resolver asks for and makes any OTHER host a hard
 * failure. That trap is the point of most of this file: on main the resolver
 * was an `XrpcHandleResolver` hardcoded to `https://public.api.bsky.app`, which
 * cannot see a handle hosted on a local or self-hosted PDS and so broke login
 * against a local deployment. Login preflight now talks to this deployment's
 * own AppView, and must never fall back to a public resolver.
 */
function routeByHost(routes: Record<string, () => Response>) {
  mockFetch.mockImplementation(async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    const route = routes[url.hostname]
    if (!route) throw new TypeError(`unexpected fetch to ${url.href}`)
    return route()
  })
}

/** Every URL the resolver actually requested, in call order. */
function requestedUrls(): string[] {
  return mockFetch.mock.calls.map(([input]) =>
    String(input instanceof Request ? input.url : input),
  )
}

/**
 * The headers of every outbound request, in call order. Reads both call
 * shapes — `fetch(url, init)` and `fetch(request)` — so this asserts on what
 * went out rather than on how the caller chose to assemble it.
 */
function requestedHeaders(): Headers[] {
  return mockFetch.mock.calls.map(([input, options]) => {
    const headers = new Headers(
      input instanceof Request ? input.headers : undefined,
    )
    if (options?.headers)
      for (const [name, value] of new Headers(options.headers))
        headers.set(name, value)
    return headers
  })
}

function xrpcUrl(origin: string, handle: string): string {
  return `${origin}/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`
}

describe('resolveLoginHandle', () => {
  it('resolves through this deployment’s AppView and no other host', async () => {
    mockPublicEnv.env.PUBLIC_INTERNAL_INSTANCE = INTERNAL
    mockPublicEnv.env.PUBLIC_INSTANCE_URL = PUBLIC
    routeByHost({ appview: () => xrpcHit(DID) })
    const resolveLoginHandle = await loadResolver()

    await expect(
      resolveLoginHandle(HANDLE, clientAddress()),
    ).resolves.toBeUndefined()

    // Exactly one request, and to the AppView: preflight must never fall back
    // to a public resolver, which is blind to handles on a local or
    // self-hosted PDS. A handle submitted at the login form is also
    // attacker-chosen input, so the outbound host stays fixed regardless of it.
    expect(requestedUrls()).toEqual([xrpcUrl(INTERNAL, HANDLE)])
  })

  it('falls back to the public instance URL when no internal backend is set', async () => {
    mockPublicEnv.env.PUBLIC_INSTANCE_URL = PUBLIC
    routeByHost({ 'coves.social': () => xrpcHit(DID) })
    const resolveLoginHandle = await loadResolver()

    await expect(
      resolveLoginHandle(HANDLE, clientAddress()),
    ).resolves.toBeUndefined()

    expect(requestedUrls()).toEqual([xrpcUrl(PUBLIC, HANDLE)])
  })

  it('stamps the observed client address on the request to the AppView', async () => {
    mockPublicEnv.env.PUBLIC_INTERNAL_INSTANCE = INTERNAL
    routeByHost({ appview: () => xrpcHit(DID) })
    const resolveLoginHandle = await loadResolver()

    await resolveLoginHandle(HANDLE, clientAddress())

    // The AppView rate-limits per client IP off these headers. Unstamped, this
    // preflight arrives as the frontend container's own address, so every
    // visitor's login attempt shares one bucket and the limit locks the whole
    // deployment out of logging in.
    const [headers] = requestedHeaders()
    expect(headers.get('X-Forwarded-For')).toBe(CLIENT_ADDRESS)
    expect(headers.get('X-Real-IP')).toBe(CLIENT_ADDRESS)
  })

  it('still sends the request, unstamped, when the client address cannot be read', async () => {
    mockPublicEnv.env.PUBLIC_INTERNAL_INSTANCE = INTERNAL
    routeByHost({ appview: () => xrpcHit(DID) })
    const resolveLoginHandle = await loadResolver()
    // adapter-node throws here when ADDRESS_HEADER is configured but the
    // header is missing. That is a proxy misconfiguration, not a client fault,
    // so it degrades to "no address claim at all" — the same way
    // `stampClientAddress` degrades — rather than failing the login or
    // sending an address nobody observed. The log line it emits is not this
    // test's subject; silenced so it does not read as a test failure.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unavailable = () => {
      throw new Error('ADDRESS_HEADER is not present on the request')
    }

    try {
      await expect(
        resolveLoginHandle(HANDLE, unavailable),
      ).resolves.toBeUndefined()
    } finally {
      errorSpy.mockRestore()
    }

    expect(requestedUrls()).toEqual([xrpcUrl(INTERNAL, HANDLE)])
    const [headers] = requestedHeaders()
    expect(headers.has('X-Forwarded-For')).toBe(false)
    expect(headers.has('X-Real-IP')).toBe(false)
  })

  it('exposes a missing account as DidNotFoundError', async () => {
    mockPublicEnv.env.PUBLIC_INTERNAL_INSTANCE = INTERNAL
    routeByHost({ appview: () => xrpcMiss() })
    const resolveLoginHandle = await loadResolver()

    await expect(
      resolveLoginHandle(HANDLE, clientAddress()),
    ).rejects.toBeInstanceOf(DidNotFoundError)
  })

  it.each([500, 503])(
    'keeps a %i outage distinct from account not found',
    async (status) => {
      mockPublicEnv.env.PUBLIC_INTERNAL_INSTANCE = INTERNAL
      routeByHost({ appview: () => new Response('boom', { status }) })
      const resolveLoginHandle = await loadResolver()

      // The login form tells the user their handle does not exist on a
      // DidNotFoundError. An AppView that is down must not produce that
      // message, so an outage stays a resolution failure.
      await expect(
        resolveLoginHandle(HANDLE, clientAddress()),
      ).rejects.toBeInstanceOf(FailedHandleResolutionError)
    },
  )

  it('keeps an unreachable AppView distinct from account not found', async () => {
    mockPublicEnv.env.PUBLIC_INTERNAL_INSTANCE = INTERNAL
    // What the runtime throws when the connection itself fails: the AppView is
    // not listening, DNS does not resolve it, or the network is gone. There is
    // no response to read a status off, and the user must still not be told
    // their account does not exist.
    routeByHost({
      appview: () => {
        throw new TypeError('fetch failed')
      },
    })
    const resolveLoginHandle = await loadResolver()

    await expect(
      resolveLoginHandle(HANDLE, clientAddress()),
    ).rejects.toBeInstanceOf(FailedHandleResolutionError)
  })

  it('bounds every outbound request with an abort signal', async () => {
    mockPublicEnv.env.PUBLIC_INTERNAL_INSTANCE = INTERNAL
    routeByHost({ appview: () => xrpcHit(DID) })
    const resolveLoginHandle = await loadResolver()

    await resolveLoginHandle(HANDLE, clientAddress())

    expect(mockFetch.mock.calls.length).toBeGreaterThan(0)
    for (const [, options] of mockFetch.mock.calls) {
      expect(options?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('rejects invalid handles without sending a request', async () => {
    mockPublicEnv.env.PUBLIC_INTERNAL_INSTANCE = INTERNAL
    const resolveLoginHandle = await loadResolver()

    await expect(
      resolveLoginHandle('jerry@coves.social', clientAddress()),
    ).rejects.toThrow('invalid_handle')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
