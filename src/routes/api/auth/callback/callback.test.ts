import { describe, it, expect, vi, beforeEach } from 'vitest'

// Variable to control the mocked SESSION_SECRET
let mockSessionSecret: string | undefined = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

// Mock environment variables
vi.mock('$env/dynamic/private', () => ({
  env: {
    get SESSION_SECRET() {
      return mockSessionSecret
    },
  },
}))

// Mock session functions
const mockCreateSession = vi.fn()
const mockAddAccount = vi.fn()
const mockUpdateAccountByDid = vi.fn()
const mockEncryptSession = vi.fn()
const mockDecryptSession = vi.fn()

vi.mock('$lib/server/session', () => ({
  createSession: () => mockCreateSession(),
  addAccount: (...args: unknown[]) => mockAddAccount(...args),
  updateAccountByDid: (...args: unknown[]) => mockUpdateAccountByDid(...args),
  encryptSession: (...args: unknown[]) => mockEncryptSession(...args),
  decryptSession: (...args: unknown[]) => mockDecryptSession(...args),
  asDID: (value: string) => value,
  asHandle: (value: string) => value,
  asInstanceURL: (value: string) => value,
}))

// Mock cookies module
vi.mock('$lib/server/cookies', () => ({
  SESSION_COOKIE_OPTIONS: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  },
}))

// Mock CSRF validation to always return true (we test CSRF separately in auth.test.ts)
vi.mock('$lib/server/csrf', () => ({
  validateOAuthState: () => true,
}))

// Helper to create mock cookies
function createMockCookies(initialCookies: Record<string, string> = {}) {
  const store = new Map(Object.entries(initialCookies))
  return {
    get: vi.fn((name: string) => store.get(name)),
    set: vi.fn((name: string, value: string) => {
      store.set(name, value)
    }),
    delete: vi.fn((name: string) => {
      store.delete(name)
    }),
  }
}

// Helper to create mock URL with state parameter
function createMockUrl(state: string = 'test-state-1234567890abcdef1234567890abcdef1234567890abcdef12345678') {
  return new URL(`https://kelp.example.com/api/auth/callback?state=${state}`)
}

describe('auth callback endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSessionSecret = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
    global.fetch = vi.fn()
  })

  describe('missing SESSION_SECRET', () => {
    const testState = 'test-state-1234567890abcdef1234567890abcdef1234567890abcdef12345678'

    it('redirects to login with server_config error when SESSION_SECRET is not set', async () => {
      // Import the module after mocks are set up
      const { GET } = await import('./+server')

      mockSessionSecret = undefined

      const cookies = createMockCookies({
        coves_session: 'valid-coves-session',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      // Mock the /api/me response
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            did: 'did:plc:user123',
            handle: 'user.example.com',
            sessionId: 'session-123',
            sealedToken: 'sealed-token-123',
          }),
      })

      try {
        await GET({
          cookies: cookies as any,
          url: createMockUrl(testState),
        } as any)
        // Should not reach here - expecting redirect to be thrown
        expect.fail('Expected redirect to be thrown')
      } catch (error: any) {
        // SvelteKit redirect throws an object with status and location
        expect(error.status).toBe(302)
        expect(error.location).toBe('/login?error=server_config')
      }
    })

    it('redirects to login with server_config error when SESSION_SECRET is empty', async () => {
      const { GET } = await import('./+server')

      mockSessionSecret = ''

      const cookies = createMockCookies({
        coves_session: 'valid-coves-session',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            did: 'did:plc:user123',
            handle: 'user.example.com',
            sessionId: 'session-123',
            sealedToken: 'sealed-token-123',
          }),
      })

      try {
        await GET({
          cookies: cookies as any,
          url: createMockUrl(testState),
        } as any)
        expect.fail('Expected redirect to be thrown')
      } catch (error: any) {
        expect(error.status).toBe(302)
        expect(error.location).toBe('/login?error=server_config')
      }
    })
  })

  describe('missing coves_session cookie', () => {
    it('redirects to login with no_session error when coves_session is missing', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        // No coves_session cookie
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
        }),
      })

      try {
        await GET({
          cookies: cookies as any,
        } as any)
        expect.fail('Expected redirect to be thrown')
      } catch (error: any) {
        expect(error.status).toBe(302)
        expect(error.location).toBe('/login?error=no_session')
      }
    })
  })

  describe('missing pending auth state', () => {
    it('redirects to login with no_pending_auth error when pending auth cookie is missing or invalid', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        coves_session: 'valid-coves-session',
        // No kelp_pending_auth cookie
      })

      try {
        await GET({
          cookies: cookies as any,
        } as any)
        expect.fail('Expected redirect to be thrown')
      } catch (error: any) {
        expect(error.status).toBe(302)
        expect(error.location).toBe('/login?error=no_pending_auth')
      }
    })

    it('redirects to login with no_pending_auth error when pending auth has no instance', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        coves_session: 'valid-coves-session',
        kelp_pending_auth: JSON.stringify({
          instance: '',
          redirect: '/',
        }),
      })

      try {
        await GET({
          cookies: cookies as any,
        } as any)
        expect.fail('Expected redirect to be thrown')
      } catch (error: any) {
        expect(error.status).toBe(302)
        expect(error.location).toBe('/login?error=no_pending_auth')
      }
    })
  })

  describe('fetch user info failure', () => {
    const testState = 'test-state-1234567890abcdef1234567890abcdef1234567890abcdef12345678'

    it('redirects to login with fetch_failed error when /api/me request fails', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        coves_session: 'valid-coves-session',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
      })

      try {
        await GET({
          cookies: cookies as any,
          url: createMockUrl(testState),
        } as any)
        expect.fail('Expected redirect to be thrown')
      } catch (error: any) {
        expect(error.status).toBe(302)
        expect(error.location).toBe('/login?error=fetch_failed')
      }
    })

    it('redirects to login with fetch_failed error when network error occurs', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        coves_session: 'valid-coves-session',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      )

      try {
        await GET({
          cookies: cookies as any,
          url: createMockUrl(testState),
        } as any)
        expect.fail('Expected redirect to be thrown')
      } catch (error: any) {
        expect(error.status).toBe(302)
        expect(error.location).toBe('/login?error=fetch_failed')
      }
    })
  })

  describe('invalid user info', () => {
    const testState = 'test-state-1234567890abcdef1234567890abcdef1234567890abcdef12345678'

    it('redirects to login with invalid_user_info error when response is missing required fields', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        coves_session: 'valid-coves-session',
        kelp_pending_auth: JSON.stringify({
          instance: 'https://coves.example.com',
          redirect: '/',
          state: testState,
        }),
      })

      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            // Missing required fields
            did: 'did:plc:user123',
            // handle: missing
            // sessionId: missing
            // sealedToken: missing
          }),
      })

      try {
        await GET({
          cookies: cookies as any,
          url: createMockUrl(testState),
        } as any)
        expect.fail('Expected redirect to be thrown')
      } catch (error: any) {
        expect(error.status).toBe(302)
        expect(error.location).toBe('/login?error=invalid_user_info')
      }
    })
  })
})
