import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Cookies } from '@sveltejs/kit'
import {
  createMockCookies,
  createMockEvent,
} from '$lib/test-utils/request-event'

vi.mock('$env/dynamic/private', () => ({ env: {} }))
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_INSTANCE_URL: 'https://coves.social' },
}))

const { GET, POST } = await import('./[...path]/+server')

/**
 * The proxy's header trust boundary, exercised through the real exported
 * handlers.
 *
 * The client is untrusted, so nothing it sends may reach the backend unless it
 * is on the request allowlist: a forged `x-forwarded-for` must not become the
 * address the backend rate-limits on, a forged `authorization` must not survive
 * alongside (or instead of) the sealed session token, and the session cookie
 * must not leak upstream. In the other direction the backend's
 * connection-framing and credential headers are ours to terminate, not to relay
 * to the browser.
 */

/** The address the proxy observes on the connection, and the only one it may claim. */
const CLIENT_ADDRESS = '203.0.113.9'
/** TEST-NET-2, used wherever a client forges an address it is not entitled to. */
const FORGED_ADDRESS = '198.51.100.1'

/** Exactly what the upstream request is allowed to carry — nothing more. */
const EXPECTED_UPSTREAM_HEADERS = {
  accept: 'application/json',
  authorization: 'Bearer sealed-tok',
  'content-type': 'application/json',
  'x-forwarded-for': CLIENT_ADDRESS,
  'x-forwarded-host': 'coves.social',
  'x-forwarded-proto': 'https',
  'x-real-ip': CLIENT_ADDRESS,
} as const

function createUpstreamResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': 'x=1',
      'transfer-encoding': 'chunked',
      'www-authenticate': 'Bearer',
      'x-ratelimit-remaining': '5',
      etag: '"abc"',
    },
  })
}

interface ProxyEventOptions {
  /** Defaults to POST when `body` is set, GET otherwise (see createMockEvent). */
  method?: string
  headers: Record<string, string>
  body?: unknown
  /** Defaults to no session cookie. */
  cookies?: Cookies
  /** Proxy path segment; defaults to the vote endpoint. */
  path?: string
  /** Defaults to `https://coves.social/api/proxy/${path}`. */
  url?: string
  /** Defaults to returning CLIENT_ADDRESS. */
  getClientAddress?: () => string
  /** Defaults to createUpstreamResponse(). */
  upstream?: Response
}

/**
 * Builds a proxy event whose upstream hop is a stubbed `globalThis.fetch`.
 *
 * The event's own `fetch` is present but throws. Kit's per-request fetch
 * re-attaches the inbound cookie and authorization headers when the upstream
 * shares a host with the app, which would silently undo the allowlist, so the
 * handler must never reach for it — and a throwing stub makes any regression
 * fail loudly here instead of leaking credentials in production.
 */
function createEvent(options: ProxyEventOptions) {
  const path = options.path ?? 'xrpc/social.coves.feed.vote'
  const event = createMockEvent({
    method: options.method,
    url: options.url ?? `https://coves.social/api/proxy/${path}`,
    params: { path },
    body: options.body,
    headers: options.headers,
    cookies: options.cookies,
  })
  const upstreamFetch = vi
    .fn()
    .mockResolvedValue(options.upstream ?? createUpstreamResponse())
  vi.stubGlobal('fetch', upstreamFetch)
  Object.assign(event, {
    fetch: vi.fn(() => {
      throw new Error('event.fetch must not be used for the upstream hop')
    }),
    getClientAddress: options.getClientAddress ?? (() => CLIENT_ADDRESS),
  })
  return { event, upstreamFetch }
}

type ProxyEvent = Parameters<typeof GET>[0]

