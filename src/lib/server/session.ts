// ============================================================================
// Re-export shared ATProto branded types (defined in $lib/types/atproto.ts)
// ============================================================================

export type { DID, Handle, InstanceURL } from '$lib/types/atproto'
export {
  isValidDID,
  isValidHandle,
  isValidInstanceURL,
  asDID,
  asHandle,
  asInstanceURL,
  tryAsDID,
  tryAsHandle,
  tryAsInstanceURL,
} from '$lib/types/atproto'

// Import for local use within this module
import { isValidDID, isValidHandle } from '$lib/types/atproto'
import type { DID, Handle, InstanceURL } from '$lib/types/atproto'

// ============================================================================
// Server-Only Branded Types
// ============================================================================

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
export interface ApiMeResponse {
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
 * Returns null if validation fails.
 *
 * Identity-level failures (non-object body, missing/invalid DID or handle) are
 * logged at error level: they can only occur when /api/me returns HTTP 200 with
 * a body that breaches the backend contract, which silently logs the user out
 * and warrants investigation. Recoverable issues (e.g. an unsafe avatar URL,
 * which is simply dropped) are logged at warn level.
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
