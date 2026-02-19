import { describe, it, expect, vi, type Mock, beforeEach } from 'vitest'

// Mock CSRF validation - control per test
let mockValidateOAuthState: Mock

vi.mock('$lib/server/csrf', () => ({
  validateOAuthState: (...args: unknown[]) => mockValidateOAuthState(...args),
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

// Helper to create mock URL with optional state parameter
function createMockUrl(state?: string): URL {
  const base = 'https://kelp.example.com/api/auth/callback'
  if (state !== undefined) {
    return new URL(`${base}?state=${state}`)
  }
  return new URL(base)
}

describe('GET /api/auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateOAuthState = vi.fn(() => true)
  })

  describe('missing pending auth cookie', () => {
    it('redirects to /login?error=no_pending_auth when kelp_pending_auth is missing', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({})

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl('some-state'),
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/login?error=no_pending_auth')
      }
    })
  })

  describe('invalid JSON in pending auth cookie', () => {
    it('deletes cookie and redirects to error', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        kelp_pending_auth: '{invalid-json',
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl('some-state'),
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/login?error=no_pending_auth')
      }

      expect(cookies.delete).toHaveBeenCalledWith('kelp_pending_auth', {
        path: '/',
      })
    })
  })

  describe('cookie with invalid shape (runtime validation)', () => {
    it('redirects to /login?error=invalid_pending_auth when cookie is "null"', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        kelp_pending_auth: 'null',
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl('some-state'),
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/login?error=invalid_pending_auth')
      }

      expect(cookies.delete).toHaveBeenCalledWith('kelp_pending_auth', {
        path: '/',
      })
    })

    it('redirects to /login?error=invalid_pending_auth when cookie is "42"', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        kelp_pending_auth: '42',
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl('some-state'),
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/login?error=invalid_pending_auth')
      }

      expect(cookies.delete).toHaveBeenCalledWith('kelp_pending_auth', {
        path: '/',
      })
    })

    it('redirects to /login?error=invalid_pending_auth when cookie is "[]"', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        kelp_pending_auth: '[]',
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl('some-state'),
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/login?error=invalid_pending_auth')
      }

      expect(cookies.delete).toHaveBeenCalledWith('kelp_pending_auth', {
        path: '/',
      })
    })

    it('redirects to /login?error=invalid_pending_auth when cookie is "{}" (empty object)', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        kelp_pending_auth: '{}',
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl('some-state'),
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/login?error=invalid_pending_auth')
      }

      expect(cookies.delete).toHaveBeenCalledWith('kelp_pending_auth', {
        path: '/',
      })
    })

    it('redirects to /login?error=invalid_pending_auth when state is a number instead of string', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
          redirect: '/',
          state: 12345,
        }),
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl('some-state'),
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/login?error=invalid_pending_auth')
      }

      expect(cookies.delete).toHaveBeenCalledWith('kelp_pending_auth', {
        path: '/',
      })
    })
  })

  describe('missing state parameter', () => {
    it('redirects to /login?error=invalid_state when state param is missing from URL', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
          redirect: '/',
          state: 'stored-state-value',
        }),
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl(), // No state parameter
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/login?error=invalid_state')
      }
    })

    it('redirects to /login?error=invalid_pending_auth when state is missing from pending auth', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
          redirect: '/',
          // No state field - runtime validation rejects this shape
        }),
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl('url-state-value'),
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/login?error=invalid_pending_auth')
      }
    })

    it('redirects to /login?error=invalid_state when state is empty in pending auth', async () => {
      const { GET } = await import('./+server')

      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
          redirect: '/',
          state: '',
        }),
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl('url-state-value'),
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/login?error=invalid_state')
      }
    })
  })

  describe('state mismatch', () => {
    it('redirects to /login?error=invalid_state when states do not match', async () => {
      const { GET } = await import('./+server')

      mockValidateOAuthState.mockReturnValue(false)

      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
          redirect: '/',
          state: 'stored-state-aaaa',
        }),
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl('different-state-bbbb'),
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/login?error=invalid_state')
      }

      expect(mockValidateOAuthState).toHaveBeenCalledWith(
        'stored-state-aaaa',
        'different-state-bbbb',
      )
    })
  })

  describe('valid state', () => {
    it('redirects to stored redirect URL on success', async () => {
      const { GET } = await import('./+server')

      const testState = 'abc123def456'

      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
          redirect: '/community/test',
          state: testState,
        }),
        coves_session: 'valid-session-cookie',
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl(testState),
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/community/test')
      }
    })

    it('redirects to / when no redirect in pending auth', async () => {
      const { GET } = await import('./+server')

      const testState = 'abc123def456'

      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
          redirect: '',
          state: testState,
        }),
        coves_session: 'valid-session-cookie',
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl(testState),
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/')
      }
    })
  })

  describe('missing coves_session cookie after OAuth', () => {
    it('redirects to /login?error=no_session when coves_session is not set', async () => {
      const { GET } = await import('./+server')

      const testState = 'abc123def456'

      // kelp_pending_auth exists but coves_session does NOT
      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
          redirect: '/community/test',
          state: testState,
        }),
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl(testState),
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/login?error=no_session')
      }
    })

    it('redirects to stored URL when coves_session exists', async () => {
      const { GET } = await import('./+server')

      const testState = 'abc123def456'

      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
          redirect: '/community/test',
          state: testState,
        }),
        coves_session: 'valid-session-cookie',
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl(testState),
        } as never)
        expect.fail('Expected redirect to be thrown')
      } catch (error: unknown) {
        const redirect = error as { status: number; location: string }
        expect(redirect.status).toBe(302)
        expect(redirect.location).toBe('/community/test')
      }
    })
  })

  describe('pending auth cookie cleanup', () => {
    it('deletes kelp_pending_auth cookie after successful use', async () => {
      const { GET } = await import('./+server')

      const testState = 'abc123def456'

      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
          redirect: '/',
          state: testState,
        }),
        coves_session: 'valid-session-cookie',
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl(testState),
        } as never)
      } catch {
        // Expected redirect
      }

      expect(cookies.delete).toHaveBeenCalledWith('kelp_pending_auth', {
        path: '/',
      })
    })

    it('deletes kelp_pending_auth cookie even on state validation failure', async () => {
      const { GET } = await import('./+server')

      mockValidateOAuthState.mockReturnValue(false)

      const cookies = createMockCookies({
        kelp_pending_auth: JSON.stringify({
          redirect: '/',
          state: 'stored-state',
        }),
      })

      try {
        await GET({
          cookies: cookies as never,
          url: createMockUrl('different-state'),
        } as never)
      } catch {
        // Expected redirect
      }

      expect(cookies.delete).toHaveBeenCalledWith('kelp_pending_auth', {
        path: '/',
      })
    })
  })
})
