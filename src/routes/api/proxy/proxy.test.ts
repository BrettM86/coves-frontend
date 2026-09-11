import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SealedToken, InstanceURL } from '$lib/server/session'
import type { Cookies } from '@sveltejs/kit'
import {
  createMockCookies,
  createMockEvent,
} from '$lib/test-utils/request-event'

/**
 * Mutable env, so a test can describe a different deployment (an internal
 * plaintext upstream, a missing instance URL) without a second test file. The
 * objects are mutated in place rather than reassigned: `$lib/server/instance`
 * captures the reference at import time.
 */
const mockPrivateEnv = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
}))
const mockPublicEnv = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
}))
vi.mock('$env/dynamic/private', () => mockPrivateEnv)
vi.mock('$env/dynamic/public', () => mockPublicEnv)

/**
 * These exercise the real exported route handlers. Request/response header
 * hygiene (the allowlist, the X-Forwarded-* stamps and the response denylist)
 * is covered in depth by header-hygiene.test.ts; this file covers routing,
 * methods, path validation, CSRF and error mapping.
 */
const { GET, POST, PUT, DELETE, PATCH } = await import('./[...path]/+server')

type ProxyEvent = Parameters<typeof GET>[0]

type MockFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

/** The origin the app itself is served from, and so the only same-origin one. */
const APP_ORIGIN = 'https://coves.social'

function setEnv(
  publicEnv: Record<string, string | undefined>,
  privateEnv: Record<string, string | undefined> = {},
): void {
  for (const key of Object.keys(mockPublicEnv.env))
    delete mockPublicEnv.env[key]
  Object.assign(mockPublicEnv.env, publicEnv)
  for (const key of Object.keys(mockPrivateEnv.env))
    delete mockPrivateEnv.env[key]
  Object.assign(mockPrivateEnv.env, privateEnv)
}

function authenticatedLocals(token: string, instance: string): App.Locals {
  return {
    auth: {
      authenticated: true,
      authToken: token as SealedToken,
      account: { instance: instance as InstanceURL },
    },
  } as unknown as App.Locals
}

function unauthenticatedLocals(): App.Locals {
  return { auth: { authenticated: false }, requestId: 'test-request-id' }
}

