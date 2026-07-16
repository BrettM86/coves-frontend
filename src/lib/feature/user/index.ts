import { coves } from '$lib/api/client.svelte'
import type { ProfileViewDetailed } from '$lib/api/coves/types'
import type { DID } from '$lib/types/atproto'

/**
 * Block or unblock a user by DID using the Coves XRPC API.
 */
export async function blockUser(block: boolean, did: DID): Promise<void> {
  if (block) {
    await coves().blockUser({ subject: did })
  } else {
    await coves().unblockUser({ subject: did })
  }
}

/**
 * Check whether a profile is blocked by the current viewer.
 * Returns the blocking AT-URI if blocked, or undefined if not.
 */
export function isBlocked(user: ProfileViewDetailed): string | undefined {
  return user.viewer?.blocking
}

let _warnedAddSubscription = false

/**
 * @deprecated Legacy Lemmy code - needs Coves API replacement
 * This is a no-op stub to maintain compilation
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function addSubscription(_community: unknown, _subscribe = true): void {
  if (!_warnedAddSubscription) {
    console.warn(
      'addSubscription() is a stub - TODO(coves-migration): implement Coves subscription management',
    )
    _warnedAddSubscription = true
  }
}

let _warnedHasFavorite = false

/**
 * @deprecated Legacy Lemmy code - needs Coves API replacement
 * Always returns false as favorites are not yet implemented
 */
export function hasFavorite(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _profile: unknown,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _id: number,
): boolean {
  if (!_warnedHasFavorite) {
    console.warn(
      'hasFavorite() is a stub - TODO(coves-migration): implement Coves favorites',
    )
    _warnedHasFavorite = true
  }
  return false
}