function upstreamHeadersFrom(upstreamFetch: ReturnType<typeof vi.fn>): Headers {
  expect(upstreamFetch).toHaveBeenCalledTimes(1)
  const init = upstreamFetch.mock.calls[0][1] as RequestInit
  return new Headers(init.headers)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('proxy header hygiene (acceptance)', () => {
  it('forwards only allowlisted client headers upstream and only safe headers back', async () => {
    const { event, upstreamFetch } = createEvent({
      method: 'POST',
      body: { a: 1 },
      cookies: createMockCookies({ coves_session: 'sealed-tok' }),
      headers: {
        // Required for the CSRF check on a state-changing method.
        origin: 'https://coves.social',
        cookie: 'coves_session=abc',
        'x-forwarded-for': FORGED_ADDRESS,
        'x-real-ip': FORGED_ADDRESS,
        forwarded: `for=${FORGED_ADDRESS}`,
        'x-custom-header': 'evil',
        authorization: 'Bearer client-forged',
        accept: 'application/json',
        // No explicit content-type: createMockEvent already sets one for the
        // JSON body, and sending both appends a second value.
      },
    })

    const response = await POST(event as unknown as ProxyEvent)

    // Request side: client-controlled headers are dropped, then the proxy
    // stamps the ones the backend is entitled to trust.
    const headers = upstreamHeadersFrom(upstreamFetch)
    expect(Array.from(headers.keys()).sort()).toEqual(
      Object.keys(EXPECTED_UPSTREAM_HEADERS).sort(),
    )
    for (const [name, value] of Object.entries(EXPECTED_UPSTREAM_HEADERS)) {
      expect(headers.get(name)).toBe(value)
    }

    // Response side: pass through the payload and metadata headers, terminate
    // the connection-framing and credential ones.
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('x-ratelimit-remaining')).toBe('5')

    // This response was assembled from a session token, so it is not a shared
    // artefact — see the caching suite below.
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('etag')).toBeNull()

    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('transfer-encoding')).toBeNull()
    expect(response.headers.get('www-authenticate')).toBeNull()
  })
})

describe('upstream transport', () => {
  it('makes the upstream hop with the platform fetch, never the event fetch', async () => {
    // Kit's `event.fetch` is not a neutral transport: for a same-host or
    // subdomain upstream it replays the inbound request's cookie and
    // authorization headers and adds an `origin`, reintroducing exactly the
    // credentials the allowlist just stripped. The upstream hop must therefore
    // go through the platform fetch.
    const { event, upstreamFetch } = createEvent({
      method: 'GET',
      path: 'xrpc/x',
      cookies: createMockCookies({ coves_session: 'sealed-tok' }),
      headers: { accept: 'application/json', cookie: 'coves_session=abc' },
    })

    const response = await GET(event as unknown as ProxyEvent)

    expect(response.status).toBe(200)
    expect(upstreamFetch).toHaveBeenCalledTimes(1)
    expect(upstreamFetch.mock.calls[0][0]).toBe('https://coves.social/xrpc/x')

    const headers = upstreamHeadersFrom(upstreamFetch)
    expect(Array.from(headers.keys()).sort()).toEqual([
      'accept',
      'authorization',
      'x-forwarded-for',
      'x-forwarded-host',
      'x-forwarded-proto',
      'x-real-ip',
    ])
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('authorization')).toBe('Bearer sealed-tok')
    expect(headers.get('x-forwarded-for')).toBe(CLIENT_ADDRESS)
    expect(headers.get('x-real-ip')).toBe(CLIENT_ADDRESS)
    expect(headers.get('x-forwarded-proto')).toBe('https')
    expect(headers.get('x-forwarded-host')).toBe('coves.social')
  })
})

describe('request header allowlist', () => {
  it('forwards the allowlisted content-negotiation headers and drops everything else', async () => {
    const { event, upstreamFetch } = createEvent({
      method: 'GET',
      headers: {
        accept: 'application/json',
        'accept-language': 'en',
        'content-type': 'application/json',
        'if-none-match': '"x"',
        'user-agent': 'UA/1',
        cookie: 'coves_session=abc',
        'x-custom-header': 'evil',
        // fetch negotiates and decodes its own encoding; forwarding the
        // client's would describe a body we no longer hand back verbatim.
        'accept-encoding': 'br',
      },
    })

    await GET(event as unknown as ProxyEvent)

    const headers = upstreamHeadersFrom(upstreamFetch)

    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('accept-language')).toBe('en')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('if-none-match')).toBe('"x"')
    expect(headers.get('user-agent')).toBe('UA/1')

    expect(headers.has('cookie')).toBe(false)
    expect(headers.has('x-custom-header')).toBe(false)
    expect(headers.has('accept-encoding')).toBe(false)
  })

  it('does not copy a raw Cookie header when the selected session cookie is absent', async () => {
    // Only the cookie API selects the session credential. The request header
    // is never forwarded or parsed as a fallback credential channel.
    const { event, upstreamFetch } = createEvent({
      method: 'GET',
      headers: { cookie: 'coves_session=abc' },
    })

    await GET(event as unknown as ProxyEvent)

    const headers = upstreamHeadersFrom(upstreamFetch)

    expect(headers.has('cookie')).toBe(false)
    expect(headers.has('authorization')).toBe(false)
  })
})

