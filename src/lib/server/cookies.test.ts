import { describe, it, expect, vi } from 'vitest'

// Mock import.meta.env before importing the module
vi.stubGlobal('import', {
  meta: {
    env: {
      PROD: true,
    },
  },
})

describe('cookies configuration', () => {
  describe('SESSION_COOKIE_OPTIONS', () => {
    it('should have httpOnly enabled for security', async () => {
      // Re-import to get fresh module with mocked env
      const { SESSION_COOKIE_OPTIONS } = await import('./cookies')
      expect(SESSION_COOKIE_OPTIONS.httpOnly).toBe(true)
    })

    it('should use lax sameSite for OAuth redirect compatibility', async () => {
      const { SESSION_COOKIE_OPTIONS } = await import('./cookies')
      expect(SESSION_COOKIE_OPTIONS.sameSite).toBe('lax')
    })

    it('should set path to root', async () => {
      const { SESSION_COOKIE_OPTIONS } = await import('./cookies')
      expect(SESSION_COOKIE_OPTIONS.path).toBe('/')
    })

    it('should have a 30-day maxAge', async () => {
      const { SESSION_COOKIE_OPTIONS } = await import('./cookies')
      const thirtyDaysInSeconds = 60 * 60 * 24 * 30
      expect(SESSION_COOKIE_OPTIONS.maxAge).toBe(thirtyDaysInSeconds)
    })
  })

  describe('PENDING_AUTH_COOKIE_OPTIONS', () => {
    it('should have httpOnly enabled for security', async () => {
      const { PENDING_AUTH_COOKIE_OPTIONS } = await import('./cookies')
      expect(PENDING_AUTH_COOKIE_OPTIONS.httpOnly).toBe(true)
    })

    it('should use lax sameSite for OAuth redirect compatibility', async () => {
      const { PENDING_AUTH_COOKIE_OPTIONS } = await import('./cookies')
      expect(PENDING_AUTH_COOKIE_OPTIONS.sameSite).toBe('lax')
    })

    it('should set path to root', async () => {
      const { PENDING_AUTH_COOKIE_OPTIONS } = await import('./cookies')
      expect(PENDING_AUTH_COOKIE_OPTIONS.path).toBe('/')
    })

    it('should have a 10-minute maxAge for short-lived OAuth state', async () => {
      const { PENDING_AUTH_COOKIE_OPTIONS } = await import('./cookies')
      const tenMinutesInSeconds = 60 * 10
      expect(PENDING_AUTH_COOKIE_OPTIONS.maxAge).toBe(tenMinutesInSeconds)
    })
  })

  describe('security considerations', () => {
    it('session cookie should have longer TTL than pending auth cookie', async () => {
      const { SESSION_COOKIE_OPTIONS, PENDING_AUTH_COOKIE_OPTIONS } = await import('./cookies')
      expect(SESSION_COOKIE_OPTIONS.maxAge).toBeGreaterThan(PENDING_AUTH_COOKIE_OPTIONS.maxAge)
    })

    it('both cookies should have httpOnly to prevent XSS access', async () => {
      const { SESSION_COOKIE_OPTIONS, PENDING_AUTH_COOKIE_OPTIONS } = await import('./cookies')
      expect(SESSION_COOKIE_OPTIONS.httpOnly).toBe(true)
      expect(PENDING_AUTH_COOKIE_OPTIONS.httpOnly).toBe(true)
    })

    it('both cookies should have same sameSite policy', async () => {
      const { SESSION_COOKIE_OPTIONS, PENDING_AUTH_COOKIE_OPTIONS } = await import('./cookies')
      expect(SESSION_COOKIE_OPTIONS.sameSite).toBe(PENDING_AUTH_COOKIE_OPTIONS.sameSite)
    })
  })
})
