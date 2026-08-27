import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RequestEvent, ResolveOptions } from '@sveltejs/kit'
import {
  createMockCookies,
  createMockEvent,
  isRedirect,
} from '$lib/test-utils/request-event'

// Variable to control the mocked instance URL
let mockPublicInternalInstance: string | undefined = 'http://localhost:4000'
let mockPublicInstanceUrl: string | undefined = undefined

// Variable to control dev mode (default false to avoid hostname redirects in most tests)
let mockDev = false

// Variable to control the mocked LOG_STACKS private env var
let mockLogStacks: string | undefined = undefined

// Mock $app/environment
vi.mock('$app/environment', () => ({
  get dev() {
    return mockDev
  },
  browser: false,
  building: false,
  version: 'test',
}))

// Mock environment variables
vi.mock('$env/dynamic/public', () => ({
  env: {
    get PUBLIC_INTERNAL_INSTANCE() {
      return mockPublicInternalInstance
    },
    get PUBLIC_INSTANCE_URL() {
      return mockPublicInstanceUrl
    },
  },
}))

let mockCspVideoOrigins: string | undefined = 'https://pds.coves.me'

// Mock private environment variables (LOG_STACKS gates stack inclusion)
vi.mock('$env/dynamic/private', () => ({
  env: {
    get LOG_STACKS() {
      return mockLogStacks
    },
    get CSP_VIDEO_ORIGINS() {
      return mockCspVideoOrigins
    },
  },
}))

// Import handle and handleError after mocking
const { handle, handleError } = await import('./hooks.server')

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

/**
 * Creates a mock resolve function that returns a Response
 */
function createMockResolve() {
  return vi.fn().mockResolvedValue(new Response('OK'))
}

/**
 * Asserts a console spy received exactly one call carrying exactly one string
 * argument — the structured log line — and returns it raw and parsed. The raw
 * form is what secret-leak assertions must run against.
 */
function singleJsonLine(calls: unknown[][]): {
  raw: string
  line: Record<string, unknown>
} {
  expect(calls).toHaveLength(1)
  expect(calls[0]).toHaveLength(1)
  const raw = calls[0][0]
  expect(typeof raw).toBe('string')
  // Assert JSON shape before parsing so a legacy plain-text log line fails
  // with a readable diff rather than an opaque JSON.parse SyntaxError.
  expect(raw).toMatch(/^\{[\s\S]*\}$/)
  return {
    raw: raw as string,
    line: JSON.parse(raw as string) as Record<string, unknown>,
  }
}

/** Narrows the `err` member of a parsed log line to an object. */
function errOf(line: Record<string, unknown>): Record<string, unknown> {
  expect(line.err).toBeTypeOf('object')
  expect(line.err).not.toBeNull()
  return line.err as Record<string, unknown>
}

function spyOnWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}

function spyOnError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

/** Asserts no console call in these paths ever received a raw Error object. */
function expectOnlyStringArgs(calls: unknown[][]): void {
  for (const call of calls) {
    for (const arg of call) {
      expect(typeof arg).toBe('string')
      expect(arg).not.toBeInstanceOf(Error)
    }
  }
}