describe('trusted forwarding metadata', () => {
  it('overwrites client-supplied forwarding headers with the observed connection', async () => {
    const { event, upstreamFetch } = createEvent({
      method: 'GET',
      path: 'xrpc/x',
      url: 'https://coves.social:8443/api/proxy/xrpc/x',
      headers: {
        // Every one of these is attacker-controlled: if any survives, the
        // backend attributes the request to an address, scheme or host the
        // client chose, defeating rate limiting and audit logging.
        'x-forwarded-for': FORGED_ADDRESS,
        'x-real-ip': FORGED_ADDRESS,
        forwarded: `for=${FORGED_ADDRESS}`,
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'evil.example',
      },
    })

    await GET(event as unknown as ProxyEvent)

    const headers = upstreamHeadersFrom(upstreamFetch)

    expect(headers.get('x-forwarded-for')).toBe(CLIENT_ADDRESS)
    expect(headers.get('x-real-ip')).toBe(CLIENT_ADDRESS)
    // `url.protocol` carries a trailing colon; the header value must not.
    expect(headers.get('x-forwarded-proto')).toBe('https')
    // Host, not hostname: a non-default port is part of the origin.
    expect(headers.get('x-forwarded-host')).toBe('coves.social:8443')
    // RFC 7239's `Forwarded` has no trusted value to replace it with, so it
    // is dropped rather than rewritten.
    expect(headers.has('forwarded')).toBe(false)
  })

  it('still proxies when the client address is unavailable, omitting both address stamps', async () => {
    // adapter-node throws from getClientAddress when ADDRESS_HEADER is
    // configured but the header is absent from the request. That is a
    // deployment/proxy misconfiguration, not a client fault: the correct
    // response is to proxy without an address claim, never a 502.
    const { event, upstreamFetch } = createEvent({
      method: 'GET',
      path: 'xrpc/x',
      headers: {
        // The client offers an address of its own. Falling back to it when the
        // trusted source is unavailable would hand an attacker exactly the
        // spoof the stamps exist to prevent, so "no claim" is the only safe
        // answer — never "the claim the client made".
        'x-forwarded-for': FORGED_ADDRESS,
        'x-real-ip': FORGED_ADDRESS,
        forwarded: `for=${FORGED_ADDRESS}`,
      },
      getClientAddress: () => {
        throw new Error('no address header')
      },
    })

    const response = await GET(event as unknown as ProxyEvent)

    expect(response.status).toBe(200)

    const headers = upstreamHeadersFrom(upstreamFetch)

    expect(headers.has('x-forwarded-for')).toBe(false)
    expect(headers.has('x-real-ip')).toBe(false)
    expect(headers.has('forwarded')).toBe(false)
    // The connection metadata that does not depend on the address is still
    // known, so it is still stamped.
    expect(headers.get('x-forwarded-proto')).toBe('https')
    expect(headers.get('x-forwarded-host')).toBe('coves.social')
  })
})

describe('client address failure is logged once', () => {
  const ADDRESS_ERROR =
    'Address header was specified with ADDRESS_HEADER=x-real-ip but is absent from request'

  it('logs the misconfiguration once per process, not once per request', async () => {
    // A missing ADDRESS_HEADER is a deployment fault that persists for the
    // life of the process, so logging it per request would emit one line per
    // proxied call — enough noise to bury the diagnostic it is meant to be.
    // The operator needs to see it, and to be told where the fix is documented.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.resetModules()
    const { GET: freshGET } = await import('./[...path]/+server')

    const throwing = () => {
      throw new Error(ADDRESS_ERROR)
    }

    const first = createEvent({
      method: 'GET',
      path: 'xrpc/x',
      headers: {},
      getClientAddress: throwing,
    })
    const firstResponse = await freshGET(first.event as unknown as ProxyEvent)

    const second = createEvent({
      method: 'GET',
      path: 'xrpc/x',
      headers: {},
      getClientAddress: throwing,
    })
    const secondResponse = await freshGET(second.event as unknown as ProxyEvent)

    const addressWarnings = consoleError.mock.calls
      .map((call) => call.map((arg) => String(arg)).join(' '))
      .filter((line) => line.includes('ADDRESS_HEADER'))

    expect(addressWarnings).toHaveLength(1)
    expect(addressWarnings[0]).toContain('docs/ENVIRONMENT.md')
    expect(addressWarnings[0]).toContain(ADDRESS_ERROR)

    // The misconfiguration is logged, not surfaced to the caller.
    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
  })
})

