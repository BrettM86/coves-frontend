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
