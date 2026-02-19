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
 * Branded type for sealed (encrypted) authentication tokens.
 * These tokens are encrypted by the Coves backend and should be treated as opaque.
 * They are used for API authentication via the Authorization header.
 */
export type SealedToken = string & { readonly __brand: 'SealedToken' }

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
    value,
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
  /** The DID (Decentralized Identifier) of the account */
  readonly did: DID
  /** The handle/username of the account */
  readonly handle: Handle
  /** The instance/server the account belongs to */
  readonly instance: InstanceURL
  /** Sealed access token for API calls (sealed = encrypted by Coves backend) */
  readonly sealedToken: SealedToken
  /** Optional avatar URL */
  readonly avatar?: string
}

/**
 * Client-safe account data (excludes sensitive tokens).
 * This is what gets passed to the client via page data.
 * Derived from AccountSession to ensure types stay in sync.
 */
export type ClientAccount = Omit<AccountSession, 'sealedToken'> & { id: string }

/**
 * Unauthenticated client session -- no valid account.
 */
interface UnauthenticatedClientSession {
  readonly authenticated: false
  readonly activeAccountId: null
  readonly account: null
}

/**
 * Authenticated client session -- valid account present.
 */
interface AuthenticatedClientSession {
  readonly authenticated: true
  readonly activeAccountId: string
  readonly account: ClientAccount
}

/**
 * Client-safe session data (excludes sensitive tokens).
 * This is what gets passed to the client via page data.
 *
 * Uses a discriminated union so that `authenticated: true` guarantees
 * both `activeAccountId` and `account` are non-null, and vice-versa.
 */
export type ClientSession =
  | UnauthenticatedClientSession
  | AuthenticatedClientSession

/**
 * Response from Go backend's /api/me endpoint.
 * Returns profile data from the database after validating the session.
 */
interface ApiMeResponse {
  did: string
  handle: string
  avatar?: string
}

/**
 * Converts an AccountSession to a ClientAccount by removing sensitive data.
 */
export function toClientAccount(account: AccountSession): ClientAccount {
  return {
    // Use DID as the client-facing ID because the UI components (ProfileSelection,
    // accounts page, etc.) identify accounts by an `id` field rather than `did`.
    id: account.did,
    did: account.did,
    handle: account.handle,
    instance: account.instance,
    avatar: account.avatar,
  }
}

/**
 * Converts an AccountSession (or null) to a ClientSession.
 */
export function toClientSession(account: AccountSession | null): ClientSession {
  if (!account) {
    return { authenticated: false, activeAccountId: null, account: null }
  }
  const clientAccount = toClientAccount(account)
  return {
    authenticated: true,
    activeAccountId: clientAccount.id,
    account: clientAccount,
  }
}

/**
 * Validates that a URL string uses a safe protocol (http: or https:).
 * Rejects javascript:, data:, and other potentially dangerous URI schemes.
 */
function isSafeAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Parses and validates a /api/me response into an AccountSession.
 * Combines the API response with the instance URL and sealed token (from cookie).
 * Returns null if validation fails. Logs warnings for each specific validation failure
 * to aid debugging.
 */
export function parseApiMeResponse(
  data: unknown,
  instance: InstanceURL,
  sealedToken: SealedToken,
): AccountSession | null {
  if (typeof data !== 'object' || data === null) {
    console.error(
      '[parseApiMeResponse] Invalid input: expected object, got',
      typeof data,
    )
    return null
  }
  const obj = data as Record<string, unknown>

  if (typeof obj.did !== 'string') {
    console.error('[parseApiMeResponse] Missing or non-string "did" field')
    return null
  }
  if (!isValidDID(obj.did)) {
    console.error('[parseApiMeResponse] Invalid DID format:', obj.did)
    return null
  }

  if (typeof obj.handle !== 'string') {
    console.error('[parseApiMeResponse] Missing or non-string "handle" field')
    return null
  }
  if (!isValidHandle(obj.handle)) {
    console.error('[parseApiMeResponse] Invalid handle format:', obj.handle)
    return null
  }

  let avatar: string | undefined
  if (typeof obj.avatar === 'string') {
    if (isSafeAvatarUrl(obj.avatar)) {
      avatar = obj.avatar
    } else {
      console.warn(
        '[parseApiMeResponse] Avatar URL rejected (unsafe protocol or invalid URL):',
        obj.avatar,
      )
      avatar = undefined
    }
  }

  return {
    did: obj.did as DID,
    handle: obj.handle as Handle,
    instance,
    sealedToken,
    avatar,
  }
}
