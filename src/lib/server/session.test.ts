import { describe, it, expect } from 'vitest'
import {
  createSession,
  addAccount,
  removeAccount,
  switchAccount,
  encryptSession,
  decryptSession,
  asDID,
  asHandle,
  asInstanceURL,
  asSealedToken,
  asSessionId,
  isValidDID,
  isValidHandle,
  isValidInstanceURL,
  tryAsDID,
  tryAsHandle,
  tryAsInstanceURL,
  toClientAccount,
  toClientSession,
  type AppSession,
  type AccountSession,
  type AccountId,
} from './session'

// Valid AccountId for testing (32 hex characters)
const TEST_ACCOUNT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1' as AccountId

describe('createSession', () => {
  it('returns empty session with null activeAccountId', () => {
    const session = createSession()
    expect(session.activeAccountId).toBeNull()
  })

  it('returns empty accounts array', () => {
    const session = createSession()
    expect(session.accounts).toEqual([])
  })
})

describe('addAccount', () => {
  const mockAccount: Omit<AccountSession, 'id'> = {
    did: asDID('did:plc:abc123'),
    handle: asHandle('alice.bsky.social'),
    instance: asInstanceURL('https://bsky.social'),
    sealedToken: asSealedToken('encrypted-token-data'),
    sessionId: asSessionId('session-123'),
    avatar: 'https://example.com/avatar.png',
  }

  it('adds account to empty session', () => {
    const session = createSession()
    const updated = addAccount(session, mockAccount)

    expect(updated.accounts).toHaveLength(1)
    expect(updated.accounts[0].did).toBe('did:plc:abc123')
    expect(updated.accounts[0].handle).toBe('alice.bsky.social')
    expect(updated.accounts[0].instance).toBe('https://bsky.social')
    expect(updated.accounts[0].sealedToken).toBe('encrypted-token-data')
    expect(updated.accounts[0].sessionId).toBe('session-123')
    expect(updated.accounts[0].avatar).toBe('https://example.com/avatar.png')
  })

  it('sets new account as active', () => {
    const session = createSession()
    const updated = addAccount(session, mockAccount)

    expect(updated.activeAccountId).toBe(updated.accounts[0].id)
  })

  it('generates unique id for account', () => {
    const session = createSession()
    const updated = addAccount(session, mockAccount)

    expect(updated.accounts[0].id).toBeDefined()
    expect(typeof updated.accounts[0].id).toBe('string')
    expect(updated.accounts[0].id.length).toBeGreaterThan(0)
  })

  it('preserves existing accounts when adding', () => {
    const session = createSession()
    const firstAccount: Omit<AccountSession, 'id'> = {
      did: asDID('did:plc:first'),
      handle: asHandle('first.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('token-1'),
      sessionId: asSessionId('session-1'),
    }
    const secondAccount: Omit<AccountSession, 'id'> = {
      did: asDID('did:plc:second'),
      handle: asHandle('second.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('token-2'),
      sessionId: asSessionId('session-2'),
    }

    const withFirst = addAccount(session, firstAccount)
    const withBoth = addAccount(withFirst, secondAccount)

    expect(withBoth.accounts).toHaveLength(2)
    expect(withBoth.accounts[0].did).toBe('did:plc:first')
    expect(withBoth.accounts[1].did).toBe('did:plc:second')
  })

  it('generates different ids for different accounts', () => {
    const session = createSession()
    const firstAccount: Omit<AccountSession, 'id'> = {
      did: asDID('did:plc:first'),
      handle: asHandle('first.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('token-1'),
      sessionId: asSessionId('session-1'),
    }
    const secondAccount: Omit<AccountSession, 'id'> = {
      did: asDID('did:plc:second'),
      handle: asHandle('second.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('token-2'),
      sessionId: asSessionId('session-2'),
    }

    const withFirst = addAccount(session, firstAccount)
    const withBoth = addAccount(withFirst, secondAccount)

    expect(withBoth.accounts[0].id).not.toBe(withBoth.accounts[1].id)
  })
})

describe('removeAccount', () => {
  const createSessionWithAccounts = (): AppSession => {
    let session = createSession()
    session = addAccount(session, {
      did: asDID('did:plc:first'),
      handle: asHandle('first.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('token-1'),
      sessionId: asSessionId('session-1'),
    })
    session = addAccount(session, {
      did: asDID('did:plc:second'),
      handle: asHandle('second.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('token-2'),
      sessionId: asSessionId('session-2'),
    })
    return session
  }

  it('removes account by id', () => {
    const session = createSessionWithAccounts()
    const accountToRemove = session.accounts[0]
    const updated = removeAccount(session, accountToRemove.id)

    expect(updated.accounts).toHaveLength(1)
    expect(updated.accounts[0].did).toBe('did:plc:second')
  })

  it('sets activeAccountId to null if removed account was active', () => {
    const session = createSessionWithAccounts()
    // The active account is the last added one (second)
    const activeId = session.activeAccountId!
    const updated = removeAccount(session, activeId)

    expect(updated.activeAccountId).toBeNull()
  })

  it('keeps activeAccountId if different account removed', () => {
    const session = createSessionWithAccounts()
    const activeId = session.activeAccountId!
    // Remove the first account (not active)
    const firstAccountId = session.accounts[0].id
    const updated = removeAccount(session, firstAccountId)

    expect(updated.activeAccountId).toBe(activeId)
  })

  it('handles removing non-existent account gracefully', () => {
    const session = createSessionWithAccounts()
    // Use a valid AccountId format that doesn't exist in the session
    const nonExistentId = 'ffffffffffffffffffffffffffffffff' as AccountId
    const updated = removeAccount(session, nonExistentId)

    expect(updated.accounts).toHaveLength(2)
    expect(updated.activeAccountId).toBe(session.activeAccountId)
  })
})

describe('switchAccount', () => {
  const createSessionWithAccounts = (): AppSession => {
    let session = createSession()
    session = addAccount(session, {
      did: asDID('did:plc:first'),
      handle: asHandle('first.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('token-1'),
      sessionId: asSessionId('session-1'),
    })
    session = addAccount(session, {
      did: asDID('did:plc:second'),
      handle: asHandle('second.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('token-2'),
      sessionId: asSessionId('session-2'),
    })
    return session
  }

  it('changes activeAccountId to specified account', () => {
    const session = createSessionWithAccounts()
    const firstAccountId = session.accounts[0].id
    const updated = switchAccount(session, firstAccountId)

    expect(updated.activeAccountId).toBe(firstAccountId)
  })

  it('throws error for non-existent account id', () => {
    const session = createSessionWithAccounts()
    // Use a valid AccountId format that doesn't exist in the session
    const nonExistentId = 'ffffffffffffffffffffffffffffffff' as AccountId

    expect(() => switchAccount(session, nonExistentId)).toThrow(
      'Account not found'
    )
  })
})

describe('encryptSession / decryptSession', () => {
  // 32-byte hex string (64 characters) for AES-256
  const validSecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  const differentSecret = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

  const createTestSession = (): AppSession => {
    let session = createSession()
    session = addAccount(session, {
      did: asDID('did:plc:test'),
      handle: asHandle('test.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('test-token'),
      sessionId: asSessionId('test-session'),
      avatar: 'https://example.com/avatar.png',
    })
    return session
  }

  it('roundtrips session data correctly', () => {
    const session = createTestSession()
    const encrypted = encryptSession(session, validSecret)
    const decrypted = decryptSession(encrypted, validSecret)

    expect(decrypted).not.toBeNull()
    expect(decrypted!.activeAccountId).toBe(session.activeAccountId)
    expect(decrypted!.accounts).toHaveLength(1)
    expect(decrypted!.accounts[0].did).toBe('did:plc:test')
    expect(decrypted!.accounts[0].handle).toBe('test.example.com')
    expect(decrypted!.accounts[0].instance).toBe('https://example.com')
    expect(decrypted!.accounts[0].sealedToken).toBe('test-token')
    expect(decrypted!.accounts[0].sessionId).toBe('test-session')
    expect(decrypted!.accounts[0].avatar).toBe('https://example.com/avatar.png')
  })

  it('produces different ciphertext each time (random IV)', () => {
    const session = createTestSession()
    const encrypted1 = encryptSession(session, validSecret)
    const encrypted2 = encryptSession(session, validSecret)

    expect(encrypted1).not.toBe(encrypted2)
  })

  it('decryptSession returns null for invalid data', () => {
    const result = decryptSession('invalid-data', validSecret)
    expect(result).toBeNull()
  })

  it('decryptSession returns null for tampered data', () => {
    const session = createTestSession()
    const encrypted = encryptSession(session, validSecret)
    // Tamper with the encrypted data
    const tampered = encrypted.slice(0, -4) + 'xxxx'
    const result = decryptSession(tampered, validSecret)
    expect(result).toBeNull()
  })

  it('decryptSession returns null for wrong secret', () => {
    const session = createTestSession()
    const encrypted = encryptSession(session, validSecret)
    const result = decryptSession(encrypted, differentSecret)
    expect(result).toBeNull()
  })

  it('handles empty session correctly', () => {
    const session = createSession()
    const encrypted = encryptSession(session, validSecret)
    const decrypted = decryptSession(encrypted, validSecret)

    expect(decrypted).not.toBeNull()
    expect(decrypted!.activeAccountId).toBeNull()
    expect(decrypted!.accounts).toEqual([])
  })

  it('handles session with multiple accounts', () => {
    let session = createSession()
    session = addAccount(session, {
      did: asDID('did:plc:first'),
      handle: asHandle('first.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('token-1'),
      sessionId: asSessionId('session-1'),
    })
    session = addAccount(session, {
      did: asDID('did:plc:second'),
      handle: asHandle('second.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('token-2'),
      sessionId: asSessionId('session-2'),
    })

    const encrypted = encryptSession(session, validSecret)
    const decrypted = decryptSession(encrypted, validSecret)

    expect(decrypted).not.toBeNull()
    expect(decrypted!.accounts).toHaveLength(2)
    expect(decrypted!.accounts[0].did).toBe('did:plc:first')
    expect(decrypted!.accounts[1].did).toBe('did:plc:second')
  })
})

// ============================================================================
// Branded Types Tests
// ============================================================================

describe('DID validation', () => {
  it('validates correct DID format', () => {
    expect(isValidDID('did:plc:abc123')).toBe(true)
    expect(isValidDID('did:web:example.com')).toBe(true)
    expect(isValidDID('did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK')).toBe(true)
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
    expect(() => asInstanceURL('invalid')).toThrow('Invalid Instance URL format')
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

describe('toClientAccount / toClientSession', () => {
  it('removes sensitive data from AccountSession', () => {
    const account: AccountSession = {
      id: TEST_ACCOUNT_ID,
      did: asDID('did:plc:test'),
      handle: asHandle('test.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('secret-token'),
      sessionId: asSessionId('session-123'),
      avatar: 'https://example.com/avatar.png',
    }

    const clientAccount = toClientAccount(account)

    expect(clientAccount.id).toBe(TEST_ACCOUNT_ID)
    expect(clientAccount.did).toBe('did:plc:test')
    expect(clientAccount.handle).toBe('test.example.com')
    expect(clientAccount.instance).toBe('https://example.com')
    expect(clientAccount.avatar).toBe('https://example.com/avatar.png')
    expect('sealedToken' in clientAccount).toBe(false)
    expect('sessionId' in clientAccount).toBe(false)
  })

  it('converts full session to client-safe session', () => {
    let session = createSession()
    session = addAccount(session, {
      did: asDID('did:plc:test'),
      handle: asHandle('test.example.com'),
      instance: asInstanceURL('https://example.com'),
      sealedToken: asSealedToken('secret-token'),
      sessionId: asSessionId('session-123'),
    })

    const clientSession = toClientSession(session)

    expect(clientSession.activeAccountId).toBe(session.activeAccountId)
    expect(clientSession.accounts).toHaveLength(1)
    expect('sealedToken' in clientSession.accounts[0]).toBe(false)
    expect('sessionId' in clientSession.accounts[0]).toBe(false)
  })
})
