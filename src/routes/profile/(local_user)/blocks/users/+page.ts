import { coves } from '$lib/api/client.svelte'
import type {
  BlockedUserEntry,
  ProfileViewDetailed,
} from '$lib/api/coves/types'
import { ReactiveState } from '$lib/app/util.svelte'

export interface BlockedUserRow {
  block: BlockedUserEntry
  /** Hydrated profile; undefined when the lookup failed (row shows the DID). */
  profile?: ProfileViewDetailed
}

export async function load({ fetch }) {
  const { blocks } = await coves({ func: fetch }).getBlockedUsers()

  // Hydrate profiles in parallel; a failed lookup degrades to a DID-only row
  // rather than dropping the block (the user must always be able to unblock).
  const rows: BlockedUserRow[] = await Promise.all(
    blocks.map(async (block) => {
      try {
        const profile = await coves({ func: fetch }).getProfile({
          actor: block.blockedDid,
        })
        return { block, profile }
      } catch {
        return { block }
      }
    }),
  )

  return { blockedUsers: new ReactiveState(rows) }
}
