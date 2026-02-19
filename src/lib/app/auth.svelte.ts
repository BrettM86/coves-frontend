import { browser } from '$app/environment'
import { DEFAULT_INSTANCE_URL } from './instance.svelte'
import { moveItem } from './util.svelte'
import type {
  ClientSession,
  DID,
  Handle,
  InstanceURL,
} from '$lib/server/session'

function getFromStorage<T>(
  key: string,
  validator?: (data: unknown) => data is T,
): T | undefined {
  if (!browser) return
  const lc = localStorage.getItem(key)
  if (!lc) return undefined

  try {
    const parsed: unknown = JSON.parse(lc)

    // If a validator is provided, use it to validate the parsed data
    if (validator) {
      if (!validator(parsed)) {
        console.warn(
          `localStorage key "${key}" contains invalid data structure - clearing corrupted data`,
        )
        localStorage.removeItem(key)
        return undefined
      }
    }

    return parsed as T
  } catch (err) {
    console.warn(`Failed to parse localStorage key "${key}":`, err)
    localStorage.removeItem(key) // Clear corrupted data
    return undefined
  }
}

function setFromStorage(key: string, item: unknown, stringify: boolean = true) {
  if (!browser) return
  return localStorage.setItem(
    key,
    stringify ? JSON.stringify(item) : String(item),
  )
}

// ============================================================================
// Discriminated Union Types for Profile State
// ============================================================================

/**
 * Base profile fields common to all profile types.
 * @deprecated Use `type` discriminator to narrow to GuestProfile or AuthenticatedProfile
 */
interface BaseProfile {
  id: string
  instance: string
  /**
   * @deprecated Use `profile.isAuthenticated` or `profile.current.type === 'authenticated'` instead.
   * This field exists only for backwards compatibility with legacy code.
   *
   * NOTE: This was previously the actual JWT token string in Lemmy.
   * In ATProto OAuth, tokens are managed server-side.
   * For UI auth-gating, use `profile.isAuthenticated` or check for truthiness.
   * For actual API auth, the server injects tokens from the session cookie.
   */
  jwt?: string
  /**
   * @deprecated Use `profile.current.type === 'authenticated' ? profile.current.handle : undefined` instead.
   * This field exists for backwards compatibility.
   */
  handle?: string
  /**
   * @deprecated Use `profile.current.type === 'authenticated' ? profile.current.did : undefined` instead.
   * This field exists for backwards compatibility.
   */
  did?: string
  /**
   * @deprecated Use `profile.current.type === 'authenticated' ? profile.current.avatar : undefined` instead.
   * This field exists for backwards compatibility.
   */
  avatar?: string
}

/**
 * Represents an unauthenticated guest profile.
 * Guests can browse content but cannot interact with authenticated features.
 */
export interface GuestProfile extends BaseProfile {
  type: 'guest'
  jwt?: undefined
  did?: undefined
  /** Guests can have a display name but not an authenticated handle */
  handle?: string
  avatar?: undefined
}

/**
 * Represents an authenticated user profile with ATProto credentials.
 * These users have logged in via OAuth and can interact with the platform.
 */
export interface AuthenticatedProfile extends BaseProfile {
  type: 'authenticated'
  instance: InstanceURL
  /**
   * @deprecated Legacy compatibility field. Use `profile.isAuthenticated` instead.
   * This is set to 'authenticated' as a marker that the user is authenticated.
   * It is NOT an actual JWT token - tokens are managed server-side in ATProto OAuth.
   *
   * TODO: Remove jwt field - legacy compatibility for code expecting jwt presence.
   * Tokens are now server-side only. This field should be removed once all consumers
   * are updated to use profile.isAuthenticated or profile.current.type === 'authenticated'.
   */
  jwt: 'authenticated'
  /** The DID (Decentralized Identifier) of the account */
  did: DID
  /** The handle/username of the account */
  handle: Handle
  /** Optional avatar URL */
  avatar?: string
}

/**
 * Discriminated union of all profile types.
 * Use the `type` field to narrow the type and access type-specific fields.
 *
 * @example
 * ```typescript
 * if (profile.type === 'authenticated') {
 *   console.log(profile.did) // TypeScript knows `did` exists
 * }
 * ```
 */
export type ProfileInfo = GuestProfile | AuthenticatedProfile

/**
 * Type guard to check if a profile is authenticated.
 */
export function isAuthenticated(
  profile: ProfileInfo,
): profile is AuthenticatedProfile {
  return profile.type === 'authenticated'
}

/**
 * Type guard to check if a profile is a guest.
 */
export function isGuest(profile: ProfileInfo): profile is GuestProfile {
  return profile.type === 'guest'
}

