import { browser } from '$app/environment'
import { untrack } from 'svelte'
import { coves } from '$lib/api/client.svelte'
import { XrpcError } from '$lib/api/coves'
import { NSID } from '$lib/api/coves/client'
import type { NotificationPreferences } from '$lib/api/coves/types'
import { profile } from '$lib/app/state/auth.svelte'
import { t } from '$lib/app/state/i18n'
import { toast } from '$lib/ui/kit'
import { logNotificationFailure } from './log'
import {
  createRequestEpoch,
  notificationSessionKey,
  type RequestSnapshot,
} from './session'
import { unreadNotifications } from './unread.svelte'

export type NotificationPreferencesStatus =
  'signed-out' | 'loading' | 'ready' | 'error'

export interface NotificationPreferencesStore {
  readonly status: NotificationPreferencesStatus
  /** The stored values with every pending change on top, in call order. */
  readonly values: Readonly<NotificationPreferences> | undefined
  /**
   * Starts following the session (browser only). Only the call that started
   * the store gets the real stop; a later call is a no-op that returns a no-op,
   * so a page cannot tear down the app-lifetime store.
   */
  start(): () => void
  /** Loads again after a failed load while started; otherwise does nothing. */
  retry(): void
  /**
   * Queues a save of one switch while ready; `values` shows it at once. Saves
   * go out one at a time in call order; a failed one is dropped with a toast.
   */
  set(key: keyof NotificationPreferences, value: boolean): void
}

interface PendingChange {
  key: keyof NotificationPreferences
  value: boolean
}

/**
 * The account's notification preferences for the current session key. Every
 * key change (account switch, new generation, expiry, same-generation
 * revival) advances the request epoch and empties the values and the save
 * queue before anything is sent, so a response from an earlier key or epoch
 * is never applied and nothing queued under one owner is sent under another.
 */
export function createNotificationPreferences(): NotificationPreferencesStore {
  // Before start (and in a server render) nothing is known yet.
  let status = $state<NotificationPreferencesStatus>('loading')
  let stored = $state.raw<NotificationPreferences | undefined>()
  // In call order; while a put is in flight it is for the first entry.
  let pending = $state.raw<readonly PendingChange[]>([])
  const values = $derived.by(() => {
    if (!stored) return undefined
    const displayed = { ...stored }
    for (const change of pending) displayed[change.key] = change.value
    return displayed
  })
  const epoch = createRequestEpoch()
  // The epoch the stored values were loaded under; puts are sent only in it.
  let loadedUnder: RequestSnapshot | undefined
  // The one put in flight, if any; dropped (not settled) by `reset()`.
  let putInFlight: RequestSnapshot | undefined
  let destroyRoot: (() => void) | undefined

  /** Drops everything owned by the previous key or epoch. */
  function reset(): void {
    epoch.advance()
    stored = undefined
    pending = []
    loadedUnder = undefined
    putInFlight = undefined
  }

  /** Sends the first pending change unless a put is already in flight. */
  function sendNext(): void {
    const change = pending[0]
    if (putInFlight || !change) return
    const snapshot = epoch.snapshot()
    putInFlight = snapshot
    coves()
      .putNotificationPreferences({ [change.key]: change.value })
      .then(
        (saved) => {
          // A completion from an earlier key or epoch changes nothing.
          if (!epoch.isCurrent(snapshot)) return
          putInFlight = undefined
          stored = saved
          pending = pending.slice(1)
          // A saved preference can change which notifications count as unread.
          unreadNotifications.refresh()
          sendNext()
        },
        (error: unknown) => {
          // A 401 expires the session in `covesCustomFetch` before this
          // handler runs, so the key has changed and this guard drops it: no
          // toast, nothing more sent.
          if (!epoch.isCurrent(snapshot)) return
          putInFlight = undefined
          pending = pending.slice(1)
          logNotificationFailure(NSID.putNotificationPreferences, error)
          toast({ content: saveFailureMessage(error), type: 'error' })
          sendNext()
        },
      )
  }

  function load(): void {
    const snapshot = epoch.snapshot()
    status = 'loading'
    coves()
      .getNotificationPreferences()
      .then(
        (loaded) => {
          // A completion from an earlier key or epoch changes nothing.
          if (!epoch.isCurrent(snapshot)) return
          stored = loaded
          loadedUnder = snapshot
          status = 'ready'
        },
        (error: unknown) => {
          if (!epoch.isCurrent(snapshot)) return
          logNotificationFailure(NSID.getNotificationPreferences, error)
          status = 'error'
        },
      )
  }

  function adoptSession(): void {
    reset()
    if (profile.isAuthenticated) load()
    else status = 'signed-out'
  }

  /** Stops following the session and returns to the pre-start state. */
  function stop(): void {
    destroyRoot?.()
    destroyRoot = undefined
    reset()
    status = 'loading'
  }

  return {
    get status() {
      return status
    },
    get values() {
      return values
    },
    start() {
      if (!browser || destroyRoot) return () => {}
      destroyRoot = $effect.root(() => {
        const key = $derived(notificationSessionKey())
        $effect(() => {
          void key
          untrack(adoptSession)
        })
      })
      return stop
    },
    retry() {
      if (destroyRoot && status === 'error' && profile.isAuthenticated) load()
    },
    set(key, value) {
      // Ready values from an owner the session has already left take nothing.
      if (status !== 'ready' || !loadedUnder || !epoch.isCurrent(loadedUnder))
        return
      pending = [...pending, { key, value }]
      sendNext()
    },
  }
}

function saveFailureMessage(error: unknown): string {
  if (error instanceof XrpcError && error.errorName === 'AccountNotIndexed')
    return t.get('settings.notifications.accountNotIndexed')
  return t.get('settings.notifications.saveFailed')
}

/** The app-lifetime store; started once in the browser. */
export const notificationPreferences = createNotificationPreferences()