describe('hooks.server handle', () => {
  // vitest's `restoreMocks` detaches these after each test, so no test needs
  // its own restore — and a failing assertion can no longer leak spy calls
  // into the next test by skipping one.
  let warnSpy: ReturnType<typeof spyOnWarn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockPublicInternalInstance = 'http://localhost:4000'
    mockPublicInstanceUrl = undefined
    mockDev = false
    warnSpy = spyOnWarn()
  })

  describe('no coves_session cookie', () => {
    it('results in unauthenticated state and no fetch called', async () => {
      const cookies = createMockCookies({})
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(mockFetch).not.toHaveBeenCalled()
      expect(event.locals.auth.authenticated).toBe(false)
      expect(event.locals.authError).toBeUndefined()
      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })
  })

  describe('empty string coves_session cookie', () => {
    it('treats empty string as no cookie and returns unauthenticated', async () => {
      const cookies = createMockCookies({ coves_session: '' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      // Empty string is falsy, so it's treated the same as no cookie
      expect(event.locals.auth.authenticated).toBe(false)
      expect(mockFetch).not.toHaveBeenCalled()
      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })
  })

  describe('valid cookie and /api/me returns 200', () => {
    it('populates authenticated state with correct account and authToken', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            did: 'did:plc:user1',
            handle: 'user1.example.com',
            avatar: 'https://example.com/avatar.png',
          }),
          { status: 200 },
        ),
      )

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4000/api/me', {
        headers: { Cookie: 'coves_session=sealed-token-value' },
        signal: expect.any(AbortSignal),
      })
      expect(event.locals.auth.authenticated).toBe(true)
      if (event.locals.auth.authenticated) {
        expect(event.locals.auth.account.did).toBe('did:plc:user1')
        expect(event.locals.auth.account.handle).toBe('user1.example.com')
        expect(event.locals.auth.account.instance).toBe('http://localhost:4000')
        expect(event.locals.auth.account.sealedToken).toBe('sealed-token-value')
        expect(event.locals.auth.account.avatar).toBe(
          'https://example.com/avatar.png',
        )
        expect(event.locals.auth.authToken).toBe('sealed-token-value')
      }
      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })
  })

  describe('valid cookie and /api/me returns 401', () => {
    it('results in unauthenticated state without console.warn', async () => {
      mockFetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }))

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(false)
      // Should NOT log a warning for 401 (expected case)
      expect(warnSpy).not.toHaveBeenCalled()
      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })

    it('deletes the stale coves_session cookie on 401', async () => {
      mockFetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }))

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(cookies.delete).toHaveBeenCalledWith('coves_session', {
        path: '/',
      })
    })

    it('sets sessionExpired flag on 401', async () => {
      mockFetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }))

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.sessionExpired).toBe(true)
    })

    it('does not set authError on 401 (session expiry is expected)', async () => {
      mockFetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }))

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.authError).toBeUndefined()
    })
  })

  describe('valid cookie and /api/me returns 500', () => {
    it('results in unauthenticated state and logs warning', async () => {
      mockFetch.mockResolvedValue(
        new Response('Internal Server Error', { status: 500 }),
      )

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(false)
      const { line } = singleJsonLine(warnSpy.mock.calls)
      expect(line.level).toBe('warn')
      expect(line.msg).toContain('/api/me returned 500')
      expect(line.requestId).toBe(event.locals.requestId)
      // The upstream status belongs in a queryable field, not only in prose.
      expect(line.status).toBe(500)
      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })
  })

  describe('valid cookie and fetch throws network error', () => {
    it('sets authError to network_error for connection refused', async () => {
      mockFetch.mockRejectedValue(
        new Error('Network error: connection refused'),
      )

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(false)
      expect(event.locals.authError).toBe('network_error')
      const { line } = singleJsonLine(warnSpy.mock.calls)
      expect(line.level).toBe('warn')
      expect(line.msg).toContain('Network error calling /api/me')
      expect(line.requestId).toBe(event.locals.requestId)
      expect(errOf(line).name).toBe('Error')
      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })

    it('sets authError to network_error for TypeError (fetch failure)', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'))

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(false)
      expect(event.locals.authError).toBe('network_error')
      const { line } = singleJsonLine(warnSpy.mock.calls)
      expect(line.level).toBe('warn')
      expect(line.msg).toContain('Network error calling /api/me')
      expect(line.requestId).toBe(event.locals.requestId)
      expect(errOf(line).name).toBe('TypeError')
      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })

    it('classifies TimeoutError and AbortError as network errors by name', async () => {
      for (const name of ['TimeoutError', 'AbortError']) {
        warnSpy.mockClear()
        mockFetch.mockRejectedValue(new DOMException('operation failed', name))

        const cookies = createMockCookies({
          coves_session: 'sealed-token-value',
        })
        const event = createMockEvent({ cookies })
        const resolve = createMockResolve()

        await handle({ event, resolve })

        expect(event.locals.auth.authenticated).toBe(false)
        expect(event.locals.authError).toBe('network_error')
        const { line } = singleJsonLine(warnSpy.mock.calls)
        expect(line.level).toBe('warn')
        expect(line.msg).toContain('Network error calling /api/me')
        expect(line.requestId).toBe(event.locals.requestId)
        // DOMException carries the discriminating name, so the log line must
        // preserve it — that is what distinguishes a timeout from an abort.
        expect(errOf(line).name).toBe(name)
        expect(cookies.delete).not.toHaveBeenCalled()
      }
    })

    it('does not delete the coves_session cookie on network error', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'))

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(cookies.delete).not.toHaveBeenCalled()
    })

    it('sets authError to network_error for unexpected non-network errors', async () => {
      mockFetch.mockRejectedValue(new Error('some completely unexpected error'))

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(false)
      expect(event.locals.authError).toBe('network_error')
      const { line } = singleJsonLine(warnSpy.mock.calls)
      expect(line.level).toBe('warn')
      expect(line.msg).toContain('Unexpected error calling /api/me')
      expect(line.requestId).toBe(event.locals.requestId)
      expect(errOf(line).name).toBe('Error')
      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })
  })

  describe('valid cookie and /api/me returns invalid JSON', () => {
    it('sets authError to validation_error and logs warning', async () => {
      mockFetch.mockResolvedValue(
        new Response('not json', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
      )

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(false)
      expect(event.locals.authError).toBe('validation_error')
      // Invalid JSON triggers response.json() to throw as SyntaxError,
      // which is categorized as a validation error
      const { line } = singleJsonLine(warnSpy.mock.calls)
      expect(line.level).toBe('warn')
      expect(line.msg).toContain('/api/me returned invalid JSON')
      expect(line.requestId).toBe(event.locals.requestId)
      expect(errOf(line).name).toBe('SyntaxError')
      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })
  })

  describe('valid cookie and /api/me returns incomplete data', () => {
    it('sets authError to validation_error when did is missing', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ handle: 'user1.example.com' }), {
          status: 200,
        }),
      )

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(false)
      expect(event.locals.authError).toBe('validation_error')
      const { line } = singleJsonLine(warnSpy.mock.calls)
      expect(line.level).toBe('warn')
      expect(line.msg).toContain('/api/me response failed validation')
      expect(line.requestId).toBe(event.locals.requestId)
      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })

    it('sets authError to validation_error when handle is missing', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ did: 'did:plc:user1' }), { status: 200 }),
      )

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(false)
      expect(event.locals.authError).toBe('validation_error')
      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })
  })

  describe('no instance URL configured', () => {
    it('throws a fatal error when instance URL is missing', async () => {
      mockPublicInternalInstance = undefined
      mockPublicInstanceUrl = undefined

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await expect(handle({ event, resolve })).rejects.toThrow(
        'No instance URL configured',
      )

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('authToken equals cookie value', () => {
    it('authToken is the coves_session cookie value', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            did: 'did:plc:user1',
            handle: 'user1.example.com',
          }),
          { status: 200 },
        ),
      )

      const cookieValue = 'my-specific-sealed-token-value'
      const cookies = createMockCookies({ coves_session: cookieValue })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(true)
      if (event.locals.auth.authenticated) {
        expect(event.locals.auth.authToken).toBe(cookieValue)
      }
    })
  })

  describe('resolve function behavior', () => {
    it('always calls resolve with the event', async () => {
      const cookies = createMockCookies({})
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(resolve).toHaveBeenCalledTimes(1)
      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })

    it('returns the resolve response', async () => {
      const expectedResponse = new Response('Test Response')
      const cookies = createMockCookies({})
      const event = createMockEvent({ cookies })
      const resolve = vi.fn().mockResolvedValue(expectedResponse)

      const result = await handle({ event, resolve })

      expect(result).toBe(expectedResponse)
    })
  })

  describe('instance URL fallback', () => {
    it('uses PUBLIC_INSTANCE_URL when PUBLIC_INTERNAL_INSTANCE is not set', async () => {
      mockPublicInternalInstance = undefined
      mockPublicInstanceUrl = 'https://coves.example.com'

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            did: 'did:plc:user1',
            handle: 'user1.example.com',
          }),
          { status: 200 },
        ),
      )

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://coves.example.com/api/me',
        {
          headers: { Cookie: 'coves_session=sealed-token-value' },
          signal: expect.any(AbortSignal),
        },
      )
      expect(event.locals.auth.authenticated).toBe(true)
    })
  })

  describe('dev mode hostname normalization', () => {
    it('redirects localhost to 127.0.0.1 when dev=true and PUBLIC_INSTANCE_URL uses 127.0.0.1', async () => {
      mockDev = true
      mockPublicInstanceUrl = 'http://127.0.0.1:8080'

      const cookies = createMockCookies({})
      const event = createMockEvent({
        cookies,
        url: 'http://localhost:8080/some/page?q=test',
      })
      const resolve = createMockResolve()

      try {
        await handle({ event, resolve })
        // Should have thrown a redirect
        expect.fail('Expected a redirect to be thrown')
      } catch (err) {
        expect(isRedirect(err)).toBe(true)
        if (isRedirect(err)) {
          expect(err.status).toBe(302)
          expect(err.location).toBe('http://127.0.0.1:8080/some/page?q=test')
        }
      }
    })

    it('does not redirect when hostname already matches canonical host', async () => {
      mockDev = true
      mockPublicInstanceUrl = 'http://127.0.0.1:8080'

      const cookies = createMockCookies({})
      const event = createMockEvent({
        cookies,
        url: 'http://127.0.0.1:8080/some/page',
      })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      // Should proceed normally without redirect
      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })

    it('does not redirect when dev=false even if hostname mismatches', async () => {
      mockDev = false
      mockPublicInstanceUrl = 'http://127.0.0.1:8080'

      const cookies = createMockCookies({})
      const event = createMockEvent({
        cookies,
        url: 'http://localhost:8080/',
      })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      // Should proceed normally without redirect
      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })

    it('does not redirect when PUBLIC_INSTANCE_URL is not set', async () => {
      mockDev = true
      mockPublicInstanceUrl = undefined

      const cookies = createMockCookies({})
      const event = createMockEvent({
        cookies,
        url: 'http://localhost:8080/',
      })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(resolve).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ transformPageChunk: expect.any(Function) }),
      )
    })
  })
})

