import { browser } from '$app/environment'
import { afterNavigate, invalidateAll } from '$app/navigation'
import { navigating, page } from '$app/state'
import { onDestroy, untrack } from 'svelte'
import { profile } from './auth.svelte'
import { log } from '$lib/app/util/log'

let recovery = $state<'idle' | 'queued' | 'refreshing'>('idle')

/** Coalesce rejected credentials, including failures from refreshed loads. */
export function requestSessionRecovery(): void {
  if (browser && recovery === 'idle') recovery = 'queued'
}

/** Install once during root component initialization. */
export function initializeSessionRecovery(): void {
  let ready = $state(false)

  afterNavigate(() => {
    ready = true
  })

  // Reconcile server-validated data before deciding whether recovery is needed.
  // syncFromServer writes profile state; those writes must not become inputs
  // to this effect and cause repeated synchronization.
  $effect(() => {
    const session = page.data.session ?? undefined
    untrack(() => profile.syncFromServer(session))
  })

  $effect(() => {
    if (!ready || navigating.to || recovery !== 'queued') return
    if (!profile.isAuthenticated) {
      recovery = 'idle'
      return
    }

    // invalidateAll can cancel the navigation currently loading a 401 response.
    // Wait for initial entry and the current destination to finish first.
    recovery = 'refreshing'
    void refresh()
  })

  onDestroy(() => {
    ready = false
    if (recovery === 'queued') recovery = 'idle'
  })
}

async function refresh(): Promise<void> {
  try {
    await invalidateAll()
  } catch {
    log.warn('[client] Session refresh failed after unauthorized response')
  } finally {
    recovery = 'idle'
  }
}
