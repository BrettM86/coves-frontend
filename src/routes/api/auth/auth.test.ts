import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Cookies, RequestEvent } from '@sveltejs/kit'
import type { Redirect } from '@sveltejs/kit'
import { POST as loginHandler } from './login/+server'
import { GET as callbackHandler } from './callback/+server'
import { POST as logoutHandler } from './logout/+server'
import { generateOAuthState } from '$lib/server/csrf'

// Type alias for any RequestEvent to simplify testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRequestEvent = RequestEvent<Record<string, string>, any>

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

// Mock environment variables (needed by login endpoint)
vi.mock('$env/dynamic/private', () => ({
  env: {},
}))

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
 * Helper to create authenticated App.Locals with the new shape.
 */
function createAuthenticatedLocals(account: {
  did: string
  handle: string
  instance: string
  sealedToken: string
  avatar?: string
}): App.Locals {
  return {
    auth: {
      authenticated: true,
      account: {
        did: account.did,
        handle: account.handle,
        instance: account.instance,
        sealedToken: account.sealedToken,
        avatar: account.avatar,
      },
      authToken: account.sealedToken,
    },
  } as App.Locals
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
      }),
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

      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth',
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

      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth',
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

      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth',
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

      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth',
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

      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth',
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

      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth',
      )
      expect(pendingAuthCall).toBeDefined()
      if (pendingAuthCall) {
        const pendingAuth = JSON.parse(pendingAuthCall[1] as string)
        expect(pendingAuth.redirect).toBe('/community/safe')
      }
    })
  })

  describe('CSRF state parameter (RFC 6749)', () => {
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

      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth',
      )
      expect(pendingAuthCall).toBeDefined()
      if (pendingAuthCall) {
        const pendingAuth = JSON.parse(pendingAuthCall[1] as string)
        expect(pendingAuth.state).toBeDefined()
        expect(typeof pendingAuth.state).toBe('string')
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

      const redirectUrl = new URL(data.redirectUrl)
      const urlState = redirectUrl.searchParams.get('state')

      const setCalls = (cookies.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuthCall = setCalls.find(
        (call) => call[0] === 'kelp_pending_auth',
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

      const setCalls1 = (cookies1.set as ReturnType<typeof vi.fn>).mock.calls
      const setCalls2 = (cookies2.set as ReturnType<typeof vi.fn>).mock.calls
      const pendingAuth1 = JSON.parse(
        setCalls1.find(
          (call) => call[0] === 'kelp_pending_auth',
        )?.[1] as string,
      )
      const pendingAuth2 = JSON.parse(
        setCalls2.find(
          (call) => call[0] === 'kelp_pending_auth',
        )?.[1] as string,
      )

      expect(pendingAuth1.state).not.toBe(pendingAuth2.state)
    })
  })
})