describe('hooks.server request id', () => {
  // crypto.randomUUID() emits a v4 UUID; anything else (including the
  // non-uuid default in createMockEvent) fails this.
  const UUID_V4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  beforeEach(() => {
    vi.clearAllMocks()
    mockPublicInternalInstance = 'http://localhost:4000'
    mockPublicInstanceUrl = undefined
    mockDev = false
  })

  it('assigns a uuid request id to locals on every request', async () => {
    const event = createMockEvent({ cookies: createMockCookies() })

    await handle({ event, resolve: createMockResolve() })

    expect(typeof event.locals.requestId).toBe('string')
    expect(event.locals.requestId).toMatch(UUID_V4)
  })

  it('sets the x-request-id response header to that same id', async () => {
    const event = createMockEvent({ cookies: createMockCookies() })

    await handle({ event, resolve: createMockResolve() })

    expect(event.setHeaders).toHaveBeenCalledWith({
      'x-request-id': event.locals.requestId,
    })
  })

  it('gives two requests different ids', async () => {
    const first = createMockEvent({ cookies: createMockCookies() })
    const second = createMockEvent({ cookies: createMockCookies() })

    await handle({ event: first, resolve: createMockResolve() })
    await handle({ event: second, resolve: createMockResolve() })

    expect(first.locals.requestId).toMatch(UUID_V4)
    expect(second.locals.requestId).toMatch(UUID_V4)
    expect(first.locals.requestId).not.toBe(second.locals.requestId)
  })

  it('carries the request id on the production /util 404 early return', async () => {
    const event = createMockEvent({
      cookies: createMockCookies(),
      url: 'http://localhost:5173/util/photonify',
    })

    const response = await handle({ event, resolve: createMockResolve() })

    expect(response.status).toBe(404)
    expect(event.locals.requestId).toMatch(UUID_V4)
    expect(response.headers.get('x-request-id')).toBe(event.locals.requestId)
  })
})

