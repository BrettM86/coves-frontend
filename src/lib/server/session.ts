import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// ============================================================================
// Branded Types for Type-Safe String Identifiers
// ============================================================================

/**
 * Branded type for ATProto Decentralized Identifiers (DIDs).
 * Example: "did:plc:abc123" or "did:web:example.com"
 */
export type DID = string & { readonly __brand: 'DID' }

/**
 * Branded type for ATProto handles (usernames).
 * Example: "alice.bsky.social" or "bob.example.com"
 */
export type Handle = string & { readonly __brand: 'Handle' }

/**
 * Branded type for instance/server URLs.
 * Example: "https://bsky.social" or "https://coves.example.com"
 */
export type InstanceURL = string & { readonly __brand: 'InstanceURL' }

/**
 * Branded type for account IDs within a session.
 * These are cryptographically random hex strings used to identify accounts.
 * Example: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
 */
export type AccountId = string & { readonly __brand: 'AccountId' }

/**
 * Branded type for sealed (encrypted) authentication tokens.
 * These tokens are encrypted by the Coves backend and should be treated as opaque.
 * They are used for API authentication via the Authorization header.
 */
export type SealedToken = string & { readonly __brand: 'SealedToken' }

/**
 * Branded type for server-side session identifiers.
 * These are used to identify sessions on the Coves backend for revocation.
 */
export type SessionId = string & { readonly __brand: 'SessionId' }

/**
 * Type guard to validate AccountId format and narrow type.
 * Account IDs are 32-character hexadecimal strings (16 bytes).
 *
 * @param value - The string to validate
 * @returns True if the value matches the AccountId format (also narrows type to AccountId)
 */
export function isValidAccountId(value: string): value is AccountId {
  return /^[a-f0-9]{32}$/.test(value)
}

/**
 * Creates a branded AccountId from a string.
 * @throws Error if the value is not a valid AccountId format
 */
export function asAccountId(value: string): AccountId {
  if (!isValidAccountId(value)) {
    throw new Error(`Invalid AccountId format: ${value}`)
  }
  return value
}

/**
 * Safely attempts to create a branded AccountId from a string.
 * @returns The branded AccountId or null if invalid
 */
export function tryAsAccountId(value: string): AccountId | null {
  return isValidAccountId(value) ? value : null
}

/**
 * Creates a branded SealedToken from a string.
 * Sealed tokens are opaque encrypted strings from the Coves backend,
 * so validation is minimal (just non-empty check).
 */
export function asSealedToken(value: string): SealedToken {
  if (!value || value.trim().length === 0) {
    throw new Error('Invalid SealedToken: cannot be empty')
  }
  return value as SealedToken
}

/**
 * Creates a branded SessionId from a string.
 * Session IDs are opaque identifiers from the Coves backend.
 */
export function asSessionId(value: string): SessionId {
  if (!value || value.trim().length === 0) {
    throw new Error('Invalid SessionId: cannot be empty')
  }
  return value as SessionId
}

/**
 * Type guard to validate DID format and narrow type.
 * Validates DID format: did:{method}:{identifier} where method is lowercase letters
 * and identifier contains alphanumeric characters, dots, underscores, percent signs, or hyphens.
 *
 * @param value - The string to validate
 * @returns True if the value matches the DID format (also narrows type to DID)
 */
export function isValidDID(value: string): value is DID {
  return /^did:[a-z]+:[a-zA-Z0-9._%-]+$/.test(value)
}

/**
 * Type guard to validate Handle format and narrow type.
 * Handles are domain-like identifiers (e.g., "user.domain.tld").
 * Must contain at least one dot with alphanumeric segments that may include hyphens.
 *
 * @param value - The string to validate
 * @returns True if the value matches the Handle format (also narrows type to Handle)
 */
export function isValidHandle(value: string): value is Handle {
  // Basic validation: at least one dot, alphanumeric with hyphens
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(
    value
  )
}

