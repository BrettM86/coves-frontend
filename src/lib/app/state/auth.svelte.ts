import { browser } from '$app/environment'
import { DEFAULT_INSTANCE_URL } from './instance/env'
import { log } from '$lib/app/util/log'
import { currentRequestEvent } from '$lib/app/util/request-event'
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
        log.warn(
          `localStorage key "${key}" contains invalid data structure - clearing corrupted data`,
        )
        localStorage.removeItem(key)
        return undefined
      }
    }

    return parsed as T
  } catch (err) {
    log.warn(`Failed to parse localStorage key "${key}"`, err)
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
  #sessionGeneration = $state<string>()
  #sessionExpired = $state(false)
  /**
   * The server said the current generation is dead. A client-side 401 alone
   * only makes the expiration suspected: the backend may have answered one
   * write with 401 during an outage while the cookie is still good, and a
   * suspected generation must be able to come back.
   */
  #sessionExpirationConfirmed = $state(false)
  /**
   * The reader dismissed the expiration prompt. Only the prompt goes away:
   * the session stays expired, so open drafts keep their editors, until a
   * real verdict or a new login replaces it.
   */
  #sessionExpirationDismissed = $state(false)
  /**
   * SessionRecovery has asked the server for the current session state, and
   * the next root data is that answer rather than a response that was already
   * in flight. While an expiration is suspected, that answer is the verdict:
   * only it may revive the generation the 401 named, and an answer with no
   * cookie at all confirms the expiration instead of being ignored as stale.
   */
  #verdictRequested = false
  /** Generations that can never authenticate again: confirmed dead, or superseded. */
  #retiredGenerations = new Set<string>()

  get sessionGeneration(): string | undefined {
    return browser ? this.#sessionGeneration : undefined
  }

  get sessionExpired(): boolean {
    return browser ? this.#sessionExpired : false
  }

  get sessionExpirationConfirmed(): boolean {
    return browser ? this.#sessionExpirationConfirmed : false
  }

  get sessionExpirationDismissed(): boolean {
    return browser ? this.#sessionExpirationDismissed : false
  }

  expireSession(generation: string | undefined): void {
    if (
      !browser ||
      !this.isAuthenticated ||
      generation !== this.#sessionGeneration
    )
      return
    this.#sessionExpired = true
    this.#sessionExpirationConfirmed = false
    this.#sessionExpirationDismissed = false
    this.#verdictRequested = false
    this.#meta.profiles = [createGuestProfile()]
    this.#meta.profile = 'guest'
  }

  /**
   * Marks the next root session data as an answer SessionRecovery asked for.
   * Called right before `invalidate('app:session')`. While an expiration is
   * suspected that answer is the server's verdict: re-authenticating the same
   * generation restores the session, and no cookie at all confirms the
   * expiration.
   */
  beginSessionRevalidation(): void {
    if (!browser) return
    this.#verdictRequested = true
  }

  /**
   * Hides the expiration prompt after the reader dismissed it. The session
   * stays expired, not a guest, so editors holding drafts stay mounted; a
   * later login is adopted from root data as usual.
   */
  dismissSessionExpiration(): void {
    if (!browser) return
    if (this.#sessionExpired) this.#sessionExpirationDismissed = true
  }

  #meta = $state<ProfileData>(
    getFromStorage<ProfileData>('profileData', isValidProfileData) ?? {
      profiles: [createGuestProfile()],
      profile: 'guest',
    },
  )

  /**
   * The account list this read belongs to.
   *
   * In the browser it is module state, restored from localStorage. During a
   * server render it describes the in-flight request instead: the account
   * switcher and the sidebar render from `meta`, and one process renders every
   * visitor, so module state here would show them the previous request's
   * account.
   *
   * Outside a request — module evaluation, a unit test, a background job —
   * there is no visitor to describe and the process's own state is all there
   * is. That state is a lone guest unless something on this process wrote to
   * it, and only browser-side code paths do.
   */
  get meta(): ProfileData {
    if (browser) return this.#meta

    const event = currentRequestEvent()
    if (event === undefined) return this.#meta

    const current = profileFromSession(sessionFromLocals(event.locals.auth))
    return { profiles: [current], profile: current.id }
  }

  #current = $derived(
    this.meta.profiles.find((i) => i.id == this.meta.profile) ??
      createGuestProfile(),
  )

  getDefaultProfile(): ProfileInfo {
    return createGuestProfile()
  }

  /**
   * The profile this read belongs to.
   *
   * In the browser that is module state, backed by localStorage — one user,
   * one answer. On the server one process renders every visitor, so the answer
   * comes from the request that is currently executing and nothing is
   * remembered between requests: a logged-in render must never leave its
   * account visible to the anonymous render running beside it.
   */
  get current(): ProfileInfo {
    if (browser) return this.#current
    return profileFromSession(
      sessionFromLocals(currentRequestEvent()?.locals.auth),
    )
  }

  set current(value: ProfileInfo) {
    if (!value) return
    // `meta` is shared by every in-flight request on the server, where the
    // request — not an assignment — decides who is signed in.
    if (!browser) return
    const index = this.meta.profiles.findLastIndex((i) => i.id === value.id)
    if (index != -1) this.meta.profiles[index] = value
  }

  /**
   * Synchronize client state with server session data.
   * Called on page load to ensure client and server are in sync.
   *
   * @param serverSession - The session data from the server (passed via page data)
   */
  syncFromServer(
    serverSession: ServerSession | undefined,
    metadata?: { sessionGeneration?: string; sessionExpired?: boolean },
  ): void {
    if (browser) {
      const generation = serverSession?.authenticated
        ? serverSession.sessionGeneration
        : metadata?.sessionGeneration
      if (generation && this.#retiredGenerations.has(generation)) return
      const suspected =
        this.#sessionExpired && !this.#sessionExpirationConfirmed
      if (
        !serverSession?.authenticated &&
        metadata &&
        !generation &&
        this.#verdictRequested &&
        this.#sessionGeneration
      ) {
        // The answer we asked for found no cookie at all: it expired in the
        // browser or another tab removed it. The generation we remember is
        // dead, and the verdict is confirmed rather than ignored as stale.
        this.#retiredGenerations.add(this.#sessionGeneration)
        this.#sessionExpired = true
        this.#sessionExpirationConfirmed = true
        this.#verdictRequested = false
        this.#meta.profiles = [createGuestProfile()]
        this.#meta.profile = 'guest'
        return
      }
      if (!serverSession?.authenticated && metadata) {
        // Unidentified anonymous data can predate login. A failed validation
        // without expiration is not evidence that our live session ended.
        if (this.#sessionGeneration && generation !== this.#sessionGeneration)
          return
        if (
          this.#sessionGeneration &&
          (this.isAuthenticated || suspected) &&
          !metadata.sessionExpired
        )
          return
      } else if (
        serverSession?.authenticated &&
        suspected &&
        generation === this.#sessionGeneration &&
        !this.#verdictRequested
      ) {
        // Authenticated data for the suspected generation that nobody asked
        // for was in flight before the 401 and cannot outrank it.
        return
      }
      if (generation !== this.#sessionGeneration && this.#sessionGeneration) {
        this.#retiredGenerations.add(this.#sessionGeneration)
      }
      this.#sessionGeneration = generation
      this.#sessionExpired = metadata?.sessionExpired ?? false
      this.#sessionExpirationConfirmed = this.#sessionExpired
      if (!this.#sessionExpired) this.#sessionExpirationDismissed = false
      this.#verdictRequested = false
      if (this.#sessionExpired && generation)
        this.#retiredGenerations.add(generation)
    }
    if (!serverSession || !serverSession.authenticated) {
      // The server is the source of truth. If it reports no session (cookie
      // expired, revoked, or cleared) drop any persisted authenticated
      // profile so a shared device doesn't keep showing the previous user's
      // handle and avatar as if they were still signed in. Signed-out state
      // is exactly one guest: Photon let readers keep several guest profiles
      // pointed at different instances, and with the switcher gone a stale
      // list would have no UI left to fix it through.
      const [only] = this.meta.profiles
      const canonical =
        this.meta.profiles.length === 1 &&
        only.type === 'guest' &&
        only.id === 'guest' &&
        only.instance === DEFAULT_INSTANCE_URL
      if (!canonical || this.meta.profile !== 'guest') {
        this.meta.profiles = [createGuestProfile()]
        this.meta.profile = 'guest'
      }
      return
    }

    // Through the shared mapper, so what the client adopts here and what the
    // server render produced cannot drift apart field by field.
    this.meta.profiles = [profileFromSession(serverSession)]
    this.meta.profile = serverSession.activeAccountId
  }

  /**
   * Remove a profile by calling the server logout endpoint.
   * The server handles token cleanup and session management.
   *
   * @returns LogoutResult indicating success/failure and any warnings.
   * Local state is NOT cleared if the server logout fails, except on 401
   * (session already expired server-side), which is treated as logged out.
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
      log.error('Logout request failed', err)
      return {
        success: false,
        error: `Logout failed: ${errorMsg}. Please try again.`,
      }
    }

    if (response.status === 401) {
      // Session already gone on the server — treat logout as complete and
      // fall through to clear local state, otherwise the profile is stuck.
      log.warn('[auth] Session already expired; clearing local profile')
    } else if (!response.ok) {
      // Server returned an error - don't clear local state
      let errorMsg = `Server returned status ${response.status}`
      try {
        const errorData = await response.json()
        if (errorData.error) {
          errorMsg = errorData.error
        }
      } catch (err) {
        log.warn('[auth] Failed to parse error response JSON', err)
      }
      log.error('Server logout failed', undefined, { errorMsg })
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
        log.warn('Remote token revocation failed', undefined, {
          remoteLogoutError: data.remoteLogoutError,
        })
      }
    } catch (err) {
      log.warn('[auth] Failed to parse logout response JSON', err)
    }

    if (browser) {
      if (this.#sessionGeneration)
        this.#retiredGenerations.add(this.#sessionGeneration)
      this.#sessionGeneration = undefined
      this.#sessionExpired = false
      this.#sessionExpirationConfirmed = false
      this.#sessionExpirationDismissed = false
      this.#verdictRequested = false
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

  get isDefaultProfile(): boolean {
    // Reads `current`, not `#current`: on the server the profile belongs to
    // the in-flight request, and module state has no say in it.
    const current = this.current
    return current.type === 'guest' && current.instance == DEFAULT_INSTANCE_URL
  }

  /**
   * Check if the current profile is authenticated with valid credentials.
   * With discriminated unions, we can simply check the type field.
   * @returns `true` if the profile is authenticated (type === 'authenticated')
   */
  get isAuthenticated(): boolean {
    return this.current.type === 'authenticated'
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
  isMod(_community?: unknown): boolean {
    if (!this.#warnedIsMod) {
      log.warn(
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
      log.warn(
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
 * Maps a server session onto a client profile.
 *
 * The one place that conversion lives, so the server render (which resolves
 * the profile from the in-flight request) and `syncFromServer` (which adopts
 * it in the browser) cannot drift apart.
 */
export function profileFromSession(
  session: ServerSession | undefined,
): ProfileInfo {
  if (!session?.authenticated) return createGuestProfile()

  return {
    type: 'authenticated',
    id: session.account.id,
    instance: session.account.instance,
    jwt: 'authenticated',
    did: session.account.did,
    handle: session.account.handle,
    avatar: session.account.avatar,
  }
}

/**
 * Narrows the request's auth state to the client-safe session shape.
 *
 * Mirrors `toClientSession` in `$lib/server/session`, which this layer may
 * import types from but not code. The sealed token is deliberately dropped:
 * nothing on a profile is allowed to carry it, since profiles are serialized
 * into the page and into localStorage.
 */
export function sessionFromLocals(
  auth: App.AuthState | undefined,
): ServerSession | undefined {
  if (!auth?.authenticated) return undefined

  const { account } = auth
  return {
    authenticated: true,
    // The UI identifies accounts by `id`; the DID is what fills that role.
    activeAccountId: account.did,
    account: {
      id: account.did,
      did: account.did,
      handle: account.handle,
      instance: account.instance,
      avatar: account.avatar,
    },
  }
}

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
