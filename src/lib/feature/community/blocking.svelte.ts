// ---------------------------------------------------------------------------
// Community blocking state
//
// A community can be rendered in several places at once (the page header and
// its desktop sidebar, for example). Keep the viewer's optimistic choice in a
// single account-and-DID-keyed layer so every block action agrees while the
// AppView catches up with the record written to the viewer's repository.
//
// Server truth wins when it changes. An override records the value it was
// pressed against and is ignored once a fresh response reports a different
// value.
// ---------------------------------------------------------------------------

import type { CommunityViewerState } from '$lib/api/coves/types'
import { profile } from '$lib/app/state/auth.svelte'
import { log } from '$lib/app/util/log'
import { feeds } from '$lib/feature/feeds/feed.svelte'
import type { DID } from '$lib/types/atproto'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'

export interface BlockableCommunity {
  readonly did: DID
  readonly viewer?: CommunityViewerState
}

export interface CommunityBlockingApi {
  blockCommunity(input: { community: DID }): Promise<void>
  unblockCommunity(input: { community: DID }): Promise<void>
}

interface Override {
  /** The optimistic value shown across every surface. */
  readonly blocked: boolean
  /** The server value this action was based on. */
  readonly serverAtPress: boolean
}

const overrides = new SvelteMap<string, Override>()
const pending = new SvelteSet<string>()

function stateKey(did: DID): string {
  return `${profile.meta.profile}\u0000${did}`
}

function serverValue(community: BlockableCommunity): boolean {
  return community.viewer?.blocked === true
}

/** Whether the viewer blocks this community, including any optimistic change. */
export function isCommunityBlocked(community: BlockableCommunity): boolean {
  const server = serverValue(community)
  const override = overrides.get(stateKey(community.did))
  if (override === undefined || override.serverAtPress !== server) return server
  return override.blocked
}

/** Whether a block/unblock request is in flight for this community. */
export function isCommunityBlockPending(
  community: BlockableCommunity,
): boolean {
  return pending.has(stateKey(community.did))
}

/**
 * Drops an optimistic value after a later server response has moved beyond
 * the value the action was based on. Call this from rendered block controls so
 * an override cannot resurface if the community is changed from another
 * client later in the session.
 */
export function reconcileCommunityBlockState(
  community: BlockableCommunity,
): void {
  const key = stateKey(community.did)
  const override = overrides.get(key)
  if (
    override !== undefined &&
    !pending.has(key) &&
    override.serverAtPress !== serverValue(community)
  ) {
    overrides.delete(key)
  }
}

export type ToggleCommunityBlockOutcome =
  | { kind: 'ok'; blocked: boolean }
  | { kind: 'pending' }
  | { kind: 'error'; error: unknown }

/** Persists an explicit community block state with optimistic rollback. */
export async function setCommunityBlocked(
  community: BlockableCommunity,
  nextBlocked: boolean,
  api: CommunityBlockingApi,
): Promise<ToggleCommunityBlockOutcome> {
  const { did } = community
  const key = stateKey(did)
  if (pending.has(key)) return { kind: 'pending' }

  const wasBlocked = isCommunityBlocked(community)
  if (wasBlocked === nextBlocked) {
    return { kind: 'ok', blocked: nextBlocked }
  }

  const previous = overrides.get(key)

  pending.add(key)
  overrides.set(key, {
    blocked: nextBlocked,
    serverAtPress: serverValue(community),
  })

  try {
    if (nextBlocked) {
      await api.blockCommunity({ community: did })
    } else {
      await api.unblockCommunity({ community: did })
    }
    feeds.delete('/')
    return { kind: 'ok', blocked: nextBlocked }
  } catch (error) {
    log.error('[community-blocking] update failed', error, {
      did,
      wasBlocked,
      nextBlocked,
    })
    if (previous === undefined) {
      overrides.delete(key)
    } else {
      overrides.set(key, previous)
    }
    return { kind: 'error', error }
  } finally {
    pending.delete(key)
  }
}

/**
 * Optimistically flips the community block and persists it.
 *
 * A second request for the same DID is ignored while the first is in flight;
 * requests for different communities may proceed independently. Failures
 * restore the exact override that existed before the attempted toggle.
 */
export async function toggleCommunityBlock(
  community: BlockableCommunity,
  api: CommunityBlockingApi,
): Promise<ToggleCommunityBlockOutcome> {
  return setCommunityBlocked(community, !isCommunityBlocked(community), api)
}

/** Test seam: forget optimistic values after every request has settled. */
export function resetCommunityBlockingState(): void {
  if (pending.size > 0) {
    throw new Error('Cannot reset community blocking state while requests run')
  }
  overrides.clear()
}
