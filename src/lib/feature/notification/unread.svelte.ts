import { browser } from '$app/environment'
import { untrack } from 'svelte'
import { coves } from '$lib/api/client.svelte'
import { NSID } from '$lib/api/coves/client'
import { profile } from '$lib/app/state/auth.svelte'
import { log } from '$lib/app/util/log'
import { logNotificationFailure } from './log'
import { createRequestEpoch, notificationSessionKey } from './session'

export interface AcceptedUnreadRefresh {
  readonly key: string
  readonly sequence: number
  readonly count: number
}

export interface UnreadNotificationStore {
  /** Last accepted count; 0 before start, signed out, and at once on any key change. */
  readonly count: number
  /** Browser only, idempotent; only the first call returns the real stop (as the preferences store). */
  start(): () => void
  /** One GET unless one is in flight (absorbed, not queued) or not authenticated. */
  refresh(): void
  /** Called after each client navigation; refreshes only on `/notifications`. */
  noteNavigation(pathname: string): void
  /** Called once per accepted response; a throw is logged, not rethrown. Returns an unsubscribe. */
  onAcceptedRefresh(
    listener: (refresh: AcceptedUnreadRefresh) => void,
  ): () => void
}

/**
 * Signed in for this store: authenticated with a server-stamped generation. A
 * hard load restores the profile from storage before the server session
 * arrives; until then `sessionGeneration` is undefined and nothing is sent.
 */
function signedIn(): boolean {
  return profile.isAuthenticated && profile.sessionGeneration !== undefined
}

/** How often the count is refetched while signed in and visible. */
const refreshIntervalMilliseconds = 30_000

/**
 * The unread notification count for the current session key. Every key
 * change advances the request epoch, zeroes the count and drops the in-flight
 * request before the new key's GET is sent, so a response from an earlier key
 * or epoch is never applied and never blocks the new key's request.
 */
export function createUnreadNotifications(): UnreadNotificationStore {
  let count = $state(0)
  const epoch = createRequestEpoch()
  // Plain (not reactive) state: nothing renders from the listener list.
  let listeners: readonly ((refresh: AcceptedUnreadRefresh) => void)[] = []
  // Every request sent by this store, failed and stale ones included.
  let sequence = 0
  // The sequence of the one request in flight under the current epoch.
  let inFlight: number | undefined
  // The key the adoption effect last ran for; undefined while stopped.
  let adoptedKey: string | undefined
  let destroyRoot: (() => void) | undefined
  let refreshTimer: ReturnType<typeof setInterval> | undefined

  function reset(): void {
    epoch.advance()
    count = 0
    inFlight = undefined
  }

  function send(): void {
    if (!signedIn() || inFlight !== undefined) return
    sequence++
    const requestSequence = sequence
    const snapshot = epoch.snapshot()
    inFlight = requestSequence
    coves()
      .getUnreadNotificationCount()
      .then((body) => {
        if (!Number.isInteger(body.count) || body.count < 0)
          throw new Error('Unread notification count is not a whole number')
        return body.count
      })
      .then(
        (accepted) => {
          if (inFlight === requestSequence) inFlight = undefined
          // A completion from an earlier key or epoch changes nothing.
          if (!epoch.isCurrent(snapshot)) return
          count = accepted
          const refresh = {
            key: snapshot.key,
            sequence: requestSequence,
            count: accepted,
          }
          for (const listener of listeners) {
            // One throwing listener must not keep the signal from the rest.
            // Only the error's name is logged: its message may carry the key.
            try {
              listener(refresh)
            } catch (error: unknown) {
              log.error('Unread notification listener failed', undefined, {
                errorName: error instanceof Error ? error.name : typeof error,
              })
            }
          }
        },
        (error: unknown) => {
          if (inFlight === requestSequence) inFlight = undefined
          if (!epoch.isCurrent(snapshot)) return
          logNotificationFailure(NSID.getUnreadNotificationCount, error)
        },
      )
  }

  function clearRefreshTimer(): void {
    clearInterval(refreshTimer)
    refreshTimer = undefined
  }

  /**
   * Starts the 30 s timer afresh, so its next tick is a full interval from
   * now; it runs only while signed in and the document is visible.
   */
  function restartRefreshTimer(): void {
    clearRefreshTimer()
    if (!signedIn() || document.visibilityState !== 'visible') return
    refreshTimer = setInterval(refresh, refreshIntervalMilliseconds)
  }

  function refresh(): void {
    // Before the adoption effect has run for a new key it will send itself;
    // sending now would go out under the old epoch and be sent twice.
    if (adoptedKey !== notificationSessionKey()) return
    send()
  }

  function adoptSession(key: string): void {
    reset()
    adoptedKey = key
    send()
    restartRefreshTimer()
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState !== 'visible') {
      clearRefreshTimer()
      return
    }
    refresh()
    restartRefreshTimer()
  }

  /** Stops following the session and returns to the pre-start state. */
  function stop(): void {
    destroyRoot?.()
    destroyRoot = undefined
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('focus', refresh)
    clearRefreshTimer()
    adoptedKey = undefined
    reset()
  }

  return {
    get count() {
      return count
    },
    start() {
      if (!browser || destroyRoot) return () => {}
      destroyRoot = $effect.root(() => {
        const key = $derived(notificationSessionKey())
        $effect(() => {
          const adopted = key
          untrack(() => adoptSession(adopted))
        })
      })
      document.addEventListener('visibilitychange', handleVisibilityChange)
      window.addEventListener('focus', refresh)
      return stop
    },
    refresh,
    noteNavigation(pathname) {
      if (pathname === '/notifications') refresh()
    },
    onAcceptedRefresh(listener) {
      listeners = [...listeners, listener]
      return () => {
        listeners = listeners.filter((entry) => entry !== listener)
      }
    },
  }
}

/** The app-lifetime store; started once in the browser. */
export const unreadNotifications = createUnreadNotifications()
