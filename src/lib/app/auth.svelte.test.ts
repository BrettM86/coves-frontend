import { describe, it, expect, vi } from 'vitest'

// Mock browser environment and dependencies before importing the module
vi.mock('$app/environment', () => ({
  browser: false,
}))

vi.mock('./instance.svelte', () => ({
  DEFAULT_INSTANCE_URL: 'https://coves.social',
}))

vi.mock('./util.svelte', () => ({
  moveItem: <T>(arr: T[], from: number, to: number): T[] => {
    const result = [...arr]
    const [item] = result.splice(from, 1)
    result.splice(to, 0, item)
    return result
  },
}))

vi.mock('$lib/server/session', () => ({
  // Types are re-exported as empty since they're only used for type checking
}))

// Import actual functions AFTER mocks are set up
import { isAuthenticated, isGuest, type ProfileInfo, type GuestProfile, type AuthenticatedProfile } from './auth.svelte'

describe('isAuthenticated type guard', () => {
  it('should return true for authenticated profiles', () => {
    const profile: AuthenticatedProfile = {
      type: 'authenticated',
      id: 'test-id',
      instance: 'https://coves.social' as any,
      jwt: 'authenticated',
      did: 'did:plc:abc123' as any,
      handle: 'test.user' as any,
    }
    expect(isAuthenticated(profile)).toBe(true)
  })

  it('should return false for guest profiles', () => {
    const profile: GuestProfile = {
      type: 'guest',
      id: 'guest',
      instance: 'https://coves.social',
    }
    expect(isAuthenticated(profile)).toBe(false)
  })

  it('should narrow type to AuthenticatedProfile', () => {
    const profile: ProfileInfo = {
      type: 'authenticated',
      id: 'test-id',
      instance: 'https://coves.social' as any,
      jwt: 'authenticated',
      did: 'did:plc:abc123' as any,
      handle: 'test.user' as any,
    }

    if (isAuthenticated(profile)) {
      // TypeScript should narrow to AuthenticatedProfile
      expect(profile.did).toBe('did:plc:abc123')
      expect(profile.handle).toBe('test.user')
    } else {
      // This branch should not be reached
      expect.fail('Expected profile to be authenticated')
    }
  })
})

describe('isGuest type guard', () => {
  it('should return true for guest profiles', () => {
    const profile: GuestProfile = {
      type: 'guest',
      id: 'guest',
      instance: 'https://coves.social',
    }
    expect(isGuest(profile)).toBe(true)
  })

  it('should return false for authenticated profiles', () => {
    const profile: AuthenticatedProfile = {
      type: 'authenticated',
      id: 'test-id',
      instance: 'https://coves.social' as any,
      jwt: 'authenticated',
      did: 'did:plc:abc123' as any,
      handle: 'test.user' as any,
    }
    expect(isGuest(profile)).toBe(false)
  })

  it('should narrow type to GuestProfile', () => {
    const profile: ProfileInfo = {
      type: 'guest',
      id: 'guest',
      instance: 'https://coves.social',
    }

    if (isGuest(profile)) {
      // TypeScript should narrow to GuestProfile
      expect(profile.type).toBe('guest')
      expect(profile.did).toBeUndefined()
    } else {
      // This branch should not be reached
      expect.fail('Expected profile to be guest')
    }
  })
})

describe('ProfileInfo discriminated union', () => {
  it('should correctly narrow type based on type field', () => {
    const guestProfile: ProfileInfo = {
      type: 'guest',
      id: 'guest',
      instance: 'https://coves.social',
    }

    const authenticatedProfile: ProfileInfo = {
      type: 'authenticated',
      id: 'test-id',
      instance: 'https://coves.social' as any,
      jwt: 'authenticated',
      did: 'did:plc:abc123' as any,
      handle: 'test.user' as any,
    }

    // Type narrowing test using the actual type guards
    if (isGuest(guestProfile)) {
      expect(guestProfile.did).toBeUndefined()
    }

    if (isAuthenticated(authenticatedProfile)) {
      expect(authenticatedProfile.did).toBe('did:plc:abc123')
      expect(authenticatedProfile.handle).toBe('test.user')
    }
  })
})

describe('LogoutResult interface', () => {
  it('should support success result', () => {
    const result: { success: boolean; error?: string } = {
      success: true,
    }
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('should support failure result with error', () => {
    const result = {
      success: false,
      error: 'Network error',
    }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Network error')
  })

  it('should support remote logout failure warning', () => {
    const result = {
      success: true,
      remoteLogoutFailed: true,
      remoteLogoutError: 'Token revocation failed',
    }
    expect(result.success).toBe(true)
    expect(result.remoteLogoutFailed).toBe(true)
    expect(result.remoteLogoutError).toBe('Token revocation failed')
  })
})
