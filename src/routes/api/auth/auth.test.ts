import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { POST as loginHandler } from './login/+server'
import { GET as callbackHandler } from './callback/+server'
import { POST as logoutHandler } from './logout/+server'
import { generateOAuthState } from '$lib/server/csrf'
import { DidNotFoundError } from '@atcute/identity-resolver'
import {
  createMockCookies,
  createMockEvent,
  isRedirect,
} from '$lib/test-utils/request-event'

const resolveLoginHandle = vi.hoisted(() =>
  vi.fn<(handle: string, getClientAddress: () => string) => Promise<void>>(),
)
vi.mock('$lib/server/resolve-login-handle', () => ({ resolveLoginHandle }))
beforeEach(() => {
  resolveLoginHandle.mockReset().mockResolvedValue(undefined)
})

// Mock environment variables (needed by login endpoint)
vi.mock('$env/dynamic/private', () => ({
  env: {},
}))

// Mutable so individual tests can flip the instance-lock policy.
const publicEnv = vi.hoisted((): Record<string, string | undefined> => ({}))
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }))

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
    for (const key of Object.keys(publicEnv)) delete publicEnv[key]
  })

  describe('PUBLIC_LOCK_TO_INSTANCE enforcement', () => {
    const login = (instance: string) =>
      loginHandler(
        createMockEvent({
          method: 'POST',
          body: { handle: 'user.example.com', instance },
          cookies: createMockCookies(),
          url: 'http://localhost:5173/api/auth/login',
        }),
      )

    it('rejects a foreign instance with 403 when locked (the default)', async () => {
      publicEnv.PUBLIC_INSTANCE_URL = 'https://coves.social'

      const response = await login('https://attacker.example')

      expect(response.status).toBe(403)
      expect((await response.json()).error).toMatch(/own instance/)
    })

    it('compares origins, so a bare host or trailing path still matches', async () => {
      publicEnv.PUBLIC_INSTANCE_URL = 'https://coves.social'

      expect((await login('coves.social')).status).toBe(200)
      expect((await login('https://coves.social/')).status).toBe(200)
    })

    it('rejects a scheme downgrade of the locked instance', async () => {
      publicEnv.PUBLIC_INSTANCE_URL = 'https://coves.social'

      expect((await login('http://coves.social')).status).toBe(403)
    })

    it('allows any instance when PUBLIC_LOCK_TO_INSTANCE=false', async () => {
      publicEnv.PUBLIC_INSTANCE_URL = 'https://coves.social'
      publicEnv.PUBLIC_LOCK_TO_INSTANCE = 'false'

      expect((await login('https://other.example')).status).toBe(200)
    })

    it('does not enforce when PUBLIC_INSTANCE_URL is unset', async () => {
      expect((await login('https://other.example')).status).toBe(200)
    })
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

  describe('handle resolution before OAuth', () => {
    function login(handle: string) {
      const cookies = createMockCookies()
      const event = createMockEvent({
        method: 'POST',
        body: { handle, instance: 'https://coves.example.com' },
        cookies,
        url: 'http://localhost:5173/api/auth/login',
      })
      const response = loginHandler(event)
      return { cookies, event, response }
    }

    it('checks the normalized handle and uses it in the OAuth URL', async () => {
      const { response } = login('  Jerry.Bsky.Social  ')
      const result = await response
      const data = await result.json()

      expect(result.status).toBe(200)
      expect(resolveLoginHandle).toHaveBeenCalledExactlyOnceWith(
        'jerry.bsky.social',
        expect.any(Function),
      )
      expect(new URL(data.redirectUrl).searchParams.get('handle')).toBe(
        'jerry.bsky.social',
      )
    })

    it('gives resolution this request’s own client address', async () => {
      // TEST-NET-3 (RFC 5737), so the mock event's default 127.0.0.1 cannot
      // make this pass by accident.
      const clientAddress = '203.0.113.7'
      const cookies = createMockCookies()
      const event = createMockEvent({
        method: 'POST',
        body: {
          handle: 'jerry.bsky.social',
          instance: 'https://coves.example.com',
        },
        cookies,
        url: 'http://localhost:5173/api/auth/login',
      })
      Object.assign(event, { getClientAddress: () => clientAddress })

      expect((await loginHandler(event)).status).toBe(200)

      // The AppView rate-limits handle resolution per client IP. The resolver
      // needs the address of the visitor who submitted the login form, which
      // only the request event knows, or every login shares one bucket.
      const [, getClientAddress] = resolveLoginHandle.mock.calls[0]
      expect(getClientAddress()).toBe(clientAddress)
    })

    it('returns account_not_found without starting OAuth for a missing account', async () => {
      resolveLoginHandle.mockRejectedValueOnce(
        new DidNotFoundError('jerry.coves.social'),
      )
      const { cookies, response } = login('jerry.coves.social')
      const result = await response

      expect(result.status).toBe(404)
      expect(await result.json()).toEqual({ error: 'account_not_found' })
      expect(cookies.set).not.toHaveBeenCalled()
    })

    it.each([
      new TypeError('fetch failed'),
      new DOMException('Resolution timed out', 'TimeoutError'),
    ])(
      'returns a retryable error without starting OAuth on resolution failure: %s',
      async (error) => {
        resolveLoginHandle.mockRejectedValueOnce(error)
        const { cookies, response } = login('jerry.bsky.social')
        const result = await response

        expect(result.status).toBe(503)
        expect(await result.json()).toEqual({
          error: 'handle_resolution_failed',
        })
        expect(cookies.set).not.toHaveBeenCalled()
      },
    )

    it.each([
      '   ',
      'jerry@bsky.social',
      'https://jerry.bsky.social',
      'localhost',
    ])('rejects invalid handle %j before resolution', async (handle) => {
      const { cookies, response } = login(handle)
      const result = await response

      expect(result.status).toBe(400)
      expect(await result.json()).toEqual({ error: 'invalid_handle' })
      expect(resolveLoginHandle).not.toHaveBeenCalled()
      expect(cookies.set).not.toHaveBeenCalled()
    })

    it('waits for resolution before creating pending authentication state', async () => {
      let finishResolution = () => {}
      resolveLoginHandle.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishResolution = resolve
          }),
      )
      const { cookies, response } = login('jerry.bsky.social')

      await vi.waitFor(() => expect(resolveLoginHandle).toHaveBeenCalledOnce())
      expect(cookies.set).not.toHaveBeenCalled()
      finishResolution()
      expect((await response).status).toBe(200)
      expect(cookies.set).toHaveBeenCalledOnce()
    })
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

/**
 * Asserts a console spy received exactly one call with exactly one string
 * argument — the structured log line — and returns it raw and parsed.
 * Local to this file: test helpers are not shared between suites.
 */
function singleJsonLine(calls: unknown[][]): {
  raw: string
  line: Record<string, unknown>
} {
  expect(calls).toHaveLength(1)
  expect(calls[0]).toHaveLength(1)
  const raw = calls[0][0]
  expect(typeof raw).toBe('string')
  expect(raw).toMatch(/^\{[\s\S]*\}$/)
  return {
    raw: raw as string,
    line: JSON.parse(raw as string) as Record<string, unknown>,
  }
}

function spyOnWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}