/**
 * What gets stored in localStorage.
 * Note: JWT tokens are no longer stored here for security.
 * They are managed server-side in encrypted session cookies.
 */
interface ProfileData {
  profiles: ProfileInfo[]
  /** The ID of the currently active profile */
  profile: string
}

/**
 * Type guard to validate a ProfileInfo object from localStorage.
 * Validates basic structure without being overly strict.
 *
 * NOTE: This is client-side validation and intentionally differs from server-side validation
 * in session.ts. The server uses branded type validators (isValidDID, isValidHandle,
 * isValidInstanceURL) from session.ts, but that module imports Node's 'crypto' and is
 * server-only. Client-side validation is more lenient because:
 * 1. The data originated from the server (which already validated it strictly)
 * 2. Critical operations still go through the server for re-validation
 * 3. Duplicating the regex patterns would create maintenance burden
 */
function isValidProfileInfo(obj: unknown): obj is ProfileInfo {
  if (typeof obj !== 'object' || obj === null) return false
  const profile = obj as Record<string, unknown>

  // Must have id, instance, and type
  if (typeof profile.id !== 'string' || typeof profile.instance !== 'string') {
    return false
  }

  // Type must be 'guest' or 'authenticated'
  if (profile.type !== 'guest' && profile.type !== 'authenticated') {
    return false
  }

  // Authenticated profiles must have did and handle
  if (profile.type === 'authenticated') {
    if (typeof profile.did !== 'string' || typeof profile.handle !== 'string') {
      return false
    }
  }

  return true
}

/**
 * Type guard to validate ProfileData from localStorage.
 */
function isValidProfileData(obj: unknown): obj is ProfileData {
  if (typeof obj !== 'object' || obj === null) return false
  const data = obj as Record<string, unknown>

  // Must have profile (string) and profiles (array)
  if (typeof data.profile !== 'string') return false
  if (!Array.isArray(data.profiles)) return false

  // Validate each profile in the array
  return data.profiles.every(isValidProfileInfo)
}

/**
 * Server session data passed via page data.
 * This is an alias for ClientSession for clarity in client code.
 *
 * Note: This uses the shared ClientSession type from session.ts to avoid
 * duplicate type definitions between server and client code.
 */
export type ServerSession = ClientSession

/**
 * Result of a logout operation.
 */
export interface LogoutResult {
  success: boolean
  error?: string
  remoteLogoutFailed?: boolean
  remoteLogoutError?: string
}

class Profile {
  meta = $state<ProfileData>(
    getFromStorage<ProfileData>('profileData', isValidProfileData) ?? {
      profiles: [createGuestProfile()],
      profile: 'guest',
    },
  )