describe('API Proxy', () => {
  let mockFetch: ReturnType<typeof vi.fn<MockFetch>>

  beforeEach(() => {
    mockFetch = vi.fn<MockFetch>()
    setEnv({ PUBLIC_INSTANCE_URL: APP_ORIGIN })
    // The handler logs upstream failures and blocked cross-origin requests;
    // both are expected in these tests and would otherwise flood the output.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  interface ProxyEventOptions {
    path: string
    method?: string
    headers?: Record<string, string>
    body?: unknown
    locals?: App.Locals
    cookies?: Cookies
  }

  function createEvent(options: ProxyEventOptions): ProxyEvent {
    const event = createMockEvent({
      method: options.method ?? 'GET',
      url: `${APP_ORIGIN}/api/proxy/${options.path}`,
      params: { path: options.path },
      headers: options.headers,
      body: options.body,
      cookies: options.cookies,
      locals: options.locals ?? unauthenticatedLocals(),
    })
    // The upstream hop goes through the platform fetch. The event's own fetch
    // is present but throws: kit's per-request fetch replays the inbound
    // cookie and authorization headers for a same-host upstream, which would
    // silently undo the request allowlist.
    vi.stubGlobal('fetch', mockFetch)
    Object.assign(event, {
      fetch: vi.fn(() => {
        throw new Error('event.fetch must not be used for the upstream hop')
      }),
    })
    return event as unknown as ProxyEvent
  }

  /**
   * Helper to get the last call to mockFetch with proper typing
   */
  function getLastFetchCall(): [string, RequestInit & { headers: Headers }] {
    const calls = mockFetch.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const lastCall = calls[calls.length - 1]!
    return [
      lastCall[0] as string,
      lastCall[1] as RequestInit & { headers: Headers },
    ]
  }

  describe('authenticated requests', () => {
    it('forwards GET request with Authorization header', async () => {
      const mockResponse = new Response(JSON.stringify({ data: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
      mockFetch.mockResolvedValue(mockResponse)

      const response = await GET(
        createEvent({
          path: 'api/v1/feed',
          headers: { 'Content-Type': 'application/json' },
          cookies: createMockCookies({ coves_session: 'test-jwt-token' }),
        }),
      )

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = getLastFetchCall()
      // Cookie credentials use the operator-configured upstream.
      expect(url).toBe('https://coves.social/api/v1/feed')
      expect(options.method).toBe('GET')
      expect(options.headers.get('Authorization')).toBe('Bearer test-jwt-token')
      expect(response.status).toBe(200)
    })

    it('forwards POST request with body and Authorization header', async () => {
      const mockResponse = new Response(JSON.stringify({ created: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
      mockFetch.mockResolvedValue(mockResponse)

      const response = await POST(
        createEvent({
          path: 'api/v1/posts',
          method: 'POST',
          headers: { Origin: APP_ORIGIN },
          body: { title: 'Test Post', content: 'Hello' },
          cookies: createMockCookies({ coves_session: 'test-jwt-token' }),
        }),
      )

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = getLastFetchCall()
      expect(url).toBe('https://coves.social/api/v1/posts')
      expect(options.method).toBe('POST')
      expect(options.headers.get('Authorization')).toBe('Bearer test-jwt-token')
      expect(options.body).toBeDefined()
      expect(response.status).toBe(201)
    })

    it('returns response from upstream', async () => {
      const responseData = { posts: [{ id: 1, title: 'Test' }] }
      const mockResponse = new Response(JSON.stringify(responseData), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-123',
        },
      })
      mockFetch.mockResolvedValue(mockResponse)

      const response = await GET(
        createEvent({
          path: 'api/v1/posts',
          cookies: createMockCookies({ coves_session: 'token' }),
        }),
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('X-Request-Id')).toBe('req-123')
      const body = await response.json()
      expect(body).toEqual(responseData)
    })
  })

  describe('unauthenticated requests', () => {
    it('forwards request without Authorization header when no session', async () => {
      const mockResponse = new Response(JSON.stringify({ public: true }), {
        status: 200,
      })
      mockFetch.mockResolvedValue(mockResponse)

      await GET(createEvent({ path: 'api/v1/public' }))

      const [url, options] = getLastFetchCall()
      // Falls back to the operator-configured PUBLIC_INSTANCE_URL.
      expect(url).toBe('https://coves.social/api/v1/public')
      expect(options.headers.has('Authorization')).toBe(false)
    })

    it('allows public endpoints without auth', async () => {
      const mockResponse = new Response(JSON.stringify({ site: 'info' }), {
        status: 200,
      })
      mockFetch.mockResolvedValue(mockResponse)

      const response = await GET(createEvent({ path: 'api/v1/site' }))

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.site).toBe('info')
    })
  })

  describe('error handling', () => {
    it('returns 502 on upstream connection error', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'))

      const response = await GET(
        createEvent({
          path: 'api/v1/data',
          cookies: createMockCookies({ coves_session: 'token' }),
        }),
      )

      expect(response.status).toBe(502)
      const body = await response.json()
      expect(body.error).toBe('Bad Gateway')
    })

    it('passes through upstream error responses', async () => {
      const errorResponse = new Response(
        JSON.stringify({ error: 'Not Found', message: 'Post not found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      )
      mockFetch.mockResolvedValue(errorResponse)

      const response = await GET(
        createEvent({
          path: 'api/v1/posts/999',
          cookies: createMockCookies({ coves_session: 'token' }),
        }),
      )

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error).toBe('Not Found')
    })

    it('handles 401 responses from upstream', async () => {
      const errorResponse = new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401 },
      )
      mockFetch.mockResolvedValue(errorResponse)

      const response = await GET(
        createEvent({
          path: 'api/v1/protected',
          cookies: createMockCookies({ coves_session: 'expired-token' }),
        }),
      )

      expect(response.status).toBe(401)
    })

    it('handles 500 responses from upstream', async () => {
      const errorResponse = new Response(
        JSON.stringify({ error: 'Internal Server Error' }),
        { status: 500 },
      )
      mockFetch.mockResolvedValue(errorResponse)

      const response = await GET(createEvent({ path: 'api/v1/error' }))

      expect(response.status).toBe(500)
    })
  })

  describe('header handling', () => {
    // Full coverage of the request allowlist and response denylist lives in
    // header-hygiene.test.ts. These two are kept as cheap guards on the
    // specific headers that corrupt a proxied response when they leak.
    it('removes host header before forwarding', async () => {
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      await GET(
        createEvent({
          path: 'api/v1/data',
          headers: { Host: 'localhost:5173' },
          cookies: createMockCookies({ coves_session: 'token' }),
        }),
      )

      const [, options] = getLastFetchCall()
      expect(options.headers.has('Host')).toBe(false)
    })

    it('removes content-encoding from response', async () => {
      const mockResponse = new Response('compressed data', {
        status: 200,
        headers: {
          'Content-Encoding': 'gzip',
          'Content-Type': 'application/json',
        },
      })
      mockFetch.mockResolvedValue(mockResponse)

      const response = await GET(createEvent({ path: 'api/v1/data' }))

      expect(response.headers.has('Content-Encoding')).toBe(false)
      expect(response.headers.get('Content-Type')).toBe('application/json')
    })
  })

  describe('HTTP methods', () => {
    it('handles PUT requests', async () => {
      const mockResponse = new Response(JSON.stringify({ updated: true }), {
        status: 200,
      })
      mockFetch.mockResolvedValue(mockResponse)

      const response = await PUT(
        createEvent({
          path: 'api/v1/posts/1',
          method: 'PUT',
          headers: { Origin: APP_ORIGIN },
          body: { title: 'Updated' },
          cookies: createMockCookies({ coves_session: 'token' }),
        }),
      )

      const [, options] = getLastFetchCall()
      expect(options.method).toBe('PUT')
      expect(response.status).toBe(200)
    })

    it('handles DELETE requests', async () => {
      const mockResponse = new Response(null, { status: 204 })
      mockFetch.mockResolvedValue(mockResponse)

      const response = await DELETE(
        createEvent({
          path: 'api/v1/posts/1',
          method: 'DELETE',
          headers: { Origin: APP_ORIGIN },
          cookies: createMockCookies({ coves_session: 'token' }),
        }),
      )

      const [, options] = getLastFetchCall()
      expect(options.method).toBe('DELETE')
      expect(response.status).toBe(204)
    })

    it('handles PATCH requests', async () => {
      const mockResponse = new Response(JSON.stringify({ patched: true }), {
        status: 200,
      })
      mockFetch.mockResolvedValue(mockResponse)

      const response = await PATCH(
        createEvent({
          path: 'api/v1/posts/1',
          method: 'PATCH',
          headers: { Origin: APP_ORIGIN },
          body: { title: 'Patched' },
          cookies: createMockCookies({ coves_session: 'token' }),
        }),
      )

      const [, options] = getLastFetchCall()
      expect(options.method).toBe('PATCH')
      expect(response.status).toBe(200)
    })
  })

  describe('instance routing', () => {
    it('uses the configured internal upstream even when locals name another instance', async () => {
      setEnv({
        PUBLIC_INSTANCE_URL: APP_ORIGIN,
        PUBLIC_INTERNAL_INSTANCE: 'upstream.example.test',
      })
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      await GET(
        createEvent({
          path: 'api/v1/data',
          cookies: createMockCookies({ coves_session: 'token' }),
          locals: authenticatedLocals(
            'different-local-token',
            'custom.instance.com',
          ),
        }),
      )

      const [url, options] = getLastFetchCall()
      expect(url).toBe('https://upstream.example.test/api/v1/data')
      expect(options.headers.get('authorization')).toBe('Bearer token')
    })

    it('uses the configured default instance without a session cookie', async () => {
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      await GET(createEvent({ path: 'api/v1/data' }))

      const [url] = getLastFetchCall()
      expect(url).toBe('https://coves.social/api/v1/data')
    })
  })

  describe('path traversal security', () => {
    it('rejects paths with ../ traversal attempts', async () => {
      const response = await GET(createEvent({ path: '../../../etc/passwd' }))

      // Should return 400 Bad Request and NOT call fetch
      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
      const body = await response.json()
      expect(body.error).toBe('Bad Request')
      expect(body.message).toContain('Invalid path')
    })

    it('rejects URL-encoded traversal attempts (..%2F)', async () => {
      // SvelteKit decodes the path before it reaches params, so the decoded
      // form is what the handler must reject.
      const response = await GET(createEvent({ path: '../../etc/passwd' }))

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects paths with encoded traversal in the middle', async () => {
      const response = await GET(
        createEvent({ path: 'api/v1/../../../etc/passwd' }),
      )

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects paths with backslash traversal (Windows-style)', async () => {
      const response = await GET(createEvent({ path: '..\\..\\etc\\passwd' }))

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects paths with mixed traversal techniques', async () => {
      const response = await GET(
        createEvent({ path: 'api/../v1/../../secret' }),
      )

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects double-encoded traversal attempts (..%252F)', async () => {
      // Double-encoded: %25 = %, so ..%252F decodes once to ..%2F
      const response = await GET(createEvent({ path: '..%2F..%2Fetc' }))

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects paths with null bytes', async () => {
      const response = await GET(createEvent({ path: 'api/v1/data\x00.json' }))

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('allows legitimate paths with dots in filenames', async () => {
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const response = await GET(createEvent({ path: 'api/v1/file.json' }))

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url] = getLastFetchCall()
      expect(url).toBe('https://coves.social/api/v1/file.json')
    })

    it('allows paths with single dots (current directory)', async () => {
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const response = await GET(createEvent({ path: 'api/./v1/data' }))

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('allows paths with dots in domain-like segments', async () => {
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const response = await GET(
        createEvent({ path: 'api/v1/users/user.name@domain.com' }),
      )

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('rejects paths that would escape the API root after normalization', async () => {
      const response = await GET(
        createEvent({ path: 'api/v1/../../../../root' }),
      )

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects paths with protocol injection attempts', async () => {
      const response = await GET(
        createEvent({ path: 'http://evil.com/malicious' }),
      )

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects paths with javascript protocol', async () => {
      const response = await GET(createEvent({ path: 'javascript:alert(1)' }))

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('upstream scheme policy', () => {
    /**
     * The rule itself (`isUpstreamSchemeAllowed`) is unit-tested in
     * src/lib/app/state/instance/resolve.test.ts. What is asserted here is the
     * non-production side of the gate: a plaintext instance is proxied as
     * configured rather than silently rewritten to https.
     */
    it('allows HTTP URLs in development/test environment', async () => {
      setEnv({
        PUBLIC_INSTANCE_URL: APP_ORIGIN,
        PUBLIC_INTERNAL_INSTANCE: 'http://localhost:8080',
      })
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const response = await GET(
        createEvent({
          path: 'api/v1/data',
          cookies: createMockCookies({ coves_session: 'token' }),
        }),
      )

      expect(response.status).toBe(200)
      const [url] = getLastFetchCall()
      expect(url).toBe('http://localhost:8080/api/v1/data')
    })
  })

  describe('production scheme gate', () => {
    // In production a plaintext upstream is a downgrade an attacker on the
    // path can read and rewrite, so it is refused — unless the operator has
    // named one specific private-network origin as the exception.
    beforeEach(() => {
      vi.stubEnv('PROD', true)
    })

    it('refuses a plaintext upstream that was not opted in', async () => {
      setEnv({ PUBLIC_INSTANCE_URL: 'http://localhost:8080' })

      const response = await GET(createEvent({ path: 'api/v1/data' }))

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.message).toBe('HTTP URLs are not allowed in production')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('allows the plaintext internal origin the operator opted in', async () => {
      setEnv(
        {
          PUBLIC_INSTANCE_URL: APP_ORIGIN,
          PUBLIC_INTERNAL_INSTANCE: 'http://appview:8080',
        },
        { ALLOW_HTTP_INTERNAL_INSTANCE: 'true' },
      )
      mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

      const response = await GET(
        createEvent({
          path: 'api/v1/data',
          cookies: createMockCookies({ coves_session: 'token' }),
        }),
      )

      expect(response.status).toBe(200)
      const [url] = getLastFetchCall()
      expect(url).toBe('http://appview:8080/api/v1/data')
    })
  })

  describe('CSRF origin validation', () => {
    it('rejects cross-origin POST requests with 403', async () => {
      const response = await POST(
        createEvent({
          path: 'api/v1/posts',
          method: 'POST',
          headers: { Origin: 'https://evil.example.com' },
          body: { title: 'forged' },
          cookies: createMockCookies({ coves_session: 'token' }),
        }),
      )

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error).toBe('Forbidden')
      // The forged request must never reach the upstream backend
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects cross-origin requests identified only by Referer', async () => {
      const response = await DELETE(
        createEvent({
          path: 'api/v1/posts',
          method: 'DELETE',
          headers: { Referer: 'https://evil.example.com/attack-page' },
          cookies: createMockCookies({ coves_session: 'token' }),
        }),
      )

      expect(response.status).toBe(403)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('allows same-origin POST requests', async () => {
      mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

      const response = await POST(
        createEvent({
          path: 'api/v1/posts',
          method: 'POST',
          headers: { Origin: APP_ORIGIN },
          body: { title: 'legit' },
          cookies: createMockCookies({ coves_session: 'token' }),
        }),
      )

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('allows POST requests with no Origin or Referer header', async () => {
      // Some browsers/clients strip these headers; rejecting would break them
      mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

      const response = await POST(
        createEvent({
          path: 'api/v1/posts',
          method: 'POST',
          body: { title: 'no-origin client' },
          cookies: createMockCookies({ coves_session: 'token' }),
        }),
      )

      expect(response.status).toBe(200)
    })

    it('does not block cross-origin GET requests', async () => {
      // Reads are safe; only state-changing methods need origin validation
      mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

      const response = await GET(
        createEvent({
          path: 'api/v1/feed',
          headers: { Origin: 'https://other.example.com' },
        }),
      )

      expect(response.status).toBe(200)
    })
  })
})
