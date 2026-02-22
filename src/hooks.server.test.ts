import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Cookies, Redirect, RequestEvent } from '@sveltejs/kit'

// Variable to control the mocked instance URL
let mockPublicInternalInstance: string | undefined = 'http://localhost:4000'
let mockPublicInstanceUrl: string | undefined = undefined

// Variable to control dev mode (default false to avoid hostname redirects in most tests)
let mockDev = false

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

// Import handle and handleError after mocking
const { handle, handleError } = await import('./hooks.server')

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Helper to create mock cookies
function createMockCookies(
  initialCookies: Record<string, string> = {},
): Cookies {
  const store = new Map(Object.entries(initialCookies))
  return {
    get: vi.fn((name: string) => store.get(name)),
    getAll: vi.fn(() =>
      Array.from(store.entries()).map(([name, value]) => ({ name, value })),
    ),
    set: vi.fn((name: string, value: string) => {
      store.set(name, value)
    }),
    delete: vi.fn((name: string) => {
      store.delete(name)
    }),
    serialize: vi.fn(),
  } as unknown as Cookies
}

/**
 * Creates a mock request event for testing.
 */
function createMockEvent(options: {
  cookies?: Cookies
  locals?: App.Locals
  url?: string
}): RequestEvent {
  const url = new URL(options.url ?? 'http://localhost:5173/')
  const defaultLocals: App.Locals = { auth: { authenticated: false } }
  return {
    request: new Request(url),
    cookies: options.cookies ?? createMockCookies(),
    url,
    locals: options.locals ?? defaultLocals,
    params: {},
    platform: undefined,
    route: { id: '/' },
    getClientAddress: () => '127.0.0.1',
    fetch: vi.fn(),
    isDataRequest: false,
    isSubRequest: false,
    setHeaders: vi.fn(),
  } as unknown as RequestEvent
}

/**
 * Checks if a thrown value is a SvelteKit Redirect.
 * SvelteKit's `redirect()` throws an object with `status` and `location` properties.
 */
function isRedirect(err: unknown): err is Redirect {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    'location' in err
  )
}

/**
 * Creates a mock resolve function that returns a Response
 */
function createMockResolve() {
  return vi.fn().mockResolvedValue(new Response('OK'))
}

describe('hooks.server handle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPublicInternalInstance = 'http://localhost:4000'
    mockPublicInstanceUrl = undefined
    mockDev = false
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
      expect(resolve).toHaveBeenCalledWith(event)
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
      expect(resolve).toHaveBeenCalledWith(event)
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
      expect(resolve).toHaveBeenCalledWith(event)
    })
  })

  describe('valid cookie and /api/me returns 401', () => {
    it('results in unauthenticated state without console.warn', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      mockFetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }))

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(false)
      // Should NOT log a warning for 401 (expected case)
      expect(warnSpy).not.toHaveBeenCalled()
      expect(resolve).toHaveBeenCalledWith(event)

      warnSpy.mockRestore()
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
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      mockFetch.mockResolvedValue(
        new Response('Internal Server Error', { status: 500 }),
      )

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(false)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/me returned 500'),
      )
      expect(resolve).toHaveBeenCalledWith(event)

      warnSpy.mockRestore()
    })
  })

  describe('valid cookie and fetch throws network error', () => {
    it('sets authError to network_error for connection refused', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      mockFetch.mockRejectedValue(
        new Error('Network error: connection refused'),
      )

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(false)
      expect(event.locals.authError).toBe('network_error')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Network error calling /api/me'),
        expect.any(Error),
      )
      expect(resolve).toHaveBeenCalledWith(event)

      warnSpy.mockRestore()
    })

    it('sets authError to network_error for TypeError (fetch failure)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      mockFetch.mockRejectedValue(new TypeError('fetch failed'))

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(false)
      expect(event.locals.authError).toBe('network_error')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Network error calling /api/me'),
        expect.any(TypeError),
      )
      expect(resolve).toHaveBeenCalledWith(event)

      warnSpy.mockRestore()
    })

    it('does not delete the coves_session cookie on network error', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      mockFetch.mockRejectedValue(new TypeError('fetch failed'))

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(cookies.delete).not.toHaveBeenCalled()
    })

    it('sets authError to network_error for unexpected non-network errors', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      mockFetch.mockRejectedValue(new Error('some completely unexpected error'))

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(false)
      expect(event.locals.authError).toBe('network_error')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unexpected error calling /api/me'),
        expect.any(Error),
      )
      expect(resolve).toHaveBeenCalledWith(event)

      warnSpy.mockRestore()
    })
  })

  describe('valid cookie and /api/me returns invalid JSON', () => {
    it('sets authError to validation_error and logs warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

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
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/me returned invalid JSON'),
        expect.any(SyntaxError),
      )
      expect(resolve).toHaveBeenCalledWith(event)

      warnSpy.mockRestore()
    })
  })

  describe('valid cookie and /api/me returns incomplete data', () => {
    it('sets authError to validation_error when did is missing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

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
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/me response failed validation'),
      )
      expect(resolve).toHaveBeenCalledWith(event)

      warnSpy.mockRestore()
    })

    it('sets authError to validation_error when handle is missing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ did: 'did:plc:user1' }), { status: 200 }),
      )

      const cookies = createMockCookies({ coves_session: 'sealed-token-value' })
      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(false)
      expect(event.locals.authError).toBe('validation_error')
      expect(resolve).toHaveBeenCalledWith(event)

      warnSpy.mockRestore()
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
      expect(resolve).toHaveBeenCalledWith(event)
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
      expect(resolve).toHaveBeenCalledWith(event)
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
      expect(resolve).toHaveBeenCalledWith(event)
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

      expect(resolve).toHaveBeenCalledWith(event)
    })
  })
})

describe('hooks.server handleError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
