import {
  describe,
  it,
  expect,
  vi,
  type Mock,
  beforeEach,
  afterEach,
} from 'vitest'
import {
  createMockCookies,
  createMockEvent,
} from '$lib/test-utils/request-event'

// Mock CSRF validation - control per test
let mockValidateOAuthState: Mock

vi.mock('$lib/server/csrf', () => ({
  validateOAuthState: (...args: unknown[]) => mockValidateOAuthState(...args),
}))

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
        await GET(
          createMockEvent({ cookies, url: createMockUrl('some-state') }),
        )
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
        await GET(
          createMockEvent({ cookies, url: createMockUrl('some-state') }),
        )
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
        await GET(
          createMockEvent({ cookies, url: createMockUrl('some-state') }),
        )
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
        await GET(
          createMockEvent({ cookies, url: createMockUrl('some-state') }),
        )
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
        await GET(
          createMockEvent({ cookies, url: createMockUrl('some-state') }),
        )
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
        await GET(
          createMockEvent({ cookies, url: createMockUrl('some-state') }),
        )
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
        await GET(
          createMockEvent({ cookies, url: createMockUrl('some-state') }),
        )
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
        // No state parameter in the URL
        await GET(createMockEvent({ cookies, url: createMockUrl() }))
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
        await GET(
          createMockEvent({ cookies, url: createMockUrl('url-state-value') }),
        )
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
        await GET(
          createMockEvent({ cookies, url: createMockUrl('url-state-value') }),
        )
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
        await GET(
          createMockEvent({
            cookies,
            url: createMockUrl('different-state-bbbb'),
          }),
        )
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
        await GET(createMockEvent({ cookies, url: createMockUrl(testState) }))
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
        await GET(createMockEvent({ cookies, url: createMockUrl(testState) }))
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
        await GET(createMockEvent({ cookies, url: createMockUrl(testState) }))
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
        await GET(createMockEvent({ cookies, url: createMockUrl(testState) }))
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
        await GET(createMockEvent({ cookies, url: createMockUrl(testState) }))
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
        await GET(
          createMockEvent({ cookies, url: createMockUrl('different-state') }),
        )
      } catch {
        // Expected redirect
      }

      expect(cookies.delete).toHaveBeenCalledWith('kelp_pending_auth', {
        path: '/',
      })
    })
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

describe('GET /api/auth/callback structured logging', () => {
  // The OAuth state is a CSRF token; the full value must never reach the log.
  const EXPECTED_STATE = 'EXPECTEDSTATE1234567890'
  const RECEIVED_STATE = 'RECEIVEDSTATE0987654321'

  // Spies are created and restored per test rather than inline, so a failing
  // assertion cannot skip its restore and leak calls into the next test.
  let warnSpy: ReturnType<typeof spyOnWarn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateOAuthState = vi.fn(() => true)
    warnSpy = spyOnWarn()
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('logs a cookie parse failure as one JSON warn line', async () => {
    const { GET } = await import('./+server')

    // Engines differ on whether a JSON.parse error quotes the offending input
    // back, which made the earlier version of this test vacuous. Throw the
    // message ourselves so the secret definitely reaches the logger.
    vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new SyntaxError(
        'Unexpected token in "{\\"state\\":\\"SECRETSTATE\\"}"',
      )
    })

    const cookies = createMockCookies({
      kelp_pending_auth: '{"state":"placeholder","redirect":"/feed"}',
    })

    await expect(
      GET(createMockEvent({ cookies, url: createMockUrl('some-state') })),
    ).rejects.toBeDefined()

    const { raw, line } = singleJsonLine(warnSpy.mock.calls)
    expect(line.level).toBe('warn')
    expect(line.msg).toContain('Failed to parse pending auth cookie')
    expect(line.err).toBeTypeOf('object')
    expect(raw).not.toContain('SECRETSTATE')
  })

  it('logs a state mismatch as one JSON warn line without the full states', async () => {
    const { GET } = await import('./+server')

    mockValidateOAuthState = vi.fn(() => false)
    const cookies = createMockCookies({
      kelp_pending_auth: JSON.stringify({
        state: EXPECTED_STATE,
        redirect: '/feed',
      }),
    })

    await expect(
      GET(createMockEvent({ cookies, url: createMockUrl(RECEIVED_STATE) })),
    ).rejects.toBeDefined()

    const { raw, line } = singleJsonLine(warnSpy.mock.calls)
    expect(line.level).toBe('warn')
    expect(line.msg).toContain('State mismatch')
    // 8-char prefixes are fine for correlation; the full tokens are not.
    expect(raw).not.toContain(EXPECTED_STATE)
    expect(raw).not.toContain(RECEIVED_STATE)
  })
})
