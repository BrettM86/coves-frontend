import { profile } from '$lib/app/state/auth.svelte'

/**
 * The notification owner key. `expireSession()` swaps `profile.current` for a
 * guest, so expiry changes the key too, and a same-generation revival returns
 * it to its earlier value.
 */
export function notificationSessionKey(): string {
  return `${profile.current.did}|${profile.sessionGeneration}`
}

/** What a request captured when it was sent. */
export interface RequestSnapshot {
  readonly key: string
  readonly epoch: number
}

export interface RequestEpoch {
  /** Moves the epoch on; every earlier snapshot stops being current. */
  advance(): void
  snapshot(): RequestSnapshot
  /**
   * Whether a response sent under `snapshot` may still be applied: the key
   * and the epoch are both unchanged. The key alone is not enough, because an
   * expiry followed by a same-generation revival brings the key back.
   */
  isCurrent(snapshot: RequestSnapshot): boolean
}

/**
 * A request epoch for one store. The store calls `advance()` on every change
 * of `notificationSessionKey()` (and on any other reset of its own), takes a
 * `snapshot()` when it sends, and applies the response only if
 * `isCurrent(snapshot)`.
 */
export function createRequestEpoch(): RequestEpoch {
  let epoch = 0
  return {
    advance() {
      epoch++
    },
    snapshot() {
      return { key: notificationSessionKey(), epoch }
    },
    isCurrent(snapshot) {
      return (
        snapshot.epoch === epoch && snapshot.key === notificationSessionKey()
      )
    },
  }
}
