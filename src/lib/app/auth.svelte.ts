import { browser } from '$app/environment'
import { toast } from 'mono-svelte'
import { errorMessage } from './error'
import { DEFAULT_INSTANCE_URL } from './instance.svelte'
import { instanceToURL, moveItem } from './util.svelte'

function getFromStorage<T>(key: string): T | undefined {
  if (!browser) return
  const lc = localStorage.getItem(key)
  if (!lc) return undefined

  try {
    return JSON.parse(lc)
  } catch (err) {
    console.warn(`Failed to parse localStorage key "${key}":`, err)
    localStorage.removeItem(key) // Clear corrupted data
    return undefined
  }
}

function setFromStorage(key: string, item: unknown, stringify: boolean = true) {
  if (!browser) return
  return localStorage.setItem(key, stringify ? JSON.stringify(item) : String(item))
}

export interface ProfileInfo {
  id: number
  instance: string
  jwt?: string        // Sealed token (for API requests)
  did?: string        // ATProto DID (e.g., did:plc:xxx)
  sessionId?: string  // For token refresh
  handle?: string     // User's ATProto handle
  avatar?: string
}

/**
 * What gets stored in localStorage.
 */
interface ProfileData {
  profiles: ProfileInfo[]
  // should be named currentId
  profile: number
}

interface OAuthProfileData {
  instance: string
  token: string       // sealed token
  did: string
  sessionId: string
  handle: string
  avatar?: string
}

interface RefreshTokenResponse {
  sealed_token: string
  access_token: string
}

class Profile {
  meta = $state<ProfileData>(
    getFromStorage<ProfileData>('profileData') ?? {
      profiles: [
        {
          id: 1,
          instance: DEFAULT_INSTANCE_URL,
          handle: 'Guest',
        },
      ],
      profile: 1,
    },
  )

  #current = $derived(
    this.meta.profiles.find((i) => i.id == this.meta.profile) ??
      this.getDefaultProfile(),
  )

  getDefaultProfile(): ProfileInfo {
    return {
      id: -1,
      instance: DEFAULT_INSTANCE_URL,
    }
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
   * Add a new profile from OAuth authentication data.
   */
  async addOAuthProfile(data: OAuthProfileData): Promise<boolean> {
    try {
      const id = Math.max(...this.meta.profiles.map((p) => p.id), 0) + 1

      this.meta.profiles.unshift({
        id,
        instance: data.instance,
        jwt: data.token,
        did: data.did,
        sessionId: data.sessionId,
        handle: data.handle,
        avatar: data.avatar,
      })

      this.meta.profile = id
      return true
    } catch (err) {
      toast({
        content: errorMessage(err as string),
        type: 'error',
      })
      return false
    }
  }

  /**
   * Remove a profile and attempt to logout from the backend.
   */
  async remove(id: number): Promise<void> {
    const profileToRemove = this.meta.profiles.find((p) => p.id === id)

    // Best-effort logout - don't block on failure
    if (profileToRemove?.jwt && profileToRemove?.did && profileToRemove?.sessionId) {
      fetch(`${instanceToURL(profileToRemove.instance)}/oauth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          did: profileToRemove.did,
          session_id: profileToRemove.sessionId,
          sealed_token: profileToRemove.jwt,
        }),
      }).catch((err) => {
        console.warn('OAuth logout failed (session may remain active on server):', err)
      })
    }

    this.meta.profiles.splice(
      this.meta.profiles.findIndex((p) => p.id == id),
      1,
    )

    if (id == this.meta.profile) this.meta.profile = -1
  }

  /**
   * Refresh the current profile's sealed token by calling the OAuth refresh endpoint.
   * Called automatically on 401 responses, or can be called manually.
   * @returns `true` if the token was successfully refreshed, `false` otherwise
   */
  async refreshToken(): Promise<boolean> {
    const current = this.current
    if (!current?.jwt || !current?.did || !current?.sessionId) {
      return false
    }

    try {
      const response = await fetch(
        `${instanceToURL(current.instance)}/oauth/refresh`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            did: current.did,
            session_id: current.sessionId,
            sealed_token: current.jwt,
          }),
        },
      )

      if (!response.ok) return false

      const data: RefreshTokenResponse = await response.json()
      this.updateToken(data.sealed_token)
      return true
    } catch (err) {
      console.warn('Token refresh failed:', err)
      return false
    }
  }

  /**
   * Update the current profile's JWT/sealed token in-place.
   * Used after token refresh to persist the new token.
   * @param token - The new sealed token to store
   */
  updateToken(token: string): void {
    const index = this.meta.profiles.findIndex((p) => p.id === this.meta.profile)
    if (index !== -1) {
      this.meta.profiles[index] = {
        ...this.meta.profiles[index],
        jwt: token,
      }
    }
  }

  move(id: number, up: boolean) {
    try {
      const index = this.meta.profiles.findIndex((i) => i.id == id)
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
    return !this.#current.jwt && this.#current.instance == DEFAULT_INSTANCE_URL
  }

  /**
   * Check if the current profile is authenticated with valid credentials.
   * @returns `true` if the profile has both a JWT and a DID
   */
  get isAuthenticated(): boolean {
    return !!this.#current.jwt && !!this.#current.did
  }

  // TODO(coves-migration): Remove these legacy compatibility stubs when migrating to Coves API
  // These are placeholders to allow the codebase to compile during transition

  #warnedIsMod = false
  #warnedIsAdmin = false

  /**
   * @deprecated Legacy Lemmy compatibility - will be replaced with Coves roles
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isMod(_community?: unknown): boolean {
    if (!this.#warnedIsMod) {
      console.warn('isMod() is a stub - TODO(coves-migration): implement Coves role checks')
      this.#warnedIsMod = true
    }
    return false
  }

  /**
   * @deprecated Legacy Lemmy compatibility - will be replaced with Coves roles
   */
  get isAdmin(): boolean {
    if (!this.#warnedIsAdmin) {
      console.warn('isAdmin is a stub - TODO(coves-migration): implement Coves role checks')
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
      if (serialized.profiles.length == 0) {
        this.meta.profiles = [this.getDefaultProfile()]
        this.meta.profile = 1
      }
    })
  })
}

export const profile = new Profile()

function serializeProfile(profileInfo: ProfileInfo): ProfileInfo {
  // Return a clean copy without any runtime-only data
  return {
    id: profileInfo.id,
    instance: profileInfo.instance,
    jwt: profileInfo.jwt,
    did: profileInfo.did,
    sessionId: profileInfo.sessionId,
    handle: profileInfo.handle,
    avatar: profileInfo.avatar,
  }
}