/**
 * The client can never influence what the backend sees as the caller's
 * identity. The unauthenticated case would silently regress if `authorization`
 * were ever added to the request allowlist to "pass a token through".
 */
describe('authorization', () => {
  it.each([
    { name: 'carriage return', token: 'private-session-sentinel\rinjected' },
    { name: 'line feed', token: 'private-session-sentinel\ninjected' },
    { name: 'NUL', token: 'private-session-sentinel\u0000injected' },
    {
      name: 'non-byte Unicode',
      token: 'private-session-sentinel\u0100injected',
    },
  ])(
    'rejects a session cookie containing $name before contacting upstream',
    async ({ token }) => {
      const cookies = createMockCookies({ coves_session: token })
      // Supply the decoded value through Kit's cookie API. Putting it in a
      // Request header would fail during fixture construction instead.
      const { event, upstreamFetch } = createEvent({
        method: 'GET',
        cookies,
        headers: {},
      })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await Promise.resolve(
        GET(event as unknown as ProxyEvent),
      ).catch((error: unknown) => error)

      // A malformed client credential must produce an ordinary 400 response,
      // not let the platform's Headers exception escape the public handler.
      expect(result instanceof Response).toBe(true)
      if (!(result instanceof Response)) return
      expect(result.status).toBe(400)
      expect(result.headers.get('cache-control')).toBe('private, no-store')
      expect(result.headers.get('content-type')).toContain('application/json')
      expect(result.headers.has('etag')).toBe(false)
      expect(result.headers.getSetCookie()).toEqual([])
      const body: unknown = await result.json()
      expect(body).toEqual({
        error: expect.stringMatching(/\S/),
        message: expect.stringMatching(/\S/),
      })
      expect(JSON.stringify(body)).not.toContain('private-session-sentinel')
      expect(upstreamFetch).not.toHaveBeenCalled()
      expect(event.fetch).not.toHaveBeenCalled()
      expect(cookies.get('coves_session')).toBe(token)
      expect(cookies.set).not.toHaveBeenCalled()
      expect(cookies.delete).not.toHaveBeenCalled()
      // Invalid input needs no diagnostic; in particular never log the native
      // Headers exception, whose message can include the supplied credential.
      expect(warnSpy).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
    },
  )

  it('replaces a client-supplied authorization with the sealed session token', async () => {
    const { event, upstreamFetch } = createEvent({
      method: 'GET',
      cookies: createMockCookies({ coves_session: 'sealed-tok' }),
      headers: { authorization: 'Bearer client-forged' },
    })

    await GET(event as unknown as ProxyEvent)

    expect(upstreamHeadersFrom(upstreamFetch).get('authorization')).toBe(
      'Bearer sealed-tok',
    )
  })

  it('sends no authorization at all when the request is unauthenticated', async () => {
    const { event, upstreamFetch } = createEvent({
      method: 'GET',
      headers: { authorization: 'Bearer client-forged' },
    })

    await GET(event as unknown as ProxyEvent)

    expect(upstreamHeadersFrom(upstreamFetch).has('authorization')).toBe(false)
  })
})

/** Headers the proxy must terminate rather than relay to the browser. */
const DENIED_RESPONSE_HEADERS = {
  'transfer-encoding': 'chunked',
  'keep-alive': 'timeout=5',
  upgrade: 'h2c',
  te: 'trailers',
  trailer: 'x-t',
  'proxy-authenticate': 'Basic',
  'www-authenticate': 'Bearer',
  'clear-site-data': '"*"',
} as const