/**
 * Type guard to validate Instance URL format and narrow type.
 * Must be a valid URL with http: or https: protocol.
 *
 * @param value - The string to validate
 * @returns True if the value is a valid http/https URL (also narrows type to InstanceURL)
 */
export function isValidInstanceURL(value: string): value is InstanceURL {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Creates a branded DID from a string.
 * @throws Error if the value is not a valid DID format
 */
export function asDID(value: string): DID {
  if (!isValidDID(value)) {
    throw new Error(`Invalid DID format: ${value}`)
  }
  return value as DID
}

/**
 * Creates a branded Handle from a string.
 * @throws Error if the value is not a valid Handle format
 */
export function asHandle(value: string): Handle {
  if (!isValidHandle(value)) {
    throw new Error(`Invalid Handle format: ${value}`)
  }
  return value as Handle
}

/**
 * Creates a branded InstanceURL from a string.
 * @throws Error if the value is not a valid URL
 */
export function asInstanceURL(value: string): InstanceURL {
  if (!isValidInstanceURL(value)) {
    throw new Error(`Invalid Instance URL format: ${value}`)
  }
  return value as InstanceURL
}

/**
 * Safely attempts to create a branded DID from a string.
 * @returns The branded DID or null if invalid
 */
export function tryAsDID(value: string): DID | null {
  return isValidDID(value) ? (value as DID) : null
}

/**
 * Safely attempts to create a branded Handle from a string.
 * @returns The branded Handle or null if invalid
 */
export function tryAsHandle(value: string): Handle | null {
  return isValidHandle(value) ? (value as Handle) : null
}

/**
 * Safely attempts to create a branded InstanceURL from a string.
 * @returns The branded InstanceURL or null if invalid
 */
export function tryAsInstanceURL(value: string): InstanceURL | null {
  return isValidInstanceURL(value) ? (value as InstanceURL) : null
}

// ============================================================================
// Session Types
// ============================================================================

/**
 * Represents a single authenticated account in the session.
 */
export interface AccountSession {
  /** Unique identifier for this account entry in the session */
  id: AccountId
  /** The DID (Decentralized Identifier) of the account */
  did: DID
  /** The handle/username of the account */
  handle: Handle
  /** The instance/server the account belongs to */
  instance: InstanceURL
  /** Sealed access token for API calls (sealed = encrypted by Coves backend) */
  sealedToken: SealedToken
  /** Server-side session identifier */
  sessionId: SessionId
  /** Optional avatar URL */
  avatar?: string
}

/**
 * Client-safe account data (excludes sensitive tokens).
 * This is what gets passed to the client via page data.
 * Derived from AccountSession to ensure types stay in sync.
 */
export type ClientAccount = Omit<AccountSession, 'sealedToken' | 'sessionId'>

/**
 * Client-safe session data (excludes sensitive tokens).
 * This is what gets passed to the client via page data.
 */
export interface ClientSession {
  /** The ID of the currently active account, or null if none */
  activeAccountId: AccountId | null
  /** All authenticated accounts (without sensitive data) */
  accounts: ClientAccount[]
}

/**
 * Represents the complete application session state.
 */
export interface AppSession {
  /** The ID of the currently active account, or null if none */
  activeAccountId: AccountId | null
  /** All authenticated accounts in this session */
  accounts: AccountSession[]
}

/**
 * Converts an AccountSession to a ClientAccount by removing sensitive data.
 */
export function toClientAccount(account: AccountSession): ClientAccount {
  return {
    id: account.id,
    did: account.did,
    handle: account.handle,
    instance: account.instance,
    avatar: account.avatar,
  }
}

/**
 * Converts an AppSession to a ClientSession by removing sensitive data.
 */
export function toClientSession(session: AppSession): ClientSession {
  return {
    activeAccountId: session.activeAccountId,
    accounts: session.accounts.map(toClientAccount),
  }
}

/**
 * Creates a new empty session with no active account and no accounts.
 */
export function createSession(): AppSession {
  return {
    activeAccountId: null,
    accounts: [],
  }
}

/**
 * Generates a cryptographically secure unique ID for an account.
 * Returns a branded AccountId type.
 */
function generateAccountId(): AccountId {
  // randomBytes(16).toString('hex') produces a 32-char hex string
  // which matches the AccountId format
  return randomBytes(16).toString('hex') as AccountId
}

/**
 * Adds a new account to the session. The new account becomes the active account.
 * Returns a new session object (immutable pattern).
 *
 * @param session - The current session state
 * @param account - The account data without an ID (ID will be generated)
 * @returns A new session with the account added and set as active
 */
export function addAccount(
  session: AppSession,
  account: Omit<AccountSession, 'id'>
): AppSession {
  const newAccount: AccountSession = {
    ...account,
    id: generateAccountId(),
  }

  return {
    activeAccountId: newAccount.id,
    accounts: [...session.accounts, newAccount],
  }
}

/**
 * Removes an account from the session by its ID.
 * If the removed account was the active account, activeAccountId is set to null.
 * Returns a new session object (immutable pattern).
 *
 * @param session - The current session state
 * @param accountId - The ID of the account to remove (must be a valid AccountId)
 * @returns A new session with the account removed
 */
export function removeAccount(session: AppSession, accountId: AccountId): AppSession {
  const accountExists = session.accounts.some((acc) => acc.id === accountId)

  if (!accountExists) {
    return session
  }

  const newAccounts = session.accounts.filter((acc) => acc.id !== accountId)
  const wasActive = session.activeAccountId === accountId

  return {
    activeAccountId: wasActive ? null : session.activeAccountId,
    accounts: newAccounts,
  }
}

/**
 * Switches the active account to the specified account ID.
 * Throws an error if the account does not exist.
 *
 * @param session - The current session state
 * @param accountId - The ID of the account to switch to
 * @returns A new session with the specified account as active
 * @throws Error if the account ID does not exist in the session
 */
export function switchAccount(session: AppSession, accountId: AccountId): AppSession {
  const accountExists = session.accounts.some((acc) => acc.id === accountId)

  if (!accountExists) {
    throw new Error('Account not found')
  }

  return {
    ...session,
    activeAccountId: accountId,
  }
}

/**
 * Updates an existing account in the session by DID.
 * If the account exists, updates its data and sets it as active.
 * Returns a new session object (immutable pattern).
 *
 * @param session - The current session state
 * @param did - The DID of the account to update
 * @param updates - Partial account data to update (excluding id and did)
 * @returns Object with updated session and the account ID if found, or null if not found
 */
export function updateAccountByDid(
  session: AppSession,
  did: DID,
  updates: Partial<Omit<AccountSession, 'id' | 'did'>>
): { session: AppSession; accountId: AccountId } | null {
  const accountIndex = session.accounts.findIndex((acc) => acc.did === did)

  if (accountIndex === -1) {
    return null
  }

  const existingAccount = session.accounts[accountIndex]
  const updatedAccount: AccountSession = {
    ...existingAccount,
    ...updates,
  }

  const newAccounts = [...session.accounts]
  newAccounts[accountIndex] = updatedAccount

  return {
    session: {
      activeAccountId: existingAccount.id,
      accounts: newAccounts,
    },
    accountId: existingAccount.id,
  }
}

/**
 * Validates that the session secret is a valid 32-byte hex string.
 * AES-256 requires exactly 32 bytes (256 bits) as the key.
 *
 * @param secret - The secret to validate
 * @throws Error if the secret is not a valid 64-character hex string
 */
function validateSessionSecret(secret: string): void {
  if (typeof secret !== 'string') {
    throw new Error('Session secret must be a string')
  }
  if (secret.length !== 64) {
    throw new Error(
      `Session secret must be exactly 64 hex characters (32 bytes), got ${secret.length} characters`
    )
  }
  if (!/^[a-fA-F0-9]+$/.test(secret)) {
    throw new Error('Session secret must contain only hexadecimal characters (0-9, a-f, A-F)')
  }
}

/**
 * Encrypts a session using AES-256-GCM.
 * Uses a random IV for each encryption to ensure different ciphertext each time.
 *
 * @param session - The session to encrypt
 * @param secret - A 32-byte hex string (64 characters) used as the encryption key
 * @returns Base64-encoded encrypted session data (IV + authTag + ciphertext)
 * @throws Error if the secret is not a valid 64-character hex string
 */
export function encryptSession(session: AppSession, secret: string): string {
  validateSessionSecret(secret)
  const key = Buffer.from(secret, 'hex')
  const iv = randomBytes(12) // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  const plaintext = JSON.stringify(session)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Concatenate IV (12 bytes) + authTag (16 bytes) + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted])
  return combined.toString('base64')
}

/**
 * Type guard to validate if a parsed object is a valid AccountSession.
 * Note: For deserialization, we validate the format of branded types but
 * cast them since the data was previously validated when stored.
 */
function isValidAccountSession(obj: unknown): obj is AccountSession {
  if (typeof obj !== 'object' || obj === null) return false
  const account = obj as Record<string, unknown>

  // Check basic string types
  if (
    typeof account.id !== 'string' ||
    typeof account.did !== 'string' ||
    typeof account.handle !== 'string' ||
    typeof account.instance !== 'string' ||
    typeof account.sealedToken !== 'string' ||
    typeof account.sessionId !== 'string'
  ) {
    return false
  }

  // Validate avatar is optional string
  if (account.avatar !== undefined && typeof account.avatar !== 'string') {
    return false
  }

  // Validate branded type formats
  if (!isValidAccountId(account.id)) {
    return false
  }
  if (!isValidDID(account.did)) {
    return false
  }
  if (!isValidHandle(account.handle)) {
    return false
  }
  if (!isValidInstanceURL(account.instance)) {
    return false
  }

  return true
}

/**
 * Type guard to validate if a parsed object is a valid AppSession.
 */
function isValidAppSession(obj: unknown): obj is AppSession {
  if (typeof obj !== 'object' || obj === null) return false
  const session = obj as Record<string, unknown>

  // Validate activeAccountId is null or a valid AccountId
  if (session.activeAccountId !== null) {
    if (typeof session.activeAccountId !== 'string' || !isValidAccountId(session.activeAccountId)) {
      return false
    }
  }

  // Validate accounts array
  if (!Array.isArray(session.accounts)) {
    return false
  }

  return session.accounts.every(isValidAccountSession)
}

/**
 * Decrypts an encrypted session using AES-256-GCM.
 * Returns null if decryption fails for any reason (invalid data, wrong key, tampering).
 *
 * @param encrypted - Base64-encoded encrypted session data
 * @param secret - A 32-byte hex string (64 characters) used as the decryption key
 * @returns The decrypted session, or null if decryption fails
 */
export function decryptSession(encrypted: string, secret: string): AppSession | null {
  try {
    const key = Buffer.from(secret, 'hex')
    const combined = Buffer.from(encrypted, 'base64')

    // Validate minimum length: IV (12) + authTag (16) + at least some ciphertext
    if (combined.length < 28) {
      console.error('[session] Decryption failed: encrypted data too short (expected >= 28 bytes)')
      return null
    }

    const iv = combined.subarray(0, 12)
    const authTag = combined.subarray(12, 28)
    const ciphertext = combined.subarray(28)

    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])

    let parsed: unknown
    try {
      parsed = JSON.parse(decrypted.toString('utf8'))
    } catch (parseError) {
      console.error('[session] Decryption failed: invalid JSON in decrypted data', parseError)
      return null
    }

    if (!isValidAppSession(parsed)) {
      console.error('[session] Decryption failed: parsed data does not match AppSession schema')
      return null
    }

    return parsed
  } catch (error) {
    console.error('[session] Decryption failed: cryptographic error', error)
    return null
  }
}
