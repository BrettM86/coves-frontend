// ---------------------------------------------------------------------------
// Community subscription state
//
// One optimistic layer for every surface that shows a subscribe button
// (header, card, list row, tile). State is keyed by community DID rather than
// held per component, so a community rendered twice at once — a list row and
// the info card it opens in a modal — always agrees with itself, regardless
// of which component owns the `community` prop.
//
// Server truth still wins on the next load: an override remembers the server
// value it was pressed against and is ignored as soon as fresh data disagrees
// with that snapshot.
// ---------------------------------------------------------------------------

import { log } from '$lib/app/util/log'
import type { CommunityViewerState } from '$lib/api/coves/types'
import type { DID } from '$lib/types/atproto'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'

export interface SubscribableCommunity {
  readonly did: DID
  readonly viewer?: CommunityViewerState
}

export interface SubscriptionApi {
  subscribe(input: { community: DID }): Promise<void>
  unsubscribe(input: { community: DID }): Promise<void>
}

interface Override {
  /** The optimistic value. */
  subscribed: boolean
  /** What the server said at press time; a different server value supersedes. */
  serverAtPress: boolean
}

const overrides = new SvelteMap<DID, Override>()
const pending = new SvelteSet<DID>()

function serverValue(community: SubscribableCommunity): boolean {
  return community.viewer?.subscribed === true
}

/** Whether the viewer is subscribed, with any in-session optimistic change applied. */
export function isSubscribed(community: SubscribableCommunity): boolean {
  const server = serverValue(community)
  const override = overrides.get(community.did)
  if (override === undefined || override.serverAtPress !== server) return server
  return override.subscribed
}

/** Whether a subscribe/unsubscribe request is in flight for this community. */
export function isSubscriptionPending(
  community: SubscribableCommunity,
): boolean {
  return pending.has(community.did)
}

export type ToggleSubscriptionOutcome =
  | { kind: 'ok'; subscribed: boolean }
  | { kind: 'pending' }
  | { kind: 'error'; error: unknown }

/**
 * Flips the subscription optimistically, sends it, and rolls back on failure.
 * A second press while one is in flight is ignored (`pending`).
 */
export async function toggleSubscription(
  community: SubscribableCommunity,
  api: SubscriptionApi,
): Promise<ToggleSubscriptionOutcome> {
  const { did } = community
  if (pending.has(did)) return { kind: 'pending' }

  const was = isSubscribed(community)
  const next = !was
  const previous = overrides.get(did)
  pending.add(did)
  overrides.set(did, {
    subscribed: next,
    serverAtPress: serverValue(community),
  })

  try {
    if (was) {
      await api.unsubscribe({ community: did })
    } else {
      await api.subscribe({ community: did })
    }
    return { kind: 'ok', subscribed: next }
  } catch (error) {
    log.error('[subscription] toggle failed', error, { did, was })
    if (previous === undefined) {
      overrides.delete(did)
    } else {
      overrides.set(did, previous)
    }
    return { kind: 'error', error }
  } finally {
    pending.delete(did)
  }
}

/** Test seam: forget every override and in-flight marker. */
export function resetSubscriptionState(): void {
  overrides.clear()
  pending.clear()
}