function spyOnError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

describe('POST /api/auth/login structured logging', () => {
  // Spies are created and restored per test rather than inline, so a failing
  // assertion cannot skip its restore and leak calls into the next test.
  let warnSpy: ReturnType<typeof spyOnWarn>

  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = spyOnWarn()
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  /** Drives the login handler with a redirect the policy should reject. */
  async function loginWithRedirect(redirectUrl: string): Promise<void> {
    await loginHandler(
      createMockEvent({
        method: 'POST',
        body: {
          handle: 'user.example.com',
          instance: 'https://coves.example.com',
          redirect: redirectUrl,
        },
        cookies: createMockCookies(),
        url: 'http://localhost:5173/api/auth/login',
      }),
    )
  }

  const rejected: ReadonlyArray<readonly [string, string]> = [
    ['backslash prefix', '\\evil.com/steal'],
    ['protocol-relative', '//evil.com/steal'],
    ['external origin', 'https://evil.com/steal-tokens'],
    ['invalid URL', 'http://[::1 broken'],
  ]

  for (const [label, redirectUrl] of rejected) {
    it(`logs a rejected ${label} redirect as one JSON warn line`, async () => {
      await loginWithRedirect(redirectUrl)

      const { line } = singleJsonLine(warnSpy.mock.calls)
      expect(line.level).toBe('warn')
      expect(line.msg).toContain('Rejected')
    })
  }
})

