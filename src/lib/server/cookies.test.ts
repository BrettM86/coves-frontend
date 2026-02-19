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
})