/** Headers that describe the payload and must survive the trip. */
const PASSED_RESPONSE_HEADERS = {
  'content-type': 'application/json',
  etag: '"abc"',
  'cache-control': 'no-store',
  'x-ratelimit-remaining': '5',
} as const

describe('response header denylist', () => {
  it('strips hop-by-hop, credential and cookie headers while passing payload metadata through', async () => {
    // The upstream is the frontend's own backend, but the browser connection
    // is a different hop: framing headers describe a connection we terminated,
    // and credential/cookie headers would let the backend set state on an
    // origin it does not own.
    const upstream = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        ...DENIED_RESPONSE_HEADERS,
        ...PASSED_RESPONSE_HEADERS,
        // `Connection` both is hop-by-hop itself and nominates further headers
        // as hop-by-hop; a nominated header is no more forwardable than a
        // hardcoded one, so the list has to be read rather than assumed.
        connection: 'X-Hop, Keep-Alive',
        'x-hop': '1',
        // Non-standard but widely emitted by proxies, and it nominates in
        // exactly the same way. Stripping the header while forwarding what it
        // names would leak the hop state it exists to describe.
        'proxy-connection': 'X-Hop2, keep-alive',
        'x-hop2': '1',
      },
    })
    // Two cookies, so a strip that only removes the first still fails.
    upstream.headers.append('set-cookie', 'a=1')
    upstream.headers.append('set-cookie', 'b=2')

    const { event, upstreamFetch } = createEvent({
      method: 'GET',
      headers: {},
      upstream,
    })

    const response = await GET(event as unknown as ProxyEvent)

    expect(upstreamFetch).toHaveBeenCalledTimes(1)

    // Collected rather than asserted one-by-one so a failure names every
    // header that leaked, not just the first.
    const leaked = [
      ...Object.keys(DENIED_RESPONSE_HEADERS),
      'connection',
      'x-hop',
      'proxy-connection',
      'x-hop2',
    ].filter((name) => response.headers.has(name))
    expect(leaked).toEqual([])
    expect(response.headers.getSetCookie()).toEqual([])

    for (const [name, value] of Object.entries(PASSED_RESPONSE_HEADERS)) {
      expect(response.headers.get(name)).toBe(value)
    }
  })
})

describe('upstream redirects', () => {
  // A redirect from the backend is data about where the client should go, not
  // an instruction to the proxy. Following it server-side would make the proxy
  // fetch an attacker-chosen URL while still holding the session's
  // Authorization header — an SSRF with credentials attached — so the hop is
  // made in manual mode and the 3xx is relayed for the browser to judge.
  it('relays a 302 instead of following it', async () => {
    const { event, upstreamFetch } = createEvent({
      method: 'GET',
      path: 'xrpc/x',
      cookies: createMockCookies({ coves_session: 'sealed-tok' }),
      headers: {},
      upstream: new Response(null, {
        status: 302,
        headers: { location: 'https://evil.example/steal' },
      }),
    })

    const response = await GET(event as unknown as ProxyEvent)

    // One hop only: nothing was fetched from evil.example.
    expect(upstreamFetch).toHaveBeenCalledTimes(1)
    const init = upstreamFetch.mock.calls[0][1] as RequestInit
    expect(init.redirect).toBe('manual')

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://evil.example/steal')
  })

  it('relays a 307 without replaying the request body to the redirect target', async () => {
    // 307 preserves the method and body, so a followed redirect would repost
    // the client's payload to whatever host the upstream named.
    const { event, upstreamFetch } = createEvent({
      method: 'POST',
      path: 'xrpc/x',
      body: { a: 1 },
      cookies: createMockCookies({ coves_session: 'sealed-tok' }),
      headers: { origin: 'https://coves.social' },
      upstream: new Response(null, {
        status: 307,
        headers: { location: 'https://evil.example/steal' },
      }),
    })

    const response = await POST(event as unknown as ProxyEvent)

    expect(upstreamFetch).toHaveBeenCalledTimes(1)
    const init = upstreamFetch.mock.calls[0][1] as RequestInit
    expect(init.redirect).toBe('manual')

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://evil.example/steal')
  })
})