describe('POST /api/auth/login handle resolution logging', () => {
  let errorSpy: ReturnType<typeof spyOnError>

  beforeEach(() => {
    vi.clearAllMocks()
    errorSpy = spyOnError()
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  function login() {
    return loginHandler(
      createMockEvent({
        method: 'POST',
        body: {
          handle: 'jerry.bsky.social',
          instance: 'https://coves.example.com',
        },
        cookies: createMockCookies(),
        url: 'http://localhost:5173/api/auth/login',
      }),
    )
  }

  it('logs one JSON error line naming the failure, and still returns 503', async () => {
    resolveLoginHandle.mockRejectedValueOnce(new TypeError('fetch failed'))

    const result = await login()

    expect(result.status).toBe(503)
    expect(await result.json()).toEqual({ error: 'handle_resolution_failed' })
    // The 503 body is deliberately opaque to the visitor, so without this line
    // an AppView that is down, unreachable, or rate-limiting the frontend is
    // indistinguishable from every other cause in the operator's logs.
    const { raw, line } = singleJsonLine(errorSpy.mock.calls)
    expect(line.level).toBe('error')
    expect(raw).toContain('TypeError')
  })

  it('does not log an error when the account simply does not exist', async () => {
    resolveLoginHandle.mockRejectedValueOnce(
      new DidNotFoundError('jerry.bsky.social'),
    )

    const result = await login()

    // A typo in the login form is the user's business, not an operator's. At
    // error level it would drown the lines that do need someone to look.
    expect(result.status).toBe(404)
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/logout structured logging', () => {
  // Put a session cookie value in the thrown message: it must never survive
  // into the log line.
  const SESSION_VALUE = 'coves_session=SEALEDLOGOUT123'

  let warnSpy: ReturnType<typeof spyOnWarn>

  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = spyOnWarn()
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  function logoutEvent() {
    return createMockEvent({
      method: 'POST',
      body: {},
      cookies: createMockCookies({ coves_session: 'my-sealed-token' }),
      locals: createAuthenticatedLocals({
        did: 'did:plc:user1',
        handle: 'user1.example.com',
        instance: 'https://coves.example.com',
        sealedToken: 'token-1',
      }),
    })
  }

  it('logs a backend rejection as one JSON warn line carrying the error', async () => {
    mockFetch.mockRejectedValueOnce(
      new Error(`connection refused sending ${SESSION_VALUE}`),
    )

    await logoutHandler(logoutEvent())

    const { raw, line } = singleJsonLine(warnSpy.mock.calls)
    expect(line.level).toBe('warn')
    expect(line.msg).toContain('Failed to call backend logout endpoint')
    expect(line.err).toBeTypeOf('object')
    expect(raw).not.toContain('SEALEDLOGOUT123')
  })

  it('logs a non-OK backend status as one JSON warn line', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
      }),
    )

    await logoutHandler(logoutEvent())

    const { raw, line } = singleJsonLine(warnSpy.mock.calls)
    expect(line.level).toBe('warn')
    expect(line.msg).toContain('Backend returned non-OK status')
    expect(raw).toContain('500')
    // Queryable field, not only prose.
    expect(line.status).toBe(500)
  })
})
