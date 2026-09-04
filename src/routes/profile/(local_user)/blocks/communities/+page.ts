import { coves } from '$lib/api/client.svelte'
import type { CovesClient } from '$lib/api/coves/client'
import type {
  BlockedCommunityEntry,
  CommunityViewDetailed,
} from '$lib/api/coves/types'
import { log } from '$lib/app/util/log'
import { ReactiveState } from '$lib/app/util/reactive.svelte'

export interface BlockedCommunityRow {
  block: BlockedCommunityEntry
  /** Hydrated community; undefined when lookup failed so unblock stays usable. */
  community?: CommunityViewDetailed
}

const HYDRATION_BATCH_SIZE = 8

async function listAllBlocks(
  api: CovesClient,
): Promise<BlockedCommunityEntry[]> {
  const blocks: BlockedCommunityEntry[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  do {
    const response = await api.getBlockedCommunities({
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    })
    blocks.push(...response.blocks)

    cursor = response.cursor
    if (cursor !== undefined) {
      if (seenCursors.has(cursor)) {
        throw new Error(
          `getBlockedCommunities returned repeated cursor "${cursor}"`,
        )
      }
      seenCursors.add(cursor)
    }
  } while (cursor !== undefined)

  return blocks
}

export async function load({ fetch }) {
  const api = coves({ func: fetch })
  const blocks = await listAllBlocks(api)

  // Avoid turning a large block list into an unbounded burst of detail
  // requests. Batches preserve the list endpoint's ordering while keeping
  // individual hydration failures isolated to their rows.
  const rows: BlockedCommunityRow[] = []
  for (let start = 0; start < blocks.length; start += HYDRATION_BATCH_SIZE) {
    const batch = blocks.slice(start, start + HYDRATION_BATCH_SIZE)
    rows.push(
      ...(await Promise.all(
        batch.map(async (block) => {
          try {
            const community = await api.getCommunity({
              community: block.communityDid,
            })
            return { block, community }
          } catch (error) {
            log.warn(
              '[blocked-communities] community hydration failed; retaining DID-only unblock row',
              error,
              { communityDid: block.communityDid },
            )
            return { block }
          }
        }),
      )),
    )
  }

  return { blockedCommunities: new ReactiveState(rows) }
}
