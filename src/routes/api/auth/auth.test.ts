import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Cookies, RequestEvent } from '@sveltejs/kit'
import type { Redirect } from '@sveltejs/kit'
import { POST as loginHandler } from './login/+server'
import { GET as callbackHandler } from './callback/+server'
import { POST as logoutHandler } from './logout/+server'
import { POST as switchHandler } from './switch/+server'
import {
  encryptSession,
  decryptSession,
  updateAccountByDid,
  asDID,
  asHandle,
  asInstanceURL,
  asSealedToken,
  asSessionId,
  type AppSession,
  type AccountId,
} from '$lib/server/session'
import { generateOAuthState } from '$lib/server/csrf'

// Type alias for any RequestEvent to simplify testing
 
type AnyRequestEvent = RequestEvent<any, any>

/**
 * Helper to check if an error is a SvelteKit Redirect
 */
function isRedirect(error: unknown): error is Redirect {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'location' in error &&
    (error as Redirect).status >= 300 &&
    (error as Redirect).status < 400
  )
}

// 32-byte hex key (64 characters) for testing
const TEST_SECRET = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

// Valid AccountIds (32 hex characters) for testing
const TEST_ACCOUNT_ID_1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1' as AccountId
const TEST_ACCOUNT_ID_2 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2' as AccountId
const TEST_ACCOUNT_EXISTING = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb01' as AccountId
const TEST_ACCOUNT_TARGET = 'cccccccccccccccccccccccccccccc01' as AccountId
const TEST_ACCOUNT_OTHER = 'dddddddddddddddddddddddddddddd01' as AccountId

// Mock environment variables
vi.mock('$env/dynamic/private', () => ({
  env: {
    SESSION_SECRET: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  },
}))

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
 * Uses AnyRequestEvent to avoid strict route typing issues in tests.
 */
function createMockEvent(options: {
  method?: string
  body?: unknown
  cookies?: Cookies
  url?: string
  locals?: App.Locals
  headers?: Record<string, string>
}): AnyRequestEvent {
  const url = new URL(options.url ?? 'http://localhost:5173/api/auth/test')
  // Default to unauthenticated state
  const defaultLocals: App.Locals = { auth: { authenticated: false } }
  return {
    request: new Request(url, {
      method: options.method ?? 'GET',
      body: options.body ? JSON.stringify(options.body) : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    }),
    cookies: options.cookies ?? createMockCookies(),
    url,
    locals: options.locals ?? defaultLocals,
    params: {},
    platform: undefined,
    route: { id: '/api/auth/test' },
    getClientAddress: () => '127.0.0.1',
    fetch: vi.fn(),
    isDataRequest: false,
    isSubRequest: false,
    setHeaders: vi.fn(),
  } as unknown as AnyRequestEvent
}

/**
 * Helper to create authenticated App.Locals from a session.
 * Finds the active account from the session and constructs the proper auth state.
 */
function createAuthenticatedLocals(session: AppSession): App.Locals {
  const activeAccount = session.accounts.find((a) => a.id === session.activeAccountId)
  if (!activeAccount) {
    // Fallback to first account if activeAccountId doesn't match
    const fallbackAccount = session.accounts[0]
    if (!fallbackAccount) {
      return { auth: { authenticated: false } }
    }
    return {
      auth: {
        authenticated: true,
        session,
        activeAccount: fallbackAccount,
        authToken: fallbackAccount.sealedToken,
      },
    }
  }
  return {
    auth: {
      authenticated: true,
      session,
      activeAccount,
      authToken: activeAccount.sealedToken,
    },
  }
}

