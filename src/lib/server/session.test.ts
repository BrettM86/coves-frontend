import { describe, it, expect, vi } from 'vitest'
import {
  asDID,
  asHandle,
  asInstanceURL,
  asSealedToken,
  isValidDID,
  isValidHandle,
  isValidInstanceURL,
  tryAsDID,
  tryAsHandle,
  tryAsInstanceURL,
  toClientAccount,
  toClientSession,
  parseApiMeResponse,
  type AccountSession,
} from './session'

// ============================================================================
// Branded Types Tests
// ============================================================================

describe('DID validation', () => {
  it('validates correct DID format', () => {
    expect(isValidDID('did:plc:abc123')).toBe(true)
    expect(isValidDID('did:web:example.com')).toBe(true)
    expect(
      isValidDID('did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'),
    ).toBe(true)
  })

  it('rejects invalid DID format', () => {
    expect(isValidDID('not-a-did')).toBe(false)
    expect(isValidDID('did:')).toBe(false)
    expect(isValidDID('did:plc:')).toBe(false)
    expect(isValidDID('')).toBe(false)
  })

  it('asDID throws for invalid DID', () => {
    expect(() => asDID('invalid')).toThrow('Invalid DID format')
  })

  it('asDID returns branded type for valid DID', () => {
    const did = asDID('did:plc:test123')
    expect(did).toBe('did:plc:test123')
  })

  it('tryAsDID returns null for invalid DID', () => {
    expect(tryAsDID('invalid')).toBeNull()
  })

  it('tryAsDID returns branded type for valid DID', () => {
    const did = tryAsDID('did:plc:test123')
    expect(did).toBe('did:plc:test123')
  })
})

describe('Handle validation', () => {
  it('validates correct Handle format', () => {
    expect(isValidHandle('alice.bsky.social')).toBe(true)
    expect(isValidHandle('user.example.com')).toBe(true)
    expect(isValidHandle('test-user.my-domain.org')).toBe(true)
  })

  it('rejects invalid Handle format', () => {
    expect(isValidHandle('notsingle')).toBe(false)
    expect(isValidHandle('')).toBe(false)
    expect(isValidHandle('.starts.with.dot')).toBe(false)
  })

  it('asHandle throws for invalid Handle', () => {
    expect(() => asHandle('invalid')).toThrow('Invalid Handle format')
  })

  it('asHandle returns branded type for valid Handle', () => {
    const handle = asHandle('user.example.com')
    expect(handle).toBe('user.example.com')
  })

  it('tryAsHandle returns null for invalid Handle', () => {
    expect(tryAsHandle('invalid')).toBeNull()
  })

  it('tryAsHandle returns branded type for valid Handle', () => {
    const handle = tryAsHandle('user.example.com')
    expect(handle).toBe('user.example.com')
  })
})

describe('InstanceURL validation', () => {
  it('validates correct InstanceURL format', () => {
    expect(isValidInstanceURL('https://example.com')).toBe(true)
    expect(isValidInstanceURL('https://bsky.social')).toBe(true)
    expect(isValidInstanceURL('http://localhost:3000')).toBe(true)
  })

  it('rejects invalid InstanceURL format', () => {
    expect(isValidInstanceURL('not-a-url')).toBe(false)
    expect(isValidInstanceURL('')).toBe(false)
    expect(isValidInstanceURL('ftp://example.com')).toBe(false)
  })

  it('asInstanceURL throws for invalid URL', () => {
    expect(() => asInstanceURL('invalid')).toThrow(
      'Invalid Instance URL format',
    )
  })

  it('asInstanceURL returns branded type for valid URL', () => {
    const url = asInstanceURL('https://example.com')
    expect(url).toBe('https://example.com')
  })

  it('tryAsInstanceURL returns null for invalid URL', () => {
    expect(tryAsInstanceURL('invalid')).toBeNull()
  })

  it('tryAsInstanceURL returns branded type for valid URL', () => {
    const url = tryAsInstanceURL('https://example.com')
    expect(url).toBe('https://example.com')
  })
})

// ============================================================================
// parseApiMeResponse Tests
// ============================================================================