describe('GET /api/auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to stored redirect URL on valid state', async () => {
    const testState = generateOAuthState()
    const cookies = createMockCookies({
      kelp_pending_auth: JSON.stringify({
        redirect: '/community/test',
        state: testState,
      }),
      coves_session: 'valid-session-cookie',
    })

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

  it('redirects to / when no redirect URL stored', async () => {
    const testState = generateOAuthState()
    const cookies = createMockCookies({
      kelp_pending_auth: JSON.stringify({
        redirect: '',
        state: testState,
      }),
      coves_session: 'valid-session-cookie',
    })

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
  })

  it('redirects to /login on missing pending auth cookie', async () => {
    const cookies = createMockCookies({})

    const event = createMockEvent({
      method: 'GET',
      cookies,
      url: 'http://localhost:5173/api/auth/callback?state=some-state',
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

  it('cleans up pending auth cookie after use', async () => {
    const testState = generateOAuthState()
    const cookies = createMockCookies({
      kelp_pending_auth: JSON.stringify({
        redirect: '/',
        state: testState,
      }),
      coves_session: 'valid-session-cookie',
    })

    const event = createMockEvent({
      method: 'GET',
      cookies,
      url: `http://localhost:5173/api/auth/callback?state=${testState}`,
    })

    try {
      await callbackHandler(event)
    } catch {
      // Expected redirect
    }

    expect(cookies.delete).toHaveBeenCalledWith('kelp_pending_auth', {
      path: '/',
    })
  })

  describe('CSRF state validation', () => {
    it('rejects callback when state parameter is missing from URL', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
          redirect: '/',
          state: testState,
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
          expect(error.location).toBe('/login?error=invalid_state')
        }
      }
    })

    it('rejects callback when state is missing from pending auth cookie', async () => {
      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
          redirect: '/',
          // No state field - runtime validation rejects this shape
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
          expect(error.location).toBe('/login?error=invalid_pending_auth')
        }
      }
    })

    it('rejects callback when state values do not match', async () => {
      const cookieState = generateOAuthState()
      const differentState = generateOAuthState()
      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
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

    it('rejects callback with empty state in URL', async () => {
      const testState = generateOAuthState()
      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
          redirect: '/',
          state: testState,
        }),
      })

      const event = createMockEvent({
        method: 'GET',
        cookies,
        url: 'http://localhost:5173/api/auth/callback?state=',
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
        kelp_pending_auth: JSON.stringify({
          redirect: '/',
          state: '',
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
})

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('succeeds idempotently and clears cookie if not authenticated', async () => {
    const cookies = createMockCookies()

    const event = createMockEvent({
      method: 'POST',
      body: {},
      cookies,
    })

    const response = await logoutHandler(event)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(cookies.delete).toHaveBeenCalledWith('coves_session', { path: '/' })
  })

  it('returns 403 for cross-origin requests', async () => {
    const cookies = createMockCookies({
      coves_session: 'some-session',
    })

    const event = createMockEvent({
      method: 'POST',
      body: {},
      cookies,
      locals: createAuthenticatedLocals({
        did: 'did:plc:user1',
        handle: 'user1.example.com',
        instance: 'https://coves.example.com',
        sealedToken: 'token-1',
      }),
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

  it('calls Go /oauth/logout endpoint using authToken from locals (not cookie)', async () => {
    const cookies = createMockCookies({
      coves_session: 'my-sealed-token',
    })

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const event = createMockEvent({
      method: 'POST',
      body: {},
      cookies,
      locals: createAuthenticatedLocals({
        did: 'did:plc:user1',
        handle: 'user1.example.com',
        instance: 'https://coves.example.com',
        sealedToken: 'token-1',
      }),
    })

    await logoutHandler(event)

    // Should use locals.auth.authToken ('token-1'), not the cookie value ('my-sealed-token')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://coves.example.com/oauth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Cookie: 'coves_session=token-1',
        }),
      }),
    )
  })

  it('clears coves_session cookie on logout', async () => {
    const cookies = createMockCookies({
      coves_session: 'my-sealed-token',
    })

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const event = createMockEvent({
      method: 'POST',
      body: {},
      cookies,
      locals: createAuthenticatedLocals({
        did: 'did:plc:user1',
        handle: 'user1.example.com',
        instance: 'https://coves.example.com',
        sealedToken: 'token-1',
      }),
    })

    const response = await logoutHandler(event)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.session).toBeNull()
    expect(cookies.delete).toHaveBeenCalledWith('coves_session', { path: '/' })
  })

  it('succeeds locally even when remote logout fails with 500', async () => {
    const cookies = createMockCookies({
      coves_session: 'my-sealed-token',
    })

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
      }),
    )

    const event = createMockEvent({
      method: 'POST',
      body: {},
      cookies,
      locals: createAuthenticatedLocals({
        did: 'did:plc:user1',
        handle: 'user1.example.com',
        instance: 'https://coves.example.com',
        sealedToken: 'token-1',
      }),
    })

    const response = await logoutHandler(event)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.remoteLogoutFailed).toBe(true)
    // Error details are sanitized -- client gets a generic message
    expect(data.remoteLogoutError).toBe('Remote logout failed')
    expect(cookies.delete).toHaveBeenCalledWith('coves_session', { path: '/' })
  })

  it('succeeds locally even when remote logout throws network error', async () => {
    const cookies = createMockCookies({
      coves_session: 'my-sealed-token',
    })

    mockFetch.mockRejectedValueOnce(
      new Error('Network error: connection refused'),
    )

    const event = createMockEvent({
      method: 'POST',
      body: {},
      cookies,
      locals: createAuthenticatedLocals({
        did: 'did:plc:user1',
        handle: 'user1.example.com',
        instance: 'https://coves.example.com',
        sealedToken: 'token-1',
      }),
    })

    const response = await logoutHandler(event)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.remoteLogoutFailed).toBe(true)
    // Error details are sanitized -- client gets a generic message
    expect(data.remoteLogoutError).toBe('Remote logout failed')
    expect(cookies.delete).toHaveBeenCalledWith('coves_session', { path: '/' })
  })

  it('always calls remote logout using authToken from locals (even without cookie)', async () => {
    const cookies = createMockCookies({
      // No coves_session cookie -- but the authToken comes from locals
    })

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const event = createMockEvent({
      method: 'POST',
      body: {},
      cookies,
      locals: createAuthenticatedLocals({
        did: 'did:plc:user1',
        handle: 'user1.example.com',
        instance: 'https://coves.example.com',
        sealedToken: 'token-1',
      }),
    })

    const response = await logoutHandler(event)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    // Now uses locals.auth.authToken, so fetch IS called even without cookie
    expect(mockFetch).toHaveBeenCalledWith(
      'https://coves.example.com/oauth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Cookie: 'coves_session=token-1',
        }),
      }),
    )
    expect(cookies.delete).toHaveBeenCalledWith('coves_session', { path: '/' })
  })
})
