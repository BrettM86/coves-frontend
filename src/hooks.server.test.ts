import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Cookies, RequestEvent } from '@sveltejs/kit'
import {
  asDID,
  asHandle,
  asInstanceURL,
  asSealedToken,
  asSessionId,
  type AppSession,
  type AccountId,
} from '$lib/server/session'

// 32-byte hex key (64 characters) for testing
const TEST_SECRET = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

// Valid AccountIds (32 hex characters) for testing
const TEST_ACCOUNT_ID_1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1' as AccountId
const TEST_ACCOUNT_ID_2 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2' as AccountId

// Variable to control the mocked SESSION_SECRET
let mockSessionSecret: string | undefined = TEST_SECRET

// Mock environment variables
vi.mock('$env/dynamic/private', () => ({
  env: {
    get SESSION_SECRET() {
      return mockSessionSecret
    },
  },
}))

// Mock decryptSession to control its behavior in tests
const mockDecryptSession = vi.fn()

vi.mock('$lib/server/session', async () => {
  const actual = await vi.importActual('$lib/server/session')
  return {
    ...actual,
    decryptSession: (...args: unknown[]) => mockDecryptSession(...args),
  }
})

// Import handle and handleError after mocking
const { handle, handleError } = await import('./hooks.server')

// Helper to create mock cookies
function createMockCookies(initialCookies: Record<string, string> = {}): Cookies {
  const store = new Map(Object.entries(initialCookies))
  return {
    get: vi.fn((name: string) => store.get(name)),
    getAll: vi.fn(() =>
      Array.from(store.entries()).map(([name, value]) => ({ name, value }))
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
}): RequestEvent {
  const url = new URL('http://localhost:5173/')
  // Default to unauthenticated state
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
 * Creates a mock resolve function that returns a Response
 */
function createMockResolve() {
  return vi.fn().mockResolvedValue(new Response('OK'))
}

describe('hooks.server handle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSessionSecret = TEST_SECRET
  })

  describe('valid session cookie', () => {
    it('populates event.locals with session data when valid session cookie exists', async () => {
      const session: AppSession = {
        activeAccountId: TEST_ACCOUNT_ID_1,
        accounts: [
          {
            id: TEST_ACCOUNT_ID_1,
            did: asDID('did:plc:user1'),
            handle: asHandle('user1.example.com'),
            instance: asInstanceURL('https://coves.example.com'),
            sealedToken: asSealedToken('sealed-token-123'),
            sessionId: asSessionId('session-1'),
            avatar: 'https://example.com/avatar.png',
          },
        ],
      }

      mockDecryptSession.mockReturnValue(session)

      const cookies = createMockCookies({
        kelp_session: 'encrypted-session-cookie',
      })

      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(mockDecryptSession).toHaveBeenCalledWith('encrypted-session-cookie', TEST_SECRET)
      expect(event.locals.auth.authenticated).toBe(true)
      if (event.locals.auth.authenticated) {
        expect(event.locals.auth.session).toEqual(session)
        expect(event.locals.auth.activeAccount).toEqual(session.accounts[0])
        expect(event.locals.auth.authToken).toBe('sealed-token-123')
      }
      expect(resolve).toHaveBeenCalledWith(event)
    })

    it('populates event.locals with correct account when multiple accounts exist', async () => {
      const session: AppSession = {
        activeAccountId: TEST_ACCOUNT_ID_2,
        accounts: [
          {
            id: TEST_ACCOUNT_ID_1,
            did: asDID('did:plc:user1'),
            handle: asHandle('user1.example.com'),
            instance: asInstanceURL('https://coves.example.com'),
            sealedToken: asSealedToken('token-1'),
            sessionId: asSessionId('session-1'),
          },
          {
            id: TEST_ACCOUNT_ID_2,
            did: asDID('did:plc:user2'),
            handle: asHandle('user2.example.com'),
            instance: asInstanceURL('https://coves.example.com'),
            sealedToken: asSealedToken('token-2'),
            sessionId: asSessionId('session-2'),
          },
        ],
      }

      mockDecryptSession.mockReturnValue(session)

      const cookies = createMockCookies({
        kelp_session: 'encrypted-session-cookie',
      })

      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(true)
      if (event.locals.auth.authenticated) {
        expect(event.locals.auth.activeAccount.id).toBe(TEST_ACCOUNT_ID_2)
        expect(event.locals.auth.authToken).toBe('token-2')
      }
    })
  })

  describe('missing SESSION_SECRET', () => {
    it('throws fatal error when SESSION_SECRET is undefined and session cookie exists', async () => {
      mockSessionSecret = undefined

      const cookies = createMockCookies({
        kelp_session: 'encrypted-session-cookie',
      })

      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await expect(handle({ event, resolve })).rejects.toThrow(
        '[FATAL] SESSION_SECRET environment variable is not set'
      )

      expect(mockDecryptSession).not.toHaveBeenCalled()
    })

    it('throws fatal error when SESSION_SECRET is empty string and session cookie exists', async () => {
      mockSessionSecret = ''

      const cookies = createMockCookies({
        kelp_session: 'encrypted-session-cookie',
      })

      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await expect(handle({ event, resolve })).rejects.toThrow(
        '[FATAL] SESSION_SECRET environment variable is not set'
      )

      expect(mockDecryptSession).not.toHaveBeenCalled()
    })

    it('allows unauthenticated requests without session cookie when SESSION_SECRET is not set', async () => {
      mockSessionSecret = undefined

      const cookies = createMockCookies({})

      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      // Should not throw because no session cookie exists
      await handle({ event, resolve })

      expect(mockDecryptSession).not.toHaveBeenCalled()
      expect(event.locals.auth.authenticated).toBe(false)
      expect(resolve).toHaveBeenCalledWith(event)
    })
  })

  describe('invalid/malformed session cookie', () => {
    it('results in unauthenticated request when decryption returns null', async () => {
      mockDecryptSession.mockReturnValue(null)

      const cookies = createMockCookies({
        kelp_session: 'invalid-encrypted-data',
      })

      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(mockDecryptSession).toHaveBeenCalledWith('invalid-encrypted-data', TEST_SECRET)
      expect(event.locals.auth.authenticated).toBe(false)
      expect(resolve).toHaveBeenCalledWith(event)
    })

    it('clears corrupted session cookie when decryption fails', async () => {
      mockDecryptSession.mockReturnValue(null)

      const cookies = createMockCookies({
        kelp_session: 'corrupted-session-data',
      })

      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      // Verify the corrupted cookie is cleared by setting it to empty with maxAge: 0
      expect(cookies.set).toHaveBeenCalledWith('kelp_session', '', {
        path: '/',
        maxAge: 0,
      })
    })

    it('results in unauthenticated request when session cookie is missing', async () => {
      const cookies = createMockCookies({})

      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(mockDecryptSession).not.toHaveBeenCalled()
      expect(event.locals.auth.authenticated).toBe(false)
      expect(resolve).toHaveBeenCalledWith(event)
    })

    it('results in unauthenticated request when session cookie is empty string', async () => {
      const cookies = createMockCookies({
        kelp_session: '',
      })

      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      // Empty string is falsy, so decryptSession should not be called
      expect(mockDecryptSession).not.toHaveBeenCalled()
      expect(event.locals.auth.authenticated).toBe(false)
    })
  })

  describe('missing activeAccountId in session', () => {
    it('results in unauthenticated request when activeAccountId is null', async () => {
      const session: AppSession = {
        activeAccountId: null,
        accounts: [
          {
            id: TEST_ACCOUNT_ID_1,
            did: asDID('did:plc:user1'),
            handle: asHandle('user1.example.com'),
            instance: asInstanceURL('https://coves.example.com'),
            sealedToken: asSealedToken('sealed-token-123'),
            sessionId: asSessionId('session-1'),
          },
        ],
      }

      mockDecryptSession.mockReturnValue(session)

      const cookies = createMockCookies({
        kelp_session: 'encrypted-session-cookie',
      })

      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(mockDecryptSession).toHaveBeenCalled()
      expect(event.locals.auth.authenticated).toBe(false)
      expect(resolve).toHaveBeenCalledWith(event)
    })

    it('results in unauthenticated request when activeAccountId references non-existent account', async () => {
      const session: AppSession = {
        activeAccountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaff' as AccountId,
        accounts: [
          {
            id: TEST_ACCOUNT_ID_1,
            did: asDID('did:plc:user1'),
            handle: asHandle('user1.example.com'),
            instance: asInstanceURL('https://coves.example.com'),
            sealedToken: asSealedToken('sealed-token-123'),
            sessionId: asSessionId('session-1'),
          },
        ],
      }

      mockDecryptSession.mockReturnValue(session)

      const cookies = createMockCookies({
        kelp_session: 'encrypted-session-cookie',
      })

      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(mockDecryptSession).toHaveBeenCalled()
      expect(event.locals.auth.authenticated).toBe(false)
      expect(resolve).toHaveBeenCalledWith(event)
    })

    it('results in unauthenticated request when accounts array is empty', async () => {
      const session: AppSession = {
        activeAccountId: TEST_ACCOUNT_ID_1,
        accounts: [],
      }

      mockDecryptSession.mockReturnValue(session)

      const cookies = createMockCookies({
        kelp_session: 'encrypted-session-cookie',
      })

      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(mockDecryptSession).toHaveBeenCalled()
      expect(event.locals.auth.authenticated).toBe(false)
    })
  })

  describe('authToken population', () => {
    it('populates authToken with sealedToken from active account', async () => {
      const session: AppSession = {
        activeAccountId: TEST_ACCOUNT_ID_1,
        accounts: [
          {
            id: TEST_ACCOUNT_ID_1,
            did: asDID('did:plc:user1'),
            handle: asHandle('user1.example.com'),
            instance: asInstanceURL('https://coves.example.com'),
            sealedToken: asSealedToken('my-special-sealed-token'),
            sessionId: asSessionId('session-1'),
          },
        ],
      }

      mockDecryptSession.mockReturnValue(session)

      const cookies = createMockCookies({
        kelp_session: 'encrypted-session-cookie',
      })

      const event = createMockEvent({ cookies })
      const resolve = createMockResolve()

      await handle({ event, resolve })

      expect(event.locals.auth.authenticated).toBe(true)
      if (event.locals.auth.authenticated) {
        expect(event.locals.auth.authToken).toBe('my-special-sealed-token')
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
      error: new Error('Internal database connection failed with password xyz123'),
      event: createMockEvent({ cookies: createMockCookies() }),
      status: 500,
      message: 'Internal Server Error',
    })

    expect(result).toEqual({ message: 'An unexpected error occurred' })
  })

  it('does not expose internal error details in response', async () => {
    const sensitiveError = new Error('Database password: secret123, API key: abc-def-ghi')
    const result = await handleError({
      error: sensitiveError,
      event: createMockEvent({ cookies: createMockCookies() }),
      status: 500,
      message: 'Internal Server Error',
    })

    // The result should not contain any sensitive information
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