// Mock fetch for Coves API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns OAuth redirect URL for valid handle/instance', async () => {
    const cookies = createMockCookies()
    const event = createMockEvent({
      method: 'POST',
      body: {
        handle: 'user.example.com',
        instance: 'https://coves.example.com',
      },
      cookies,
      url: 'http://localhost:5173/api/auth/login',
    })

    const response = await loginHandler(event)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.redirectUrl).toContain('https://coves.example.com/oauth/login')
    expect(data.redirectUrl).toContain('handle=user.example.com')
    expect(data.redirectUrl).toContain('redirect_uri=')
  })

  it('stores pending auth state in cookie', async () => {
    const cookies = createMockCookies()
    const event = createMockEvent({
      method: 'POST',
      body: {
        handle: 'user.example.com',
        instance: 'https://coves.example.com',
        redirect: '/community/test',
      },
      cookies,
      url: 'http://localhost:5173/api/auth/login',
    })

    await loginHandler(event)

    expect(cookies.set).toHaveBeenCalledWith(
      'kelp_pending_auth',
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        // secure is false in test environment (import.meta.env.PROD is false)
        secure: false,
        sameSite: 'lax',
        path: '/',
      })
    )
  })

  it('returns 400 for missing handle', async () => {
    const event = createMockEvent({
      method: 'POST',
      body: {
        instance: 'https://coves.example.com',
      },
    })

    const response = await loginHandler(event)
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toContain('handle')
  })

  it('returns 400 for missing instance', async () => {
    const event = createMockEvent({
      method: 'POST',
      body: {
        handle: 'user.example.com',
      },
    })

    const response = await loginHandler(event)
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toContain('instance')
  })

  describe('open redirect prevention', () => {
    it('accepts valid relative URLs starting with single slash', async () => {
      const cookies = createMockCookies()
      const event = createMockEvent({
        method: 'POST',
        body: {
          handle: 'user.example.com',
          instance: 'https://coves.example.com',
          redirect: '/community/test?foo=bar#section',
        },
        cookies,
        url: 'http://localhost:5173/api/auth/login',
      })

      await loginHandler(event)

      // Verify the redirect was stored in pending auth cookie
      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth'
      )
      expect(pendingAuthCall).toBeDefined()
      if (pendingAuthCall) {
        const pendingAuth = JSON.parse(pendingAuthCall[1] as string)
        expect(pendingAuth.redirect).toBe('/community/test?foo=bar#section')
      }
    })

    it('rejects absolute URLs to external domains', async () => {
      const cookies = createMockCookies()
      const event = createMockEvent({
        method: 'POST',
        body: {
          handle: 'user.example.com',
          instance: 'https://coves.example.com',
          redirect: 'https://evil.com/steal-tokens',
        },
        cookies,
        url: 'http://localhost:5173/api/auth/login',
      })

      await loginHandler(event)

      // Verify the redirect was sanitized to '/'
      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth'
      )
      expect(pendingAuthCall).toBeDefined()
      if (pendingAuthCall) {
        const pendingAuth = JSON.parse(pendingAuthCall[1] as string)
        expect(pendingAuth.redirect).toBe('/')
      }
    })

    it('rejects protocol-relative URLs with // prefix', async () => {
      const cookies = createMockCookies()
      const event = createMockEvent({
        method: 'POST',
        body: {
          handle: 'user.example.com',
          instance: 'https://coves.example.com',
          redirect: '//evil.com/steal-tokens',
        },
        cookies,
        url: 'http://localhost:5173/api/auth/login',
      })

      await loginHandler(event)

      // Verify the redirect was sanitized to '/'
      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth'
      )
      expect(pendingAuthCall).toBeDefined()
      if (pendingAuthCall) {
        const pendingAuth = JSON.parse(pendingAuthCall[1] as string)
        expect(pendingAuth.redirect).toBe('/')
      }
    })

    it('rejects URLs with backslash prefix (bypass attempt)', async () => {
      const cookies = createMockCookies()
      const event = createMockEvent({
        method: 'POST',
        body: {
          handle: 'user.example.com',
          instance: 'https://coves.example.com',
          redirect: '\\\\evil.com/steal-tokens',
        },
        cookies,
        url: 'http://localhost:5173/api/auth/login',
      })

      await loginHandler(event)

      // Verify the redirect was sanitized to '/'
      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth'
      )
      expect(pendingAuthCall).toBeDefined()
      if (pendingAuthCall) {
        const pendingAuth = JSON.parse(pendingAuthCall[1] as string)
        expect(pendingAuth.redirect).toBe('/')
      }
    })

    it('rejects URLs with /\\ prefix (backslash bypass variant)', async () => {
      const cookies = createMockCookies()
      const event = createMockEvent({
        method: 'POST',
        body: {
          handle: 'user.example.com',
          instance: 'https://coves.example.com',
          redirect: '/\\evil.com',
        },
        cookies,
        url: 'http://localhost:5173/api/auth/login',
      })

      await loginHandler(event)

      // Verify the redirect was sanitized to '/'
      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth'
      )
      expect(pendingAuthCall).toBeDefined()
      if (pendingAuthCall) {
        const pendingAuth = JSON.parse(pendingAuthCall[1] as string)
        expect(pendingAuth.redirect).toBe('/')
      }
    })

    it('accepts same-origin absolute URLs and extracts path', async () => {
      const cookies = createMockCookies()
      const event = createMockEvent({
        method: 'POST',
        body: {
          handle: 'user.example.com',
          instance: 'https://coves.example.com',
          redirect: 'http://localhost:5173/community/safe',
        },
        cookies,
        url: 'http://localhost:5173/api/auth/login',
      })

      await loginHandler(event)

      // Verify the redirect was accepted (path extracted)
      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth'
      )
      expect(pendingAuthCall).toBeDefined()
      if (pendingAuthCall) {
        const pendingAuth = JSON.parse(pendingAuthCall[1] as string)
        expect(pendingAuth.redirect).toBe('/community/safe')
      }
    })
  })

  describe('CSRF state parameter (RFC 9700)', () => {
    it('generates and stores state in pending auth cookie', async () => {
      const cookies = createMockCookies()
      const event = createMockEvent({
        method: 'POST',
        body: {
          handle: 'user.example.com',
          instance: 'https://coves.example.com',
        },
        cookies,
        url: 'http://localhost:5173/api/auth/login',
      })

      await loginHandler(event)

      // Verify state was stored in pending auth cookie
      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth'
      )
      expect(pendingAuthCall).toBeDefined()
      if (pendingAuthCall) {
        const pendingAuth = JSON.parse(pendingAuthCall[1] as string)
        expect(pendingAuth.state).toBeDefined()
        expect(typeof pendingAuth.state).toBe('string')
        // State should be 64-character hex string (32 bytes)
        expect(pendingAuth.state).toMatch(/^[a-f0-9]{64}$/)
      }
    })

    it('includes state parameter in OAuth redirect URL', async () => {
      const cookies = createMockCookies()
      const event = createMockEvent({
        method: 'POST',
        body: {
          handle: 'user.example.com',
          instance: 'https://coves.example.com',
        },
        cookies,
        url: 'http://localhost:5173/api/auth/login',
      })

      const response = await loginHandler(event)
      const data = await response.json()

      // Verify state is included in OAuth URL
      expect(data.redirectUrl).toContain('state=')
      const redirectUrl = new URL(data.redirectUrl)
      const state = redirectUrl.searchParams.get('state')
      expect(state).toBeDefined()
      expect(state).toMatch(/^[a-f0-9]{64}$/)
    })

    it('state in cookie matches state in OAuth URL', async () => {
      const cookies = createMockCookies()
      const event = createMockEvent({
        method: 'POST',
        body: {
          handle: 'user.example.com',
          instance: 'https://coves.example.com',
        },
        cookies,
        url: 'http://localhost:5173/api/auth/login',
      })

      const response = await loginHandler(event)
      const data = await response.json()

      // Get state from OAuth URL
      const redirectUrl = new URL(data.redirectUrl)
      const urlState = redirectUrl.searchParams.get('state')

      // Get state from pending auth cookie
      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth'
      )
      expect(pendingAuthCall).toBeDefined()
      if (pendingAuthCall) {
        const pendingAuth = JSON.parse(pendingAuthCall[1] as string)
        expect(pendingAuth.state).toBe(urlState)
      }
    })

    it('generates unique state for each login request', async () => {
      const cookies1 = createMockCookies()
      const cookies2 = createMockCookies()
      const event1 = createMockEvent({
        method: 'POST',
        body: {
          handle: 'user.example.com',
          instance: 'https://coves.example.com',
        },
        cookies: cookies1,
        url: 'http://localhost:5173/api/auth/login',
      })
      const event2 = createMockEvent({
        method: 'POST',
        body: {
          handle: 'user.example.com',
          instance: 'https://coves.example.com',
        },
        cookies: cookies2,
        url: 'http://localhost:5173/api/auth/login',
      })

      await loginHandler(event1)
      await loginHandler(event2)

      // Get states from both requests
      const setCalls1 = (cookies1.set as ReturnType<typeof vi.fn>).mock.calls
      const setCalls2 = (cookies2.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuth1 = JSON.parse(
        setCalls1.find((call) => call[0] === 'kelp_pending_auth')?.[1] as string
      )
      const pendingAuth2 = JSON.parse(
        setCalls2.find((call) => call[0] === 'kelp_pending_auth')?.[1] as string
      )

      // States should be different
      expect(pendingAuth1.state).not.toBe(pendingAuth2.state)
    })
  })
})