describe('hooks.server handleError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDev = false
    mockLogStacks = undefined
  })

  it('returns "Not found" for 404 errors', async () => {
    const result = await handleError({
      error: new Error('Page not found'),
      event: createMockEvent({ cookies: createMockCookies() }),
      status: 404,
      message: 'Not Found',
    })

    expect(result).toEqual({ message: 'Not found' })
  })

  it('returns generic error message for non-404 errors', async () => {
    const result = await handleError({
      error: new Error(
        'Internal database connection failed with password xyz123',
      ),
      event: createMockEvent({ cookies: createMockCookies() }),
      status: 500,
      message: 'Internal Server Error',
    })

    expect(result).toEqual({ message: 'An unexpected error occurred' })
  })

  it('does not expose internal error details in response', async () => {
    const sensitiveError = new Error(
      'Database password: secret123, API key: abc-def-ghi',
    )
    const result = await handleError({
      error: sensitiveError,
      event: createMockEvent({ cookies: createMockCookies() }),
      status: 500,
      message: 'Internal Server Error',
    })

    const appError = result as App.Error
    expect(appError.message).not.toContain('secret123')
    expect(appError.message).not.toContain('abc-def-ghi')
    expect(appError.message).not.toContain('password')
    expect(appError.message).toBe('An unexpected error occurred')
  })

  it('handles errors without message property', async () => {
    const result = await handleError({
      error: 'String error without message property',
      event: createMockEvent({ cookies: createMockCookies() }),
      status: 500,
      message: 'Internal Server Error',
    })

    expect(result).toEqual({ message: 'An unexpected error occurred' })
  })

  it('returns generic message for 400 errors', async () => {
    const result = await handleError({
      error: new Error('Bad request: invalid JSON'),
      event: createMockEvent({ cookies: createMockCookies() }),
      status: 400,
      message: 'Bad Request',
    })

    expect(result).toEqual({ message: 'An unexpected error occurred' })
  })

  it('returns generic message for 403 errors', async () => {
    const result = await handleError({
      error: new Error('User not authorized for resource /admin/secrets'),
      event: createMockEvent({ cookies: createMockCookies() }),
      status: 403,
      message: 'Forbidden',
    })

    expect(result).toEqual({ message: 'An unexpected error occurred' })
  })

  describe('log sanitization', () => {
    const sealedToken = 'sealed-session-token-v1.super-secret-value'

    let errorSpy: ReturnType<typeof spyOnError>

    beforeEach(() => {
      errorSpy = spyOnError()
    })

    /**
     * Creates an event carrying the sealed session token in both places it
     * lives on a real authenticated request: the Cookie header and locals.auth.
     */
    function createEventWithToken(): RequestEvent {
      const cookies = createMockCookies({ coves_session: sealedToken })
      const event = createMockEvent({
        cookies,
        locals: {
          auth: {
            authenticated: true,
            account: {
              did: 'did:plc:test123',
              handle: 'test.example.com',
              pdsUrl: 'https://pds.example.com',
              sealedToken,
            },
            authToken: sealedToken,
          },
          requestId: 'req-sanitize-1',
        } as unknown as App.Locals,
      })
      // Replace the bare request with one that includes the session cookie
      // header, as the real server would receive it.
      Object.assign(event, {
        request: new Request(event.url, {
          headers: { Cookie: `coves_session=${sealedToken}` },
        }),
      })
      return event
    }

    /** Best-effort string form of a logged argument for content assertions. */
    function stringifyLoggedArg(arg: unknown): string {
      if (typeof arg === 'string') return arg
      try {
        return JSON.stringify(arg) ?? String(arg)
      } catch {
        return String(arg)
      }
    }

    it('never logs the event object or the session token for non-404 errors', async () => {
      const event = createEventWithToken()
      await handleError({
        error: new Error('Internal database connection failed'),
        event,
        status: 500,
        message: 'Internal Server Error',
      })

      expect(errorSpy).toHaveBeenCalled()
      for (const call of errorSpy.mock.calls) {
        for (const arg of call) {
          expect(arg).not.toBe(event)
          expect(stringifyLoggedArg(arg)).not.toContain(sealedToken)
        }
      }
    })

    it('does not call console.error for 404 errors', async () => {
      await handleError({
        error: new Error('Page not found'),
        event: createEventWithToken(),
        status: 404,
        message: 'Not Found',
      })

      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('logs the error stack for diagnostics in dev', async () => {
      mockDev = true

      const error = new Error('boom')
      await handleError({
        error,
        event: createEventWithToken(),
        status: 500,
        message: 'Internal Server Error',
      })

      // The stack now rides inside the single structured line rather than in
      // a second, raw console.error call.
      expect(error.stack).toBeDefined()
      const { raw, line } = singleJsonLine(errorSpy.mock.calls)
      const err = errOf(line)
      expect(typeof err.stack).toBe('string')
      expect(err.stack).toContain('Error: boom')
      expect(raw).not.toContain(sealedToken)
    })
  })
  describe('structured logging', () => {
    let errorSpy: ReturnType<typeof spyOnError>
    let warnSpy: ReturnType<typeof spyOnWarn>

    beforeEach(() => {
      errorSpy = spyOnError()
      warnSpy = spyOnWarn()
    })

    it('writes exactly one JSON line carrying the request context', async () => {
      const event = createMockEvent({
        cookies: createMockCookies(),
        url: 'http://localhost:5173/c/gardening',
      })

      await handleError({
        error: new Error('upstream refused password=hunter2'),
        event,
        status: 500,
        message: 'Internal Server Error',
      })

      expect(warnSpy).not.toHaveBeenCalled()
      const { raw, line } = singleJsonLine(errorSpy.mock.calls)
      expect(line).toMatchObject({
        level: 'error',
        status: 500,
        method: 'GET',
        path: '/c/gardening',
        requestId: event.locals.requestId,
      })
      expect(line.msg).toContain('Internal Server Error')
      expect(errOf(line)).toMatchObject({
        name: 'Error',
        message: 'upstream refused password=[REDACTED]',
      })
      expect(raw).not.toContain('hunter2')
    })

    it('includes the stack in production by default', async () => {
      await handleError({
        error: new Error('boom'),
        event: createMockEvent({ cookies: createMockCookies() }),
        status: 500,
        message: 'Internal Server Error',
      })

      const { line } = singleJsonLine(errorSpy.mock.calls)
      expect('stack' in errOf(line)).toBe(true)
      expect(typeof errOf(line).stack).toBe('string')
    })

    it("omits the stack in production when LOG_STACKS is '0'", async () => {
      mockLogStacks = '0'

      await handleError({
        error: new Error('boom'),
        event: createMockEvent({ cookies: createMockCookies() }),
        status: 500,
        message: 'Internal Server Error',
      })

      const { line } = singleJsonLine(errorSpy.mock.calls)
      expect('stack' in errOf(line)).toBe(false)
    })

    it('omits the requestId key entirely when locals carries none', async () => {
      // handleError can fire before hooks' handle() ran (or outside it), so an
      // absent id must be an absent key — never an empty string, which would
      // look like a real correlation id to a log search.
      await handleError({
        error: new Error('boom'),
        event: createMockEvent({
          cookies: createMockCookies(),
          locals: {} as unknown as App.Locals,
        }),
        status: 500,
        message: 'Internal Server Error',
      })

      const { line } = singleJsonLine(errorSpy.mock.calls)
      expect('requestId' in line).toBe(false)
    })

    it('includes the stack in dev', async () => {
      mockDev = true

      await handleError({
        error: new Error('boom'),
        event: createMockEvent({ cookies: createMockCookies() }),
        status: 500,
        message: 'Internal Server Error',
      })

      const { line } = singleJsonLine(errorSpy.mock.calls)
      expect('stack' in errOf(line)).toBe(true)
      expect(typeof errOf(line).stack).toBe('string')
    })

    it('writes nothing at all for a 404', async () => {
      await handleError({
        error: new Error('Page not found'),
        event: createMockEvent({ cookies: createMockCookies() }),
        status: 404,
        message: 'Not Found',
      })

      expect(errorSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  it('emits one scrubbed JSON log line with request context and leaks no secrets', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const secrets = ['hunter2', 'abc.def.ghi', 'SEALED123'] as const
      const error = new Error(
        'db connect failed: password=hunter2 authorization=Bearer abc.def.ghi coves_session=SEALED123',
      )
      // Overwrite the stack so it definitely carries the secrets too.
      error.stack = [
        'Error: db connect failed: password=hunter2 authorization=Bearer abc.def.ghi coves_session=SEALED123',
        '    at connect (src/lib/server/db.ts:10:5) password=hunter2',
        '    at handler (src/routes/+page.server.ts:3:1) Bearer abc.def.ghi coves_session=SEALED123',
      ].join('\n')

      const event = createMockEvent({
        cookies: createMockCookies(),
        locals: {
          auth: { authenticated: false },
          requestId: 'req-outer-1',
        } as unknown as App.Locals,
      })

      const result = await handleError({
        error,
        event,
        status: 500,
        message: 'Internal Server Error',
      })

      expect(result).toEqual({ message: 'An unexpected error occurred' })

      // Nothing written to either console channel may contain a secret.
      const logged = [...errorSpy.mock.calls, ...warnSpy.mock.calls]
        .flat()
        .map((arg) => {
          if (typeof arg === 'string') return arg
          try {
            return JSON.stringify(arg) ?? String(arg)
          } catch {
            return String(arg)
          }
        })
      for (const written of logged) {
        for (const secret of secrets) {
          expect(written).not.toContain(secret)
        }
      }

      // Exactly one structured line, carrying the request context.
      expect(errorSpy).toHaveBeenCalledTimes(1)
      const call = errorSpy.mock.calls[0]
      expect(call).toHaveLength(1)
      expect(typeof call[0]).toBe('string')
      const line: unknown = JSON.parse(call[0] as string)
      expect(line).toMatchObject({
        level: 'error',
        status: 500,
        method: 'GET',
        path: event.url.pathname,
        requestId: 'req-outer-1',
      })
    } finally {
      errorSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})

describe('hooks.server /api/me failure logging', () => {
  // Carried inside each thrown error's message, to prove err.message is scrubbed.
  const SECRET_MESSAGE = 'upstream said Bearer SECRETTOK'
  const SCRUBBED_MESSAGE = 'upstream said Bearer [REDACTED]'

  let warnSpy: ReturnType<typeof spyOnWarn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockPublicInternalInstance = 'http://localhost:4000'
    mockPublicInstanceUrl = undefined
    mockDev = false
    mockLogStacks = undefined
    warnSpy = spyOnWarn()
  })

  it('logs a network failure as one scrubbed JSON line', async () => {
    mockFetch.mockRejectedValue(
      new TypeError(`fetch failed - ${SECRET_MESSAGE}`),
    )
    const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
    const event = createMockEvent({ cookies })

    await handle({ event, resolve: createMockResolve() })

    const { raw, line } = singleJsonLine(warnSpy.mock.calls)
    expect(line.level).toBe('warn')
    expect(line.msg).toContain('Network error calling /api/me')
    expect(line.requestId).toBe(event.locals.requestId)
    expect(errOf(line)).toMatchObject({
      name: 'TypeError',
      message: `fetch failed - ${SCRUBBED_MESSAGE}`,
    })
    expect(raw).not.toContain('SECRETTOK')
    expectOnlyStringArgs(warnSpy.mock.calls)
  })

  it('logs a JSON parse failure as one scrubbed JSON line', async () => {
    // handle() only touches ok/status/json(), so this minimal stand-in lets
    // the SyntaxError carry a secret of our choosing.
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.reject(new SyntaxError(`Unexpected token - ${SECRET_MESSAGE}`)),
    } as unknown as Response)
    const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
    const event = createMockEvent({ cookies })

    await handle({ event, resolve: createMockResolve() })

    const { raw, line } = singleJsonLine(warnSpy.mock.calls)
    expect(line.level).toBe('warn')
    expect(line.msg).toContain('/api/me returned invalid JSON')
    expect(line.requestId).toBe(event.locals.requestId)
    expect(errOf(line)).toMatchObject({
      name: 'SyntaxError',
      message: `Unexpected token - ${SCRUBBED_MESSAGE}`,
    })
    expect(raw).not.toContain('SECRETTOK')
    expectOnlyStringArgs(warnSpy.mock.calls)
  })

  it('logs an unexpected failure as one scrubbed JSON line', async () => {
    mockFetch.mockRejectedValue(new Error(`kaboom - ${SECRET_MESSAGE}`))
    const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
    const event = createMockEvent({ cookies })

    await handle({ event, resolve: createMockResolve() })

    const { raw, line } = singleJsonLine(warnSpy.mock.calls)
    expect(line.level).toBe('warn')
    expect(line.msg).toContain('Unexpected error calling /api/me')
    expect(line.requestId).toBe(event.locals.requestId)
    expect(errOf(line)).toMatchObject({
      name: 'Error',
      message: `kaboom - ${SCRUBBED_MESSAGE}`,
    })
    expect(raw).not.toContain('SECRETTOK')
    expectOnlyStringArgs(warnSpy.mock.calls)
  })
})

describe('hooks.server security headers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPublicInternalInstance = 'http://localhost:4000'
    mockPublicInstanceUrl = 'https://coves.social'
    mockDev = false
  })

  function csp(response: Response): Record<string, string> {
    return Object.fromEntries(
      (response.headers.get('content-security-policy') ?? '')
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const [name, ...rest] = d.split(/\s+/)
          return [name, rest.join(' ')]
        }),
    )
  }

  /**
   * Mimics Kit's page renderer: emits the nonce'd CSP and runs the
   * `transformPageChunk` option the wrapper passes through resolve().
   */
  function kitPageResolve(
    html = '<html></html>',
    extraHeaders: Record<string, string> = {},
  ) {
    return vi.fn(async (_event: unknown, opts?: ResolveOptions) => {
      const body =
        (await opts?.transformPageChunk?.({ html, done: true })) ?? html
      return new Response(body, {
        headers: {
          'content-type': 'text/html',
          'content-security-policy': "script-src 'self' 'nonce-kit123'",
          ...extraHeaders,
        },
      })
    })
  }

  it('hardens every response resolve() produces', async () => {
    const event = createMockEvent({ url: 'https://coves.social/api/whatever' })
    const resolve = vi
      .fn()
      .mockResolvedValue(
        new Response('{}', { headers: { 'content-type': 'application/json' } }),
      )

    const response = await handle({ event, resolve })

    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    )
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('permissions-policy')).toContain('camera=()')
    // Not a document: CSP is left to the resource itself.
    expect(response.headers.get('content-security-policy')).toBeNull()
  })

  it("completes Kit's nonce'd CSP on a page Kit rendered", async () => {
    const event = createMockEvent({ url: 'https://coves.social/' })
    const resolve = kitPageResolve()

    const response = await handle({ event, resolve })
    const policy = csp(response)

    expect(policy['script-src']).toBe("'self' 'nonce-kit123'")
    expect(policy['default-src']).toBe("'self'")
    expect(policy['img-src']).toBe(
      "'self' data: blob: https: https://coves.social",
    )
    expect(policy['media-src']).toBe(
      "'self' blob: https://coves.social https://pds.coves.me",
    )
    expect(policy['connect-src']).toBe("'self' https://coves.social")
    expect(policy['frame-ancestors']).toBe("'none'")
    expect(policy['upgrade-insecure-requests']).toBe('')
    expect(await response.text()).toBe('<html></html>')
  })

  it('preserves a transformPageChunk the inner handle asked for', async () => {
    const event = createMockEvent({ url: 'https://coves.social/' })
    const resolve = kitPageResolve('<p>x</p>')
    // The wrapper must chain, not replace, a caller-supplied transform.
    await handle({ event, resolve })
    const opts = resolve.mock.calls[0][1]
    expect(await opts?.transformPageChunk?.({ html: '<b>', done: true })).toBe(
      '<b>',
    )
  })

  it('denies all on HTML an endpoint or the proxy produced, whatever CSP it carries', async () => {
    const event = createMockEvent({ url: 'https://coves.social/api/proxy/x' })
    // Upstream HTML relayed with a permissive policy and even a forged
    // x-sveltekit-page header — transformPageChunk never fires, so it is not
    // a Kit page.
    const resolve = vi.fn().mockResolvedValue(
      new Response('<script>alert(1)</script>', {
        headers: {
          'content-type': 'text/html',
          'content-security-policy': "script-src 'self' 'unsafe-inline'",
          'x-sveltekit-page': 'true',
        },
      }),
    )

    const response = await handle({ event, resolve })
    const policy = csp(response)

    expect(policy['default-src']).toBe("'none'")
    expect(policy['script-src']).toBeUndefined()
    expect(response.headers.get('content-security-policy')).not.toContain(
      'unsafe-inline',
    )
  })

  it('omits upgrade-insecure-requests and opens HMR sources in plaintext dev', async () => {
    mockDev = true
    mockPublicInstanceUrl = 'http://127.0.0.1:8080'
    const event = createMockEvent({ url: 'http://127.0.0.1:8080/' })
    const resolve = kitPageResolve()

    const policy = csp(await handle({ event, resolve }))

    expect(policy['upgrade-insecure-requests']).toBeUndefined()
    expect(policy['style-src-elem']).toContain("'unsafe-inline'")
    expect(policy['connect-src']).toContain('ws:')
  })

  it('hardens the production /util 404 that bypasses resolve()', async () => {
    const event = createMockEvent({
      url: 'https://coves.social/util/photonify',
    })
    const resolve = createMockResolve()

    const response = await handle({ event, resolve })

    expect(response.status).toBe(404)
    expect(resolve).not.toHaveBeenCalled()
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('still lands headers on a response whose Headers are immutable', async () => {
    const event = createMockEvent({ url: 'https://coves.social/x' })
    const resolve = vi
      .fn()
      .mockResolvedValue(Response.redirect('https://coves.social/y', 302))

    const response = await handle({ event, resolve })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://coves.social/y')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('re-wraps an immutable HTML response without losing status, cookies or the nonce', async () => {
    const event = createMockEvent({ url: 'https://coves.social/' })
    const resolve = kitPageResolve('<html></html>', {
      'set-cookie': 'a=1',
    })
    // First set() on the real response throws like an immutable guard would.
    const spy = vi
      .spyOn(Headers.prototype, 'set')
      .mockImplementationOnce(() => {
        throw new TypeError('immutable')
      })

    const response = await handle({ event, resolve })
    spy.mockRestore()

    expect(response.headers.get('set-cookie')).toBe('a=1')
    expect(csp(response)['script-src']).toBe("'self' 'nonce-kit123'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('lets a TypeError that is not the immutable guard propagate', async () => {
    const event = createMockEvent({ url: 'https://coves.social/' })
    const resolve = kitPageResolve()
    const spy = vi.spyOn(Headers.prototype, 'set').mockImplementation(() => {
      throw new TypeError('bad header value')
    })

    await expect(handle({ event, resolve })).rejects.toThrow(/bad header value/)
    spy.mockRestore()
  })

  it('refuses to load at all with a malformed CSP_VIDEO_ORIGINS', async () => {
    mockCspVideoOrigins = 'javascript:alert(1)'
    vi.resetModules()
    await expect(import('./hooks.server')).rejects.toThrow(/javascript/)
    mockCspVideoOrigins = 'https://pds.coves.me'
    vi.resetModules()
  })
})
