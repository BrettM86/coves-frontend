import { client } from '$lib/api/client.svelte'
import type { MyUserInfo } from '$lib/api/types'

// TODO(coves-migration): This file contains legacy Lemmy code that needs to be rewritten for Coves API

export async function blockUser(block: boolean, id: number) {
  return await client().blockPerson({
    block: block,
    person_id: id,
  })
}

export function isBlocked(me: MyUserInfo, user: number) {
  return me.person_blocks.find((b) => b.target.id == user)
}

let _warnedAddSubscription = false

/**
 * @deprecated Legacy Lemmy code - needs Coves API replacement
 * This is a no-op stub to maintain compilation
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function addSubscription(_community: unknown, _subscribe = true): void {
  if (!_warnedAddSubscription) {
    console.warn('addSubscription() is a stub - TODO(coves-migration): implement Coves subscription management')
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
    console.warn('hasFavorite() is a stub - TODO(coves-migration): implement Coves favorites')
    _warnedHasFavorite = true
  }
  return false
}