describe('GET /api/auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads coves_session cookie and creates kelp session', async () => {
    const testState = generateOAuthState()
    const cookies = createMockCookies({
      coves_session: 'mock-coves-session-token',
      kelp_pending_auth: JSON.stringify({
        instance: 'https://coves.example.com',
        redirect: '/',
        state: testState,
      }),
    })

    // Mock the Coves /api/me response
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          did: 'did:plc:abc123',
          handle: 'user.example.com',
          sessionId: asSessionId('session-123'),
          sealedToken: asSealedToken('sealed-token-xyz'),
          avatar: 'https://cdn.example.com/avatar.jpg',
        }),
        { status: 200 }
      )
    )

    const event = createMockEvent({
      method: 'GET',
      cookies,
      url: `http://localhost:5173/api/auth/callback?state=${testState}`,
    })

    try {
      await callbackHandler(event)
      expect.fail('Expected redirect to be thrown')
    } catch (error) {
      expect(isRedirect(error)).toBe(true)
      if (isRedirect(error)) {
        expect(error.status).toBe(302)
        expect(error.location).toBe('/')
      }
    }

    expect(cookies.set).toHaveBeenCalledWith(
      'kelp_session',
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        // secure is false in test environment (import.meta.env.PROD is false)
        secure: false,
      })
    )
  })

  it('redirects to stored redirect URL on success', async () => {
    const testState = generateOAuthState()
    const cookies = createMockCookies({
      coves_session: 'mock-coves-session-token',
      kelp_pending_auth: JSON.stringify({
        instance: 'https://coves.example.com',
        redirect: '/community/test',
        state: testState,
      }),
    })

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          did: 'did:plc:abc123',
          handle: 'user.example.com',
          sessionId: asSessionId('session-123'),
          sealedToken: asSealedToken('sealed-token-xyz'),
        }),
        { status: 200 }
      )
    )

    const event = createMockEvent({
      method: 'GET',
      cookies,
      url: `http://localhost:5173/api/auth/callback?state=${testState}`,
    })

    try {
      await callbackHandler(event)
      expect.fail('Expected redirect to be thrown')
    } catch (error) {
      expect(isRedirect(error)).toBe(true)
      if (isRedirect(error)) {
        expect(error.status).toBe(302)
        expect(error.location).toBe('/community/test')
      }
    }
  })

  it('redirects to /login on missing coves_session', async () => {
    const cookies = createMockCookies({
      kelp_pending_auth: JSON.stringify({
        instance: 'https://coves.example.com',
        redirect: '/',
      }),
    })

    const event = createMockEvent({
      method: 'GET',
      cookies,
      url: 'http://localhost:5173/api/auth/callback',
    })

    try {
      await callbackHandler(event)
      expect.fail('Expected redirect to be thrown')
    } catch (error) {
      expect(isRedirect(error)).toBe(true)
      if (isRedirect(error)) {
        expect(error.status).toBe(302)
        expect(error.location).toBe('/login?error=no_session')
      }
    }
  })

  it('redirects to /login with error when pending auth has empty instance', async () => {
    const cookies = createMockCookies({
      coves_session: 'mock-coves-session-token',
      kelp_pending_auth: JSON.stringify({
        instance: '',  // Empty instance
        redirect: '/community/test',
      }),
    })

    const event = createMockEvent({
      method: 'GET',
      cookies,
      url: 'http://localhost:5173/api/auth/callback',
    })

    try {
      await callbackHandler(event)
      expect.fail('Expected redirect to be thrown')
    } catch (error) {
      expect(isRedirect(error)).toBe(true)
      if (isRedirect(error)) {
        expect(error.status).toBe(302)
        expect(error.location).toBe('/login?error=no_pending_auth')
      }
    }
  })

  it('redirects to /login with error when pending auth is missing instance field', async () => {
    const cookies = createMockCookies({
      coves_session: 'mock-coves-session-token',
      kelp_pending_auth: JSON.stringify({
        // Missing instance field entirely
        redirect: '/community/test',
      }),
    })

    const event = createMockEvent({
      method: 'GET',
      cookies,
      url: 'http://localhost:5173/api/auth/callback',
    })

    try {
      await callbackHandler(event)
      expect.fail('Expected redirect to be thrown')
    } catch (error) {
      expect(isRedirect(error)).toBe(true)
      if (isRedirect(error)) {
        expect(error.status).toBe(302)
        expect(error.location).toBe('/login?error=no_pending_auth')
      }
    }
  })

  it('handles multi-account (adds to existing session)', async () => {
    const testState = generateOAuthState()
    const existingSession: AppSession = {
      activeAccountId: TEST_ACCOUNT_EXISTING,
      accounts: [
        {
          id: TEST_ACCOUNT_EXISTING,
          did: asDID('did:plc:existing'),
          handle: asHandle('existing.example.com'),
          instance: asInstanceURL('https://coves.example.com'),
          sealedToken: asSealedToken('existing-token'),
          sessionId: asSessionId('existing-session'),
        },
      ],
    }

    const encryptedSession = encryptSession(existingSession, TEST_SECRET)

    const cookies = createMockCookies({
      coves_session: 'mock-coves-session-token',
      kelp_session: encryptedSession,
      kelp_pending_auth: JSON.stringify({
        instance: 'https://coves.example.com',
        redirect: '/',
        state: testState,
      }),
    })

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          did: 'did:plc:newuser',
          handle: 'newuser.example.com',
          sessionId: asSessionId('new-session-123'),
          sealedToken: asSealedToken('new-sealed-token'),
        }),
        { status: 200 }
      )
    )

    const event = createMockEvent({
      method: 'GET',
      cookies,
      url: `http://localhost:5173/api/auth/callback?state=${testState}`,
    })

    try {
      await callbackHandler(event)
      expect.fail('Expected redirect to be thrown')
    } catch (error) {
      expect(isRedirect(error)).toBe(true)
      if (isRedirect(error)) {
        expect(error.status).toBe(302)
      }
    }

    // Verify new session was set with multiple accounts
    const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
    const sessionSetCall = setCalls.find(
      (call) => call[0] === 'kelp_session'
    )
    expect(sessionSetCall).toBeDefined()

    if (sessionSetCall) {
      const newEncryptedSession = sessionSetCall[1] as string
      const newSession = decryptSession(newEncryptedSession, TEST_SECRET)
      expect(newSession?.accounts).toHaveLength(2)
    }
  })

  describe('re-authentication with existing DID', () => {
    it('updates existing account instead of creating duplicate when re-authenticating', async () => {
      const testState = generateOAuthState()
      const existingSession: AppSession = {
        activeAccountId: TEST_ACCOUNT_EXISTING,
        accounts: [
          {
            id: TEST_ACCOUNT_EXISTING,
            did: asDID('did:plc:sameuser'),
            handle: asHandle('oldhandle.example.com'),
            instance: asInstanceURL('https://coves.example.com'),
            sealedToken: asSealedToken('old-token'),
            sessionId: asSessionId('old-session'),
            avatar: 'https://cdn.example.com/old-avatar.jpg',
          },
        ],
      }

      const encryptedSession = encryptSession(existingSession, TEST_SECRET)

      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_session: encryptedSession,
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      // Re-authenticate with same DID but updated info
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            did: 'did:plc:sameuser', // Same DID as existing account
            handle: 'newhandle.example.com', // Updated handle
            sessionId: asSessionId('new-session-123'), // New session
            sealedToken: asSealedToken('new-sealed-token'), // New token
            avatar: 'https://cdn.example.com/new-avatar.jpg', // Updated avatar
          }),
          { status: 200 }
        )
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
        }
      }

      // Verify session was updated (not duplicated)
      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const sessionSetCall = setCalls.find(
        (call) => call[0] === 'kelp_session'
      )
      expect(sessionSetCall).toBeDefined()

      if (sessionSetCall) {
        const newEncryptedSession = sessionSetCall[1] as string
        const newSession = decryptSession(newEncryptedSession, TEST_SECRET)

        // Should still have only one account (no duplicates)
        expect(newSession?.accounts).toHaveLength(1)

        // Account should have same ID (preserved)
        expect(newSession?.accounts[0].id).toBe(TEST_ACCOUNT_EXISTING)

        // Account should have same DID
        expect(newSession?.accounts[0].did).toBe('did:plc:sameuser')

        // Account should have updated fields
        expect(newSession?.accounts[0].handle).toBe('newhandle.example.com')
        expect(newSession?.accounts[0].sealedToken).toBe('new-sealed-token')
        expect(newSession?.accounts[0].sessionId).toBe('new-session-123')
        expect(newSession?.accounts[0].avatar).toBe('https://cdn.example.com/new-avatar.jpg')

        // Should be the active account
        expect(newSession?.activeAccountId).toBe(TEST_ACCOUNT_EXISTING)
      }
    })

    it('preserves instance when re-authenticating existing account', async () => {
      const testState = generateOAuthState()
      const existingSession: AppSession = {
        activeAccountId: TEST_ACCOUNT_ID_1,
        accounts: [
          {
            id: TEST_ACCOUNT_ID_1,
            did: asDID('did:plc:reauth'),
            handle: asHandle('user.example.com'),
            instance: asInstanceURL('https://original-instance.example.com'),
            sealedToken: asSealedToken('old-token'),
            sessionId: asSessionId('old-session'),
          },
        ],
      }

      const encryptedSession = encryptSession(existingSession, TEST_SECRET)

      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_session: encryptedSession,
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com', // Different instance in pending auth
          redirect: '/',
          state: testState,
        }),
      })

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            did: 'did:plc:reauth',
            handle: 'user.example.com',
            sessionId: asSessionId('new-session'),
            sealedToken: asSealedToken('new-token'),
          }),
          { status: 200 }
        )
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
      }

      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const sessionSetCall = setCalls.find(
        (call) => call[0] === 'kelp_session'
      )

      if (sessionSetCall) {
        const newSession = decryptSession(sessionSetCall[1] as string, TEST_SECRET)

        // Instance should be preserved from original account
        expect(newSession?.accounts[0].instance).toBe('https://original-instance.example.com')
      }
    })

    it('sets re-authenticated account as active even if different account was active', async () => {
      const testState = generateOAuthState()
      const existingSession: AppSession = {
        activeAccountId: TEST_ACCOUNT_OTHER, // Different account is active
        accounts: [
          {
            id: TEST_ACCOUNT_TARGET,
            did: asDID('did:plc:target'),
            handle: asHandle('target.example.com'),
            instance: asInstanceURL('https://coves.example.com'),
            sealedToken: asSealedToken('old-token'),
            sessionId: asSessionId('old-session'),
          },
          {
            id: TEST_ACCOUNT_OTHER,
            did: asDID('did:plc:other'),
            handle: asHandle('other.example.com'),
            instance: asInstanceURL('https://coves.example.com'),
            sealedToken: asSealedToken('other-token'),
            sessionId: asSessionId('other-session'),
          },
        ],
      }

      const encryptedSession = encryptSession(existingSession, TEST_SECRET)

      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_session: encryptedSession,
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      // Re-authenticate with the first account (not currently active)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            did: 'did:plc:target',
            handle: 'target.example.com',
            sessionId: asSessionId('refreshed-session'),
            sealedToken: asSealedToken('refreshed-token'),
          }),
          { status: 200 }
        )
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
      }

      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const sessionSetCall = setCalls.find(
        (call) => call[0] === 'kelp_session'
      )

      if (sessionSetCall) {
        const newSession = decryptSession(sessionSetCall[1] as string, TEST_SECRET)

        // Still have both accounts
        expect(newSession?.accounts).toHaveLength(2)

        // Re-authenticated account should now be active
        expect(newSession?.activeAccountId).toBe(TEST_ACCOUNT_TARGET)
      }
    })
  })

  describe('updateAccountByDid helper function', () => {
    it('returns null when DID does not exist in session', () => {
      const session: AppSession = {
        activeAccountId: TEST_ACCOUNT_ID_1,
        accounts: [
          {
            id: TEST_ACCOUNT_ID_1,
            did: asDID('did:plc:existing'),
            handle: asHandle('existing.example.com'),
            instance: asInstanceURL('https://coves.example.com'),
            sealedToken: asSealedToken('token'),
            sessionId: asSessionId('session'),
          },
        ],
      }

      const result = updateAccountByDid(session, asDID('did:plc:nonexistent'), {
        handle: asHandle('new.handle.com'),
      })

      expect(result).toBeNull()
    })

    it('returns updated session and accountId when DID exists', () => {
      const session: AppSession = {
        activeAccountId: null,
        accounts: [
          {
            id: TEST_ACCOUNT_ID_1,
            did: asDID('did:plc:existing'),
            handle: asHandle('old.handle.com'),
            instance: asInstanceURL('https://coves.example.com'),
            sealedToken: asSealedToken('old-token'),
            sessionId: asSessionId('old-session'),
          },
        ],
      }

      const result = updateAccountByDid(session, asDID('did:plc:existing'), {
        handle: asHandle('new.handle.com'),
        sealedToken: asSealedToken('new-token'),
      })

      expect(result).not.toBeNull()
      expect(result?.accountId).toBe(TEST_ACCOUNT_ID_1)
      expect(result?.session.accounts[0].handle).toBe('new.handle.com')
      expect(result?.session.accounts[0].sealedToken).toBe('new-token')
      expect(result?.session.activeAccountId).toBe(TEST_ACCOUNT_ID_1)
    })

    it('does not mutate original session', () => {
      const originalSession: AppSession = {
        activeAccountId: null,
        accounts: [
          {
            id: TEST_ACCOUNT_ID_1,
            did: asDID('did:plc:existing'),
            handle: asHandle('old.handle.com'),
            instance: asInstanceURL('https://coves.example.com'),
            sealedToken: asSealedToken('old-token'),
            sessionId: asSessionId('old-session'),
          },
        ],
      }

      updateAccountByDid(originalSession, asDID('did:plc:existing'), {
        handle: asHandle('new.handle.com'),
      })

      // Original session should be unchanged
      expect(originalSession.accounts[0].handle).toBe('old.handle.com')
      expect(originalSession.activeAccountId).toBeNull()
    })
  })

  describe('malformed user info response', () => {
    it('redirects to /login with error when did is missing', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            // Missing 'did'
            handle: 'user.example.com',
            sessionId: asSessionId('session-123'),
            sealedToken: asSealedToken('sealed-token-xyz'),
          }),
          { status: 200 }
        )
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=invalid_user_info')
        }
      }
    })

    it('redirects to /login with error when handle is missing', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            did: 'did:plc:abc123',
            // Missing 'handle'
            sessionId: asSessionId('session-123'),
            sealedToken: asSealedToken('sealed-token-xyz'),
          }),
          { status: 200 }
        )
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=invalid_user_info')
        }
      }
    })

    it('redirects to /login with error when sealedToken is missing', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            did: 'did:plc:abc123',
            handle: 'user.example.com',
            sessionId: asSessionId('session-123'),
            // Missing 'sealedToken'
          }),
          { status: 200 }
        )
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=invalid_user_info')
        }
      }
    })

    it('redirects to /login with error when sessionId is missing', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            did: 'did:plc:abc123',
            handle: 'user.example.com',
            // Missing 'sessionId'
            sealedToken: asSealedToken('sealed-token-xyz'),
          }),
          { status: 200 }
        )
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=invalid_user_info')
        }
      }
    })

    it('handles partial user info with only some required fields', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            did: 'did:plc:abc123',
            // Only did is present, missing handle, sessionId, sealedToken
          }),
          { status: 200 }
        )
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=invalid_user_info')
        }
      }
    })

    it('handles empty object response', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=invalid_user_info')
        }
      }
    })
  })

  describe('invalid credential format handling', () => {
    it('redirects to /login with error when DID format is invalid', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      // DID has invalid format (not starting with did:)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            did: 'invalid-did-format',  // Invalid: should be "did:plc:xxx"
            handle: 'user.example.com',
            sessionId: asSessionId('session-123'),
            sealedToken: asSealedToken('sealed-token-xyz'),
          }),
          { status: 200 }
        )
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=invalid_credential_format')
        }
      }
    })

    it('redirects to /login with error when handle format is invalid', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      // Handle has invalid format (no dots, not a domain-like identifier)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            did: 'did:plc:abc123',
            handle: 'invalid',  // Invalid: should be "user.domain.tld"
            sessionId: asSessionId('session-123'),
            sealedToken: asSealedToken('sealed-token-xyz'),
          }),
          { status: 200 }
        )
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=invalid_credential_format')
        }
      }
    })

    it('redirects to /login with error when instance URL format is invalid', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'not-a-valid-url',  // Invalid URL format
          redirect: '/',
          state: testState,
        }),
      })

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            did: 'did:plc:abc123',
            handle: 'user.example.com',
            sessionId: asSessionId('session-123'),
            sealedToken: asSealedToken('sealed-token-xyz'),
          }),
          { status: 200 }
        )
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=invalid_credential_format')
        }
      }
    })
  })

  describe('CSRF state validation (RFC 9700)', () => {
    it('rejects callback when state parameter is missing from URL', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: 'http://localhost:5173/api/auth/callback', // No state parameter
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=invalid_state')
        }
      }
    })

    it('rejects callback when state is missing from pending auth cookie', async () => {
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          // No state field
        }),
      })

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: 'http://localhost:5173/api/auth/callback?state=somestate123',
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=invalid_state')
        }
      }
    })

    it('rejects callback when state values do not match', async () => {
      const cookieState = generateOAuthState()
      const differentState = generateOAuthState() // Different state
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: cookieState,
        }),
      })

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${differentState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=invalid_state')
        }
      }
    })

    it('accepts callback when state values match exactly', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            did: 'did:plc:abc123',
            handle: 'user.example.com',
            sessionId: asSessionId('session-123'),
            sealedToken: asSealedToken('sealed-token-xyz'),
          }),
          { status: 200 }
        )
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/') // Success - redirected to stored redirect URL
        }
      }
    })

    it('rejects callback with empty state in URL', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: 'http://localhost:5173/api/auth/callback?state=', // Empty state
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=invalid_state')
        }
      }
    })

    it('rejects callback with empty state in pending auth cookie', async () => {
      const urlState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: '', // Empty state in cookie
        }),
      })

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${urlState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=invalid_state')
        }
      }
    })
  })

  describe('fetch error handling', () => {
    it('redirects to /login with error when fetch throws network error', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      mockFetch.mockRejectedValueOnce(new Error('Network error: Failed to fetch'))

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=fetch_failed')
        }
      }
    })

    it('redirects to /login with error when /api/me returns non-OK status (401)', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=fetch_failed')
        }
      }
    })

    it('redirects to /login with error when /api/me returns non-OK status (500)', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 })
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=fetch_failed')
        }
      }
    })

    it('redirects to /login with error when /api/me returns non-OK status (404)', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 })
      )

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=fetch_failed')
        }
      }
    })

    it('redirects to /login with error when fetch times out (AbortError)', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      const abortError = new DOMException('The operation was aborted', 'AbortError')
      mockFetch.mockRejectedValueOnce(abortError)

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=fetch_failed')
        }
      }
    })

    it('redirects to /login with error when fetch throws TypeError (invalid URL)', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        coves_session: 'mock-coves-session-token',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      mockFetch.mockRejectedValueOnce(new TypeError('Failed to parse URL'))

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: `http://localhost:5173/api/auth/callback?state=${testState}`,
      })

      try {
        await callbackHandler(event)
        expect.fail('Expected redirect to be thrown')
      } catch (error) {
        expect(isRedirect(error)).toBe(true)
        if (isRedirect(error)) {
          expect(error.status).toBe(302)
          expect(error.location).toBe('/login?error=fetch_failed')
        }
      }
    })
  })
})

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes account from session', async () => {
    const session: AppSession = {
      activeAccountId: TEST_ACCOUNT_ID_1,
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

    const cookies = createMockCookies({
      kelp_session: encryptSession(session, TEST_SECRET),
    })

    // Mock Coves logout endpoint
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const event = createMockEvent({
      method: 'POST',
      body: { accountId: TEST_ACCOUNT_ID_1 },
      cookies,
      locals: createAuthenticatedLocals(session),
    })

    const response = await logoutHandler(event)

    expect(response.status).toBe(200)

    // Verify session was updated (account removed)
    const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
    const sessionSetCall = setCalls.find(
      (call) => call[0] === 'kelp_session'
    )
    expect(sessionSetCall).toBeDefined()

    if (sessionSetCall) {
      const newSession = decryptSession(sessionSetCall[1] as string, TEST_SECRET)
      expect(newSession?.accounts).toHaveLength(1)
      expect(newSession?.accounts[0].id).toBe(TEST_ACCOUNT_ID_2)
    }
  })

  it('calls Coves /oauth/logout endpoint', async () => {
    const session: AppSession = {
      activeAccountId: TEST_ACCOUNT_ID_1,
      accounts: [
        {
          id: TEST_ACCOUNT_ID_1,
          did: asDID('did:plc:user1'),
          handle: asHandle('user1.example.com'),
          instance: asInstanceURL('https://coves.example.com'),
          sealedToken: asSealedToken('token-1'),
          sessionId: asSessionId('session-1'),
        },
      ],
    }

    const cookies = createMockCookies({
      kelp_session: encryptSession(session, TEST_SECRET),
    })

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const event = createMockEvent({
      method: 'POST',
      body: {},
      cookies,
      locals: createAuthenticatedLocals(session),
    })

    await logoutHandler(event)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://coves.example.com/oauth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Cookie: 'coves_session=token-1',
        }),
      })
    )
  })

  it('clears session cookie if no accounts remain', async () => {
    const session: AppSession = {
      activeAccountId: TEST_ACCOUNT_ID_1,
      accounts: [
        {
          id: TEST_ACCOUNT_ID_1,
          did: asDID('did:plc:user1'),
          handle: asHandle('user1.example.com'),
          instance: asInstanceURL('https://coves.example.com'),
          sealedToken: asSealedToken('token-1'),
          sessionId: asSessionId('session-1'),
        },
      ],
    }

    const cookies = createMockCookies({
      kelp_session: encryptSession(session, TEST_SECRET),
    })

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const event = createMockEvent({
      method: 'POST',
      body: { accountId: TEST_ACCOUNT_ID_1 },
      cookies,
      locals: createAuthenticatedLocals(session),
    })

    const response = await logoutHandler(event)

    expect(response.status).toBe(200)
    expect(cookies.delete).toHaveBeenCalledWith('kelp_session', { path: '/' })
  })

  it('returns 401 if not authenticated', async () => {
    const cookies = createMockCookies()

    const event = createMockEvent({
      method: 'POST',
      body: {},
      cookies,
      // Unauthenticated - use default locals
    })

    const response = await logoutHandler(event)

    expect(response.status).toBe(401)
  })

  it('logs out non-active account while keeping active account unchanged', async () => {
    const session: AppSession = {
      activeAccountId: TEST_ACCOUNT_ID_1, // account-1 is active
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

    const cookies = createMockCookies({
      kelp_session: encryptSession(session, TEST_SECRET),
    })

    // Mock Coves logout endpoint
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const event = createMockEvent({
      method: 'POST',
      body: { accountId: TEST_ACCOUNT_ID_2 }, // Logout account-2, NOT the active account
      cookies,
      locals: createAuthenticatedLocals(session),
    })

    const response = await logoutHandler(event)

    expect(response.status).toBe(200)

    // Verify session was updated correctly
    const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
    const sessionSetCall = setCalls.find(
      (call) => call[0] === 'kelp_session'
    )
    expect(sessionSetCall).toBeDefined()

    if (sessionSetCall) {
      const newSession = decryptSession(sessionSetCall[1] as string, TEST_SECRET)
      // account-2 should be removed
      expect(newSession?.accounts).toHaveLength(1)
      expect(newSession?.accounts[0].id).toBe(TEST_ACCOUNT_ID_1)
      // account-1 should STILL be the active account
      expect(newSession?.activeAccountId).toBe(TEST_ACCOUNT_ID_1)
    }
  })

  it('succeeds locally even when remote logout fails', async () => {
    const session: AppSession = {
      activeAccountId: TEST_ACCOUNT_ID_1,
      accounts: [
        {
          id: TEST_ACCOUNT_ID_1,
          did: asDID('did:plc:user1'),
          handle: asHandle('user1.example.com'),
          instance: asInstanceURL('https://coves.example.com'),
          sealedToken: asSealedToken('token-1'),
          sessionId: asSessionId('session-1'),
        },
      ],
    }

    const cookies = createMockCookies({
      kelp_session: encryptSession(session, TEST_SECRET),
    })

    // Mock Coves logout endpoint to fail with 500
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 })
    )

    const event = createMockEvent({
      method: 'POST',
      body: { accountId: TEST_ACCOUNT_ID_1 },
      cookies,
      locals: createAuthenticatedLocals(session),
    })

    const response = await logoutHandler(event)
    const data = await response.json()

    // Should still succeed locally
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    // Should indicate remote logout failed
    expect(data.remoteLogoutFailed).toBe(true)
    expect(data.remoteLogoutError).toContain('500')
    // Session should still be cleared (cookie deleted)
    expect(cookies.delete).toHaveBeenCalledWith('kelp_session', { path: '/' })
  })

  it('succeeds locally even when remote logout throws network error', async () => {
    const session: AppSession = {
      activeAccountId: TEST_ACCOUNT_ID_1,
      accounts: [
        {
          id: TEST_ACCOUNT_ID_1,
          did: asDID('did:plc:user1'),
          handle: asHandle('user1.example.com'),
          instance: asInstanceURL('https://coves.example.com'),
          sealedToken: asSealedToken('token-1'),
          sessionId: asSessionId('session-1'),
        },
      ],
    }

    const cookies = createMockCookies({
      kelp_session: encryptSession(session, TEST_SECRET),
    })

    // Mock Coves logout endpoint to throw network error
    mockFetch.mockRejectedValueOnce(new Error('Network error: connection refused'))

    const event = createMockEvent({
      method: 'POST',
      body: { accountId: TEST_ACCOUNT_ID_1 },
      cookies,
      locals: createAuthenticatedLocals(session),
    })

    const response = await logoutHandler(event)
    const data = await response.json()

    // Should still succeed locally
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    // Should indicate remote logout failed
    expect(data.remoteLogoutFailed).toBe(true)
    expect(data.remoteLogoutError).toContain('Network error')
    // Session should still be cleared
    expect(cookies.delete).toHaveBeenCalledWith('kelp_session', { path: '/' })
  })

  it('returns 403 for cross-origin requests', async () => {
    const session: AppSession = {
      activeAccountId: TEST_ACCOUNT_ID_1,
      accounts: [
        {
          id: TEST_ACCOUNT_ID_1,
          did: asDID('did:plc:user1'),
          handle: asHandle('user1.example.com'),
          instance: asInstanceURL('https://coves.example.com'),
          sealedToken: asSealedToken('token-1'),
          sessionId: asSessionId('session-1'),
        },
      ],
    }

    const cookies = createMockCookies({
      kelp_session: encryptSession(session, TEST_SECRET),
    })

    const event = createMockEvent({
      method: 'POST',
      body: { accountId: TEST_ACCOUNT_ID_1 },
      cookies,
      locals: createAuthenticatedLocals(session),
      url: 'http://localhost:5173/api/auth/logout',
      headers: {
        Origin: 'https://evil.com',
      },
    })

    const response = await logoutHandler(event)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Cross-origin requests not allowed')
  })
})