  #current = $derived(
    this.meta.profiles.find((i) => i.id == this.meta.profile) ??
      createGuestProfile(),
  )

  getDefaultProfile(): ProfileInfo {
    return createGuestProfile()
  }

  get current() {
    return this.#current
  }

  set current(value) {
    if (!value) return
    const index = this.meta.profiles.findLastIndex((i) => i.id === value.id)
    if (index != -1) this.meta.profiles[index] = value
  }

  /**
   * Synchronize client state with server session data.
   * Called on page load to ensure client and server are in sync.
   *
   * @param serverSession - The session data from the server (passed via page data)
   */
  syncFromServer(serverSession: ServerSession | undefined): void {
    if (!serverSession || !serverSession.authenticated) return

    // Convert server account to client ProfileInfo format
    const serverProfile: AuthenticatedProfile = {
      type: 'authenticated',
      id: serverSession.account.id,
      instance: serverSession.account.instance,
      jwt: 'authenticated',
      did: serverSession.account.did,
      handle: serverSession.account.handle,
      avatar: serverSession.account.avatar,
    }

    // Update local state
    this.meta.profiles = [serverProfile]
    this.meta.profile = serverSession.activeAccountId
  }

  /**
   * Remove a profile by calling the server logout endpoint.
   * The server handles token cleanup and session management.
   *
   * @returns LogoutResult indicating success/failure and any warnings
   * @throws Error if the server logout fails (local state is NOT cleared)
   */
  async remove(id: string): Promise<LogoutResult> {
    const profileToRemove = this.meta.profiles.find((p) => p.id === id)
    if (!profileToRemove) {
      return { success: false, error: 'Profile not found' }
    }

    // Call server logout endpoint
    let response: Response
    try {
      response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } catch (err) {
      // Network error - don't clear local state
      const errorMsg = err instanceof Error ? err.message : 'Network error'
      console.error('Logout request failed:', err)
      return {
        success: false,
        error: `Logout failed: ${errorMsg}. Please try again.`,
      }
    }

    if (!response.ok) {
      // Server returned an error - don't clear local state
      let errorMsg = `Server returned status ${response.status}`
      try {
        const errorData = await response.json()
        if (errorData.error) {
          errorMsg = errorData.error
        }
      } catch (err) {
        console.warn('[auth] Failed to parse error response JSON:', err)
      }
      console.error('Server logout failed:', errorMsg)
      return {
        success: false,
        error: `Logout failed: ${errorMsg}. Please try again.`,
      }
    }

    // Server logout succeeded - now safe to clear local state
    const result: LogoutResult = { success: true }

    // Parse response to check for remote logout warnings
    try {
      const data = await response.json()
      if (data.remoteLogoutFailed) {
        result.remoteLogoutFailed = true
        result.remoteLogoutError = data.remoteLogoutError
        console.warn('Remote token revocation failed:', data.remoteLogoutError)
      }
    } catch (err) {
      console.warn('[auth] Failed to parse logout response JSON:', err)
    }

    // Remove from local state only after successful server logout
    const index = this.meta.profiles.findIndex((p) => p.id === id)
    if (index !== -1) {
      this.meta.profiles.splice(index, 1)
    }

    if (id === this.meta.profile) {
      this.meta.profile =
        this.meta.profiles.length > 0 ? this.meta.profiles[0].id : 'guest'
    }

    return result
  }

  move(id: string, up: boolean) {
    try {
      const index = this.meta.profiles.findIndex((i) => i.id === id)
      this.meta.profiles = moveItem(
        this.meta.profiles,
        index,
        index + (up ? -1 : 1),
      )
    } catch (err) {
      console.warn('Failed to move profile:', err)
    }
  }

  get isDefaultProfile(): boolean {
    // A default/guest profile has type 'guest'
    return (
      this.#current.type === 'guest' &&
      this.#current.instance == DEFAULT_INSTANCE_URL
    )
  }

  /**
   * Check if the current profile is authenticated with valid credentials.
   * With discriminated unions, we can simply check the type field.
   * @returns `true` if the profile is authenticated (type === 'authenticated')
   */
  get isAuthenticated(): boolean {
    return this.#current.type === 'authenticated'
  }

  // TODO(coves-migration): Implement role checking via Coves API when roles endpoint is available.
  // These stubs return false to maintain type safety during the migration from Lemmy.
  // Implementation steps:
  // 1. Define Coves role types (moderator, admin) in src/lib/server/session.ts
  // 2. Add roles field to AccountSession from the /api/me response
  // 3. Replace these stubs with actual role checks against the session data

  #warnedIsMod = false
  #warnedIsAdmin = false

  /**
   * @deprecated Legacy Lemmy compatibility - will be replaced with Coves roles
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isMod(_community?: unknown): boolean {
    if (!this.#warnedIsMod) {
      console.warn(
        'isMod() is a stub - implement when Coves roles API is available',
      )
      this.#warnedIsMod = true
    }
    return false
  }

  /**
   * @deprecated Legacy Lemmy compatibility - will be replaced with Coves roles
   */
  get isAdmin(): boolean {
    if (!this.#warnedIsAdmin) {
      console.warn(
        'isAdmin is a stub - implement when Coves roles API is available',
      )
      this.#warnedIsAdmin = true
    }
    return false
  }

  /**
   * @deprecated Legacy Lemmy compatibility - no longer used in Coves
   */
  get client(): null {
    return null
  }

  mainEffect = $effect.root(() => {
    // Sync with localStorage
    $effect(() => {
      const serialized = {
        ...this.meta,
        profiles: this.meta.profiles.map((p) => serializeProfile(p)),
      }

      setFromStorage('profileData', serialized)

      // no more profiles left
      if (serialized.profiles.length === 0) {
        this.meta.profiles = [createGuestProfile()]
        this.meta.profile = 'guest'
      }
    })
  })
}

export const profile = new Profile()

/**
 * Creates a default guest profile.
 */
function createGuestProfile(): GuestProfile {
  return {
    type: 'guest',
    id: 'guest',
    instance: DEFAULT_INSTANCE_URL,
  }
}

/**
 * Serializes a profile for localStorage storage.
 * Returns a clean copy without any sensitive data.
 */
function serializeProfile(profileInfo: ProfileInfo): ProfileInfo {
  if (profileInfo.type === 'guest') {
    return {
      type: 'guest',
      id: profileInfo.id,
      instance: profileInfo.instance,
    }
  }
  return {
    type: 'authenticated',
    id: profileInfo.id,
    instance: profileInfo.instance,
    jwt: 'authenticated',
    did: profileInfo.did,
    handle: profileInfo.handle,
    avatar: profileInfo.avatar,
  }
}
