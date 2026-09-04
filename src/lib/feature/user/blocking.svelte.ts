import type { ProfileViewerState } from '$lib/api/coves/types'
import { profile } from '$lib/app/state/auth.svelte'
import { log } from '$lib/app/util/log'
import { feeds } from '$lib/feature/feeds/feed.svelte'
import type { DID } from '$lib/types/atproto'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'

export interface BlockableUser {
  readonly did: DID
  readonly viewer?: ProfileViewerState
}

export interface UserBlockingApi {
  blockUser(input: { subject: DID }): Promise<void>
  unblockUser(input: { subject: DID }): Promise<void>
}

interface Override {
  readonly blocked: boolean
  readonly serverAtPress: boolean
}

const overrides = new SvelteMap<string, Override>()
const pending = new SvelteSet<string>()

function stateKey(did: DID): string {
  return `${profile.meta.profile}\u0000${did}`
}

function serverValue(user: BlockableUser): boolean {
  return user.viewer?.blocking !== undefined
}

/** Whether the active profile blocks this user, including optimistic state. */
export function isUserBlocked(user: BlockableUser): boolean {
  const server = serverValue(user)
  const override = overrides.get(stateKey(user.did))
  if (override === undefined || override.serverAtPress !== server) return server
  return override.blocked
}

/** Whether a user block request is in flight for the active profile. */
export function isUserBlockPending(user: BlockableUser): boolean {
  return pending.has(stateKey(user.did))
}

/** Retires an optimistic value once a later server response has caught up. */
export function reconcileUserBlockState(user: BlockableUser): void {
  const key = stateKey(user.did)
  const override = overrides.get(key)
  if (
    override !== undefined &&
    !pending.has(key) &&
    override.serverAtPress !== serverValue(user)
  ) {
    overrides.delete(key)
  }
}

export type UserBlockOutcome =
  | { kind: 'ok'; blocked: boolean }
  | { kind: 'pending' }
  | { kind: 'error'; error: unknown }

/** Persists an explicit user block state with optimistic rollback. */
export async function setUserBlocked(
  user: BlockableUser,
  nextBlocked: boolean,
  api: UserBlockingApi,
): Promise<UserBlockOutcome> {
  const { did } = user
  const key = stateKey(did)
  if (pending.has(key)) return { kind: 'pending' }

  const wasBlocked = isUserBlocked(user)
  if (wasBlocked === nextBlocked) {
    return { kind: 'ok', blocked: nextBlocked }
  }

  const previous = overrides.get(key)
  pending.add(key)
  overrides.set(key, {
    blocked: nextBlocked,
    serverAtPress: serverValue(user),
  })

  try {
    if (nextBlocked) {
      await api.blockUser({ subject: did })
    } else {
      await api.unblockUser({ subject: did })
    }
    feeds.clear()
    return { kind: 'ok', blocked: nextBlocked }
  } catch (error) {
    log.error('[user-blocking] update failed', error, {
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

/** Optimistically flips the user block and persists it. */
export function toggleUserBlock(
  user: BlockableUser,
  api: UserBlockingApi,
): Promise<UserBlockOutcome> {
  return setUserBlocked(user, !isUserBlocked(user), api)
}

/** Test seam: forget optimistic values after every request has settled. */
export function resetUserBlockingState(): void {
  if (pending.size > 0) {
    throw new Error('Cannot reset user blocking state while requests run')
  }
  overrides.clear()
}