describe('parseApiMeResponse', () => {
  const testInstance = asInstanceURL('https://coves.example.com')
  const testToken = asSealedToken('sealed-token-123')

  it('returns AccountSession for valid response', () => {
    const data = {
      did: 'did:plc:user1',
      handle: 'user1.example.com',
    }

    const result = parseApiMeResponse(data, testInstance, testToken)

    expect(result).not.toBeNull()
    expect(result!.did).toBe('did:plc:user1')
    expect(result!.handle).toBe('user1.example.com')
    expect(result!.instance).toBe('https://coves.example.com')
    expect(result!.sealedToken).toBe('sealed-token-123')
    expect(result!.avatar).toBeUndefined()
  })

  it('returns null when did is missing', () => {
    const data = { handle: 'user1.example.com' }
    const result = parseApiMeResponse(data, testInstance, testToken)
    expect(result).toBeNull()
  })

  it('returns null when DID format is invalid', () => {
    const data = { did: 'not-a-did', handle: 'user1.example.com' }
    const result = parseApiMeResponse(data, testInstance, testToken)
    expect(result).toBeNull()
  })

  it('returns null when handle is missing', () => {
    const data = { did: 'did:plc:user1' }
    const result = parseApiMeResponse(data, testInstance, testToken)
    expect(result).toBeNull()
  })

  it('returns null when handle format is invalid', () => {
    const data = { did: 'did:plc:user1', handle: 'invalid' }
    const result = parseApiMeResponse(data, testInstance, testToken)
    expect(result).toBeNull()
  })

  it('includes avatar when present', () => {
    const data = {
      did: 'did:plc:user1',
      handle: 'user1.example.com',
      avatar: 'https://example.com/avatar.png',
    }

    const result = parseApiMeResponse(data, testInstance, testToken)

    expect(result).not.toBeNull()
    expect(result!.avatar).toBe('https://example.com/avatar.png')
  })

  it('sets avatar to undefined when not present', () => {
    const data = {
      did: 'did:plc:user1',
      handle: 'user1.example.com',
    }

    const result = parseApiMeResponse(data, testInstance, testToken)

    expect(result).not.toBeNull()
    expect(result!.avatar).toBeUndefined()
  })

  it('returns null for null input', () => {
    const result = parseApiMeResponse(null, testInstance, testToken)
    expect(result).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(parseApiMeResponse('string', testInstance, testToken)).toBeNull()
    expect(parseApiMeResponse(42, testInstance, testToken)).toBeNull()
    expect(parseApiMeResponse(true, testInstance, testToken)).toBeNull()
    expect(parseApiMeResponse(undefined, testInstance, testToken)).toBeNull()
  })

  it('logs warning when did is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    parseApiMeResponse({ handle: 'user1.example.com' }, testInstance, testToken)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Missing or non-string "did"'),
    )
    warnSpy.mockRestore()
  })

  it('logs warning when DID format is invalid', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    parseApiMeResponse(
      { did: 'not-a-did', handle: 'user1.example.com' },
      testInstance,
      testToken,
    )

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid DID format'),
      'not-a-did',
    )
    warnSpy.mockRestore()
  })

  it('logs warning when handle is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    parseApiMeResponse({ did: 'did:plc:user1' }, testInstance, testToken)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Missing or non-string "handle"'),
    )
    warnSpy.mockRestore()
  })

  it('logs warning when handle format is invalid', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    parseApiMeResponse(
      { did: 'did:plc:user1', handle: 'invalid' },
      testInstance,
      testToken,
    )

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid handle format'),
      'invalid',
    )
    warnSpy.mockRestore()
  })

  it('logs warning for non-object input', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    parseApiMeResponse('string', testInstance, testToken)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid input: expected object'),
      'string',
    )
    warnSpy.mockRestore()
  })

  it('rejects javascript: avatar URLs and sets avatar to undefined', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const data = {
      did: 'did:plc:user1',
      handle: 'user1.example.com',
      avatar: 'javascript:alert(1)',
    }

    const result = parseApiMeResponse(data, testInstance, testToken)

    expect(result).not.toBeNull()
    expect(result!.avatar).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Avatar URL rejected'),
      'javascript:alert(1)',
    )
    warnSpy.mockRestore()
  })

  it('rejects data: avatar URLs and sets avatar to undefined', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const data = {
      did: 'did:plc:user1',
      handle: 'user1.example.com',
      avatar: 'data:text/html,<script>alert(1)</script>',
    }

    const result = parseApiMeResponse(data, testInstance, testToken)

    expect(result).not.toBeNull()
    expect(result!.avatar).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Avatar URL rejected'),
      'data:text/html,<script>alert(1)</script>',
    )
    warnSpy.mockRestore()
  })

  it('accepts https avatar URLs', () => {
    const data = {
      did: 'did:plc:user1',
      handle: 'user1.example.com',
      avatar: 'https://cdn.example.com/avatar.png',
    }

    const result = parseApiMeResponse(data, testInstance, testToken)

    expect(result).not.toBeNull()
    expect(result!.avatar).toBe('https://cdn.example.com/avatar.png')
  })

  it('accepts http avatar URLs', () => {
    const data = {
      did: 'did:plc:user1',
      handle: 'user1.example.com',
      avatar: 'http://localhost:3000/avatar.png',
    }

    const result = parseApiMeResponse(data, testInstance, testToken)

    expect(result).not.toBeNull()
    expect(result!.avatar).toBe('http://localhost:3000/avatar.png')
  })
})

// ============================================================================
// toClientAccount / toClientSession Tests
// ============================================================================

describe('toClientAccount', () => {
  it('removes sealedToken and uses DID as id', () => {
    const account: AccountSession = {
      did: asDID('did:plc:test'),
      handle: asHandle('test.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('secret-token'),
      avatar: 'https://example.com/avatar.png',
    }

    const clientAccount = toClientAccount(account)

    expect(clientAccount.id).toBe('did:plc:test')
    expect(clientAccount.did).toBe('did:plc:test')
    expect(clientAccount.handle).toBe('test.example.com')
    expect(clientAccount.instance).toBe('https://example.com')
    expect(clientAccount.avatar).toBe('https://example.com/avatar.png')
    expect('sealedToken' in clientAccount).toBe(false)
  })
})

describe('toClientSession', () => {
  it('returns unauthenticated session for null account', () => {
    const clientSession = toClientSession(null)

    expect(clientSession.authenticated).toBe(false)
    expect(clientSession.activeAccountId).toBeNull()
    expect(clientSession.account).toBeNull()
  })

  it('returns authenticated session with account for valid AccountSession', () => {
    const account: AccountSession = {
      did: asDID('did:plc:test'),
      handle: asHandle('test.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('secret-token'),
    }

    const clientSession = toClientSession(account)

    expect(clientSession.authenticated).toBe(true)
    expect(clientSession.activeAccountId).toBe('did:plc:test')
    expect(clientSession.account).not.toBeNull()
    if (clientSession.authenticated) {
      expect(clientSession.account.did).toBe('did:plc:test')
      expect('sealedToken' in clientSession.account).toBe(false)
    }
  })
})
