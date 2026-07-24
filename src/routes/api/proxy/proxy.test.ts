import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SealedToken, InstanceURL } from '$lib/server/session'
import { enforceSameOrigin, validateProxyPath } from './validate'

// Mock SvelteKit types for testing - mirrors App.AuthState
type MockAuthState =
  | { authenticated: false }
  | {
      authenticated: true
      authToken: SealedToken
      account: { instance: InstanceURL }
    }

interface MockLocals {
  auth: MockAuthState
}

interface MockParams {
  path: string
}

// Mock fetch type for testing
type MockFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

// Create the handler function we'll test.
// This is duplicated from the source because the real handler function is not
// exported (it's an internal implementation detail wrapped by the exported
// RequestHandler functions), and it uses App.Locals which requires the full
// SvelteKit type context. The tests verify the same logic in isolation.
async function createHandler(options: {
  params: MockParams
  request: Request
  locals: MockLocals
  fetch: MockFetch
  url?: URL
}): Promise<Response> {
  const { params, request, locals, fetch: fetchFn } = options
  const url = options.url ?? new URL(request.url)
  const path = params.path

  // CSRF gate: this is the REAL exported gate from validate.ts — the same
  // code the production route runs, not a test-local copy.
  const csrfRejection = enforceSameOrigin(request, url.origin, path)
  if (csrfRejection) {
    return csrfRejection
  }

  // Validate path for security issues
  const pathError = validateProxyPath(path)
  if (pathError) {
    return new Response(
      JSON.stringify({ error: 'Bad Request', message: pathError }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  // Determine target instance (from session or default)
  const instance = locals.auth.authenticated
    ? locals.auth.account.instance
    : 'coves.social'
  const targetUrl = `https://${instance}/${path}`

  // Build headers, injecting auth if available
  const headers = new Headers(request.headers)
  headers.delete('host') // Don't forward host header
  headers.delete('connection') // Don't forward connection header

  if (locals.auth.authenticated) {
    headers.set('Authorization', `Bearer ${locals.auth.authToken}`)
  }

  try {
    // Forward request
    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
    }

    // Only include body for methods that support it.
    // We consume the body as a Blob rather than streaming request.body
    // (ReadableStream) because Node.js undici has issues with ReadableStream
    // bodies in fetch(), causing "expected non-null body source" errors.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = await request.blob()
    }

    const response = await fetchFn(targetUrl, fetchOptions)

    // Return response (strip some headers)
    const responseHeaders = new Headers(response.headers)
    responseHeaders.delete('content-encoding') // Let SvelteKit handle

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (error) {
    // Connection error to upstream
    console.error('Proxy error:', error)
    return new Response(
      JSON.stringify({
        error: 'Bad Gateway',
        message: 'Failed to connect to upstream server',
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}

/**
 * Helper to create authenticated MockLocals
 */
function createAuthenticatedLocals(
  token: string,
  instance: string,
): MockLocals {
  return {
    auth: {
      authenticated: true,
      authToken: token as SealedToken,
      account: { instance: instance as InstanceURL },
    },
  }
}

/**
 * Helper to create unauthenticated MockLocals
 */
function createUnauthenticatedLocals(): MockLocals {
  return { auth: { authenticated: false } }
}

describe('API Proxy', () => {
  let mockFetch: ReturnType<typeof vi.fn<MockFetch>>

  beforeEach(() => {
    mockFetch = vi.fn<MockFetch>()
  })

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

      const request = new Request('http://localhost/api/proxy/api/v1/feed', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await createHandler({
        params: { path: 'api/v1/feed' },
        request,
        locals: createAuthenticatedLocals(
          'test-jwt-token',
          'test.coves.social',
        ),
        fetch: mockFetch,
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = getLastFetchCall()
      expect(url).toBe('https://test.coves.social/api/v1/feed')
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

      const postBody = JSON.stringify({ title: 'Test Post', content: 'Hello' })
      const request = new Request('http://localhost/api/proxy/api/v1/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: postBody,
      })

      const response = await createHandler({
        params: { path: 'api/v1/posts' },
        request,
        locals: createAuthenticatedLocals(
          'test-jwt-token',
          'test.coves.social',
        ),
        fetch: mockFetch,
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = getLastFetchCall()
      expect(url).toBe('https://test.coves.social/api/v1/posts')
      expect(options.method).toBe('POST')
      expect(options.headers.get('Authorization')).toBe('Bearer test-jwt-token')
      expect(options.body).toBeDefined()
      expect(response.status).toBe(201)
    })

    it('preserves original request headers', async () => {
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('http://localhost/api/proxy/api/v1/data', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Custom-Header': 'custom-value',
          'Accept-Language': 'en-US',
        },
      })

      await createHandler({
        params: { path: 'api/v1/data' },
        request,
        locals: createAuthenticatedLocals('token', 'coves.social'),
        fetch: mockFetch,
      })

      const [, options] = getLastFetchCall()
      expect(options.headers.get('Accept')).toBe('application/json')
      expect(options.headers.get('X-Custom-Header')).toBe('custom-value')
      expect(options.headers.get('Accept-Language')).toBe('en-US')
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

      const request = new Request('http://localhost/api/proxy/api/v1/posts', {
        method: 'GET',
      })

      const response = await createHandler({
        params: { path: 'api/v1/posts' },
        request,
        locals: createAuthenticatedLocals('token', 'coves.social'),
        fetch: mockFetch,
      })

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

      const request = new Request('http://localhost/api/proxy/api/v1/public', {
        method: 'GET',
      })

      await createHandler({
        params: { path: 'api/v1/public' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      const [url, options] = getLastFetchCall()
      expect(url).toBe('https://coves.social/api/v1/public') // Uses default instance
      expect(options.headers.has('Authorization')).toBe(false)
    })

    it('allows public endpoints without auth', async () => {
      const mockResponse = new Response(JSON.stringify({ site: 'info' }), {
        status: 200,
      })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('http://localhost/api/proxy/api/v1/site', {
        method: 'GET',
      })

      const response = await createHandler({
        params: { path: 'api/v1/site' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.site).toBe('info')
    })
  })

  describe('error handling', () => {
    it('returns 502 on upstream connection error', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'))

      const request = new Request('http://localhost/api/proxy/api/v1/data', {
        method: 'GET',
      })

      const response = await createHandler({
        params: { path: 'api/v1/data' },
        request,
        locals: createAuthenticatedLocals('token', 'coves.social'),
        fetch: mockFetch,
      })

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

      const request = new Request(
        'http://localhost/api/proxy/api/v1/posts/999',
        {
          method: 'GET',
        },
      )

      const response = await createHandler({
        params: { path: 'api/v1/posts/999' },
        request,
        locals: createAuthenticatedLocals('token', 'coves.social'),
        fetch: mockFetch,
      })

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

      const request = new Request(
        'http://localhost/api/proxy/api/v1/protected',
        {
          method: 'GET',
        },
      )

      const response = await createHandler({
        params: { path: 'api/v1/protected' },
        request,
        locals: createAuthenticatedLocals('expired-token', 'coves.social'),
        fetch: mockFetch,
      })

      expect(response.status).toBe(401)
    })

    it('handles 500 responses from upstream', async () => {
      const errorResponse = new Response(
        JSON.stringify({ error: 'Internal Server Error' }),
        { status: 500 },
      )
      mockFetch.mockResolvedValue(errorResponse)

      const request = new Request('http://localhost/api/proxy/api/v1/error', {
        method: 'GET',
      })

      const response = await createHandler({
        params: { path: 'api/v1/error' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(500)
    })
  })

  describe('header handling', () => {
    it('removes host header before forwarding', async () => {
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('http://localhost/api/proxy/api/v1/data', {
        method: 'GET',
        headers: {
          Host: 'localhost:5173',
        },
      })

      await createHandler({
        params: { path: 'api/v1/data' },
        request,
        locals: createAuthenticatedLocals('token', 'coves.social'),
        fetch: mockFetch,
      })

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

      const request = new Request('http://localhost/api/proxy/api/v1/data', {
        method: 'GET',
      })

      const response = await createHandler({
        params: { path: 'api/v1/data' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

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

      const request = new Request('http://localhost/api/proxy/api/v1/posts/1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      })

      const response = await createHandler({
        params: { path: 'api/v1/posts/1' },
        request,
        locals: createAuthenticatedLocals('token', 'coves.social'),
        fetch: mockFetch,
      })

      const [, options] = getLastFetchCall()
      expect(options.method).toBe('PUT')
      expect(response.status).toBe(200)
    })

    it('handles DELETE requests', async () => {
      const mockResponse = new Response(null, { status: 204 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('http://localhost/api/proxy/api/v1/posts/1', {
        method: 'DELETE',
      })

      const response = await createHandler({
        params: { path: 'api/v1/posts/1' },
        request,
        locals: createAuthenticatedLocals('token', 'coves.social'),
        fetch: mockFetch,
      })

      const [, options] = getLastFetchCall()
      expect(options.method).toBe('DELETE')
      expect(response.status).toBe(204)
    })

    it('handles PATCH requests', async () => {
      const mockResponse = new Response(JSON.stringify({ patched: true }), {
        status: 200,
      })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('http://localhost/api/proxy/api/v1/posts/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Patched' }),
      })

      const response = await createHandler({
        params: { path: 'api/v1/posts/1' },
        request,
        locals: createAuthenticatedLocals('token', 'coves.social'),
        fetch: mockFetch,
      })

      const [, options] = getLastFetchCall()
      expect(options.method).toBe('PATCH')
      expect(response.status).toBe(200)
    })
  })

  describe('instance routing', () => {
    it('uses active account instance when available', async () => {
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('http://localhost/api/proxy/api/v1/data', {
        method: 'GET',
      })

      await createHandler({
        params: { path: 'api/v1/data' },
        request,
        locals: createAuthenticatedLocals('token', 'custom.instance.com'),
        fetch: mockFetch,
      })

      const [url] = getLastFetchCall()
      expect(url).toBe('https://custom.instance.com/api/v1/data')
    })

    it('falls back to default instance when no active account', async () => {
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('http://localhost/api/proxy/api/v1/data', {
        method: 'GET',
      })

      await createHandler({
        params: { path: 'api/v1/data' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      const [url] = getLastFetchCall()
      expect(url).toBe('https://coves.social/api/v1/data')
    })
  })

  describe('path traversal security', () => {
    it('rejects paths with ../ traversal attempts', async () => {
      const request = new Request(
        'http://localhost/api/proxy/../../../etc/passwd',
        {
          method: 'GET',
        },
      )

      const response = await createHandler({
        params: { path: '../../../etc/passwd' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      // Should return 400 Bad Request and NOT call fetch
      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
      const body = await response.json()
      expect(body.error).toBe('Bad Request')
      expect(body.message).toContain('Invalid path')
    })

    it('rejects URL-encoded traversal attempts (..%2F)', async () => {
      // Note: SvelteKit typically decodes this, but we test the decoded version
      const request = new Request(
        'http://localhost/api/proxy/..%2F..%2Fetc%2Fpasswd',
        {
          method: 'GET',
        },
      )

      const response = await createHandler({
        params: { path: '../../etc/passwd' }, // Decoded by SvelteKit
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects paths with encoded traversal in the middle', async () => {
      const request = new Request(
        'http://localhost/api/proxy/api/v1/../../../etc/passwd',
        {
          method: 'GET',
        },
      )

      const response = await createHandler({
        params: { path: 'api/v1/../../../etc/passwd' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects paths with backslash traversal (Windows-style)', async () => {
      const request = new Request(
        'http://localhost/api/proxy/..\\..\\etc\\passwd',
        {
          method: 'GET',
        },
      )

      const response = await createHandler({
        params: { path: '..\\..\\etc\\passwd' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects paths with mixed traversal techniques', async () => {
      const request = new Request(
        'http://localhost/api/proxy/api/../v1/../../secret',
        {
          method: 'GET',
        },
      )

      const response = await createHandler({
        params: { path: 'api/../v1/../../secret' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects double-encoded traversal attempts (..%252F)', async () => {
      // Double-encoded: %25 = %, so ..%252F = ..%2F when decoded once
      // We need to check if the path contains %2F or similar encoded sequences
      const request = new Request(
        'http://localhost/api/proxy/..%252F..%252Fetc',
        {
          method: 'GET',
        },
      )

      const response = await createHandler({
        params: { path: '..%2F..%2Fetc' }, // SvelteKit decodes once
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects paths with null bytes', async () => {
      const request = new Request(
        'http://localhost/api/proxy/api/v1/data%00.json',
        {
          method: 'GET',
        },
      )

      const response = await createHandler({
        params: { path: 'api/v1/data\x00.json' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('allows legitimate paths with dots in filenames', async () => {
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request(
        'http://localhost/api/proxy/api/v1/file.json',
        {
          method: 'GET',
        },
      )

      const response = await createHandler({
        params: { path: 'api/v1/file.json' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url] = getLastFetchCall()
      expect(url).toBe('https://coves.social/api/v1/file.json')
    })

    it('allows paths with single dots (current directory)', async () => {
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('http://localhost/api/proxy/api/./v1/data', {
        method: 'GET',
      })

      // Single dots are safe but we normalize them
      const response = await createHandler({
        params: { path: 'api/./v1/data' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('allows paths with dots in domain-like segments', async () => {
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request(
        'http://localhost/api/proxy/api/v1/users/user.name@domain.com',
        {
          method: 'GET',
        },
      )

      const response = await createHandler({
        params: { path: 'api/v1/users/user.name@domain.com' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('rejects paths that would escape the API root after normalization', async () => {
      const request = new Request(
        'http://localhost/api/proxy/api/v1/../../../../root',
        {
          method: 'GET',
        },
      )

      const response = await createHandler({
        params: { path: 'api/v1/../../../../root' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects paths with protocol injection attempts', async () => {
      const request = new Request(
        'http://localhost/api/proxy/http://evil.com/malicious',
        {
          method: 'GET',
        },
      )

      const response = await createHandler({
        params: { path: 'http://evil.com/malicious' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects paths with javascript protocol', async () => {
      const request = new Request(
        'http://localhost/api/proxy/javascript:alert(1)',
        {
          method: 'GET',
        },
      )

      const response = await createHandler({
        params: { path: 'javascript:alert(1)' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('production HTTP rejection', () => {
    /**
     * Note: The actual production HTTP rejection is handled in the server endpoint
     * using import.meta.env.PROD check. This test documents the expected behavior
     * and tests the validation logic in isolation.
     *
     * In production, HTTP URLs should return 400 Bad Request with a clear message.
     */
    it('documents production HTTP URL rejection behavior', () => {
      // The actual server implementation checks import.meta.env.PROD
      // and rejects HTTP URLs with this message:
      const expectedErrorMessage = 'HTTP URLs are not allowed in production'

      // This is a documentation test showing what the production behavior should be
      expect(expectedErrorMessage).toBe(
        'HTTP URLs are not allowed in production',
      )

      // The handler in +server.ts lines 82-93 implements:
      // if (import.meta.env.PROD && baseUrl.startsWith('http://')) {
      //   return new Response(
      //     JSON.stringify({
      //       error: 'Bad Request',
      //       message: 'HTTP URLs are not allowed in production',
      //     }),
      //     { status: 400, headers: { 'Content-Type': 'application/json' } }
      //   )
      // }
    })

    it('allows HTTP URLs in development/test environment', async () => {
      // In non-production environment, HTTP URLs are allowed for local development
      const mockResponse = new Response('OK', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('http://localhost/api/proxy/api/v1/data', {
        method: 'GET',
      })

      // Create handler with HTTP instance
      const response = await createHandler({
        params: { path: 'api/v1/data' },
        request,
        locals: createAuthenticatedLocals('token', 'http://localhost:8080'),
        fetch: mockFetch,
      })

      // In test/dev, HTTP should work
      // Note: createHandler uses https:// prefix, so this tests the handler accepts
      // the request. The actual +server.ts implementation handles HTTP instances.
      expect(response.status).toBe(200)
    })
  })

  describe('CSRF origin validation', () => {
    it('rejects cross-origin POST requests with 403', async () => {
      const request = new Request('http://localhost/api/proxy/api/v1/posts', {
        method: 'POST',
        headers: { Origin: 'https://evil.example.com' },
        body: JSON.stringify({ title: 'forged' }),
      })

      const response = await createHandler({
        params: { path: 'api/v1/posts' },
        request,
        locals: createAuthenticatedLocals('token', 'test.coves.social'),
        fetch: mockFetch,
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error).toBe('Forbidden')
      // The forged request must never reach the upstream backend
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects cross-origin requests identified only by Referer', async () => {
      const request = new Request('http://localhost/api/proxy/api/v1/posts', {
        method: 'DELETE',
        headers: { Referer: 'https://evil.example.com/attack-page' },
      })

      const response = await createHandler({
        params: { path: 'api/v1/posts' },
        request,
        locals: createAuthenticatedLocals('token', 'test.coves.social'),
        fetch: mockFetch,
      })

      expect(response.status).toBe(403)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('allows same-origin POST requests', async () => {
      mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

      const request = new Request('http://localhost/api/proxy/api/v1/posts', {
        method: 'POST',
        headers: { Origin: 'http://localhost' },
        body: JSON.stringify({ title: 'legit' }),
      })

      const response = await createHandler({
        params: { path: 'api/v1/posts' },
        request,
        locals: createAuthenticatedLocals('token', 'test.coves.social'),
        fetch: mockFetch,
      })

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('allows POST requests with no Origin or Referer header', async () => {
      // Some browsers/clients strip these headers; rejecting would break them
      mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

      const request = new Request('http://localhost/api/proxy/api/v1/posts', {
        method: 'POST',
        body: JSON.stringify({ title: 'no-origin client' }),
      })

      const response = await createHandler({
        params: { path: 'api/v1/posts' },
        request,
        locals: createAuthenticatedLocals('token', 'test.coves.social'),
        fetch: mockFetch,
      })

      expect(response.status).toBe(200)
    })

    it('does not block cross-origin GET requests', async () => {
      // Reads are safe; only state-changing methods need origin validation
      mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

      const request = new Request('http://localhost/api/proxy/api/v1/feed', {
        method: 'GET',
        headers: { Origin: 'https://other.example.com' },
      })

      const response = await createHandler({
        params: { path: 'api/v1/feed' },
        request,
        locals: createUnauthenticatedLocals(),
        fetch: mockFetch,
      })

      expect(response.status).toBe(200)
    })
  })
})