describe('POST /api/auth/switch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('switches active account', async () => {
    const session: AppSession = {
      activeAccountId: TEST_ACCOUNT_ID_1,
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

    const cookies = createMockCookies({
      kelp_session: encryptSession(session, TEST_SECRET),
    })

    const event = createMockEvent({
      method: 'POST',
      body: { accountId: TEST_ACCOUNT_ID_2 },
      cookies,
      locals: createAuthenticatedLocals(session),
    })

    const response = await switchHandler(event)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.activeAccountId).toBe(TEST_ACCOUNT_ID_2)

    // Verify cookie was updated
    const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
    const sessionSetCall = setCalls.find(
      (call) => call[0] === 'kelp_session'
    )
    expect(sessionSetCall).toBeDefined()

    if (sessionSetCall) {
      const newSession = decryptSession(sessionSetCall[1] as string, TEST_SECRET)
      expect(newSession?.activeAccountId).toBe(TEST_ACCOUNT_ID_2)
    }
  })

  it('returns 400 for invalid account id format', async () => {
    const session: AppSession = {
      activeAccountId: TEST_ACCOUNT_ID_1,
      accounts: [
        {
          id: TEST_ACCOUNT_ID_1,
          did: asDID('did:plc:user1'),
          handle: asHandle('user1.example.com'),
          instance: asInstanceURL('https://coves.example.com'),
          sealedToken: asSealedToken('token-1'),
          sessionId: asSessionId('session-1'),
        },
      ],
    }

    const cookies = createMockCookies({
      kelp_session: encryptSession(session, TEST_SECRET),
    })

    const event = createMockEvent({
      method: 'POST',
      body: { accountId: 'invalid-format' }, // Not a valid 32-char hex string
      cookies,
      locals: createAuthenticatedLocals(session),
    })

    const response = await switchHandler(event)

    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toContain('Invalid accountId format')
  })

  it('returns 400 for non-existent account id', async () => {
    const session: AppSession = {
      activeAccountId: TEST_ACCOUNT_ID_1,
      accounts: [
        {
          id: TEST_ACCOUNT_ID_1,
          did: asDID('did:plc:user1'),
          handle: asHandle('user1.example.com'),
          instance: asInstanceURL('https://coves.example.com'),
          sealedToken: asSealedToken('token-1'),
          sessionId: asSessionId('session-1'),
        },
      ],
    }

    const cookies = createMockCookies({
      kelp_session: encryptSession(session, TEST_SECRET),
    })

    // Use a valid AccountId format that doesn't exist in the session
    const event = createMockEvent({
      method: 'POST',
      body: { accountId: 'ffffffffffffffffffffffffffffffff' },
      cookies,
      locals: createAuthenticatedLocals(session),
    })

    const response = await switchHandler(event)

    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toContain('not found')
  })

  it('returns 401 if not authenticated', async () => {
    const cookies = createMockCookies()

    const event = createMockEvent({
      method: 'POST',
      body: { accountId: 'some-account' },
      cookies,
      // Unauthenticated - use default locals
    })

    const response = await switchHandler(event)

    expect(response.status).toBe(401)
  })

  it('returns 403 for cross-origin requests', async () => {
    const session: AppSession = {
      activeAccountId: TEST_ACCOUNT_ID_1,
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

    const cookies = createMockCookies({
      kelp_session: encryptSession(session, TEST_SECRET),
    })

    const event = createMockEvent({
      method: 'POST',
      body: { accountId: TEST_ACCOUNT_ID_2 },
      cookies,
      locals: createAuthenticatedLocals(session),
      url: 'http://localhost:5173/api/auth/switch',
      headers: {
        Origin: 'https://evil.com',
      },
    })

    const response = await switchHandler(event)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Cross-origin requests not allowed')
  })
})