/**
 * Headers that describe the ORIGIN's own policy. The backend's origin is not
 * the browser-facing one, so relaying these lets the backend dictate transport
 * security, CORS and telemetry for an origin it does not own — HSTS on the
 * app's domain, or an `access-control-allow-origin: *` paired with
 * credentials, are both something we would be asserting on its behalf.
 */
const ORIGIN_POLICY_RESPONSE_HEADERS = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'alt-svc': 'h3=":443"; ma=86400',
  'access-control-allow-origin': '*',
  'access-control-allow-credentials': 'true',
  nel: '{"report_to":"default","max_age":2592000}',
  'report-to':
    '{"group":"default","endpoints":[{"url":"https://evil.example"}]}',
  'reporting-endpoints': 'default="https://evil.example/report"',
  'accept-ch': 'Sec-CH-UA-Platform-Version',
} as const

describe('origin-policy response headers', () => {
  it('does not let the backend set policy for the browser-facing origin', async () => {
    const { event } = createEvent({
      method: 'GET',
      path: 'xrpc/x',
      headers: {},
      upstream: new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          ...ORIGIN_POLICY_RESPONSE_HEADERS,
          'content-type': 'application/json',
        },
      }),
    })

    const response = await GET(event as unknown as ProxyEvent)

    const leaked = Object.keys(ORIGIN_POLICY_RESPONSE_HEADERS).filter((name) =>
      response.headers.has(name),
    )
    expect(leaked).toEqual([])

    // The payload description still comes through.
    expect(response.headers.get('content-type')).toBe('application/json')
  })
})

describe('authenticated response caching', () => {
  it.each([200, 401, 429])(
    'protects cookie-bearing upstream %i responses and leaves session validity to the backend',
    async (status) => {
      const cookies = createMockCookies({
        coves_session: 'invalid-opaque-token',
      })
      const payload = { result: 'upstream-response' }
      const { event, upstreamFetch } = createEvent({
        cookies,
        headers: { authorization: 'Bearer forged-token' },
        upstream: Response.json(payload, {
          status,
          headers: {
            'cache-control': 'public, max-age=600',
            etag: '"shared"',
            'last-modified': 'Wed, 09 Sep 2026 12:00:00 GMT',
            expires: 'Thu, 10 Sep 2026 12:00:00 GMT',
            'retry-after': '30',
            'x-ratelimit-remaining': '0',
          },
        }),
      })

      const response = await GET(event as unknown as ProxyEvent)

      const headers = upstreamHeadersFrom(upstreamFetch)
      expect(headers.get('authorization')).toBe('Bearer invalid-opaque-token')
      expect(headers.has('cookie')).toBe(false)
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual(payload)
      expect(response.headers.get('retry-after')).toBe('30')
      expect(response.headers.get('x-ratelimit-remaining')).toBe('0')
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      for (const name of ['etag', 'last-modified', 'expires']) {
        expect(response.headers.has(name)).toBe(false)
      }
      expect(event.locals.auth).toEqual({ authenticated: false })
      expect(cookies.delete).not.toHaveBeenCalled()
      expect(cookies.set).not.toHaveBeenCalled()
    },
  )

  function cacheableUpstream(): Response {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=600',
        etag: '"v1"',
      },
    })
  }

  it('marks an authenticated response private and unstorable', async () => {
    // The backend answers as if to a bare request; it does not know the proxy
    // attached a session. Relaying `public, max-age=600` invites any shared
    // cache between here and the browser to serve one account's data to the
    // next caller, and the ETag makes that cached copy revalidatable.
    const { event } = createEvent({
      method: 'GET',
      path: 'xrpc/x',
      cookies: createMockCookies({ coves_session: 'sealed-tok' }),
      headers: {},
      upstream: cacheableUpstream(),
    })

    const response = await GET(event as unknown as ProxyEvent)

    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('etag')).toBeNull()
  })

  it('leaves an unauthenticated response cacheable exactly as the backend sent it', async () => {
    // Guard on the other half of the rule: public data stays shareable, so the
    // fix cannot be "never cache anything".
    const { event } = createEvent({
      method: 'GET',
      path: 'xrpc/x',
      headers: {},
      upstream: cacheableUpstream(),
    })

    const response = await GET(event as unknown as ProxyEvent)

    expect(response.headers.get('cache-control')).toBe('public, max-age=600')
    expect(response.headers.get('etag')).toBe('"v1"')
  })
})
