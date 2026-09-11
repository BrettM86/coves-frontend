<script lang="ts">
  import { afterNavigate, invalidate } from '$app/navigation'
  import { navigating } from '$app/state'
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { log } from '$lib/app/util/log'

  // invalidate() supersedes whichever navigation is in flight, and that can be
  // the one whose load just received the 401. Hold revalidation until initial
  // entry has rendered and the router is idle.
  let ready = $state(false)
  afterNavigate(() => {
    ready = true
  })

  // One revalidation per expiration; focus retries while it stays expired.
  let revalidated = false

  async function revalidate() {
    // The data this brings back is the server's verdict on a suspected
    // expiration; only a verdict may revive the generation the 401 named.
    profile.beginSessionRevalidation()
    try {
      await invalidate('app:session')
    } catch (error) {
      // Keep the recovery prompt visible; returning to this tab retries.
      log.warn('[auth] Session revalidation failed', error)
    }
  }

  /**
   * Asks the server to delete the dead cookie, but only while it is still the
   * one this tab knows about: 204 when deleted, 409 when a newer login has
   * already replaced it (adopt that login instead), 400 on a bad request.
   */
  async function expireCookie(
    generation: string,
    signal: AbortSignal,
  ): Promise<'deleted' | 'replaced' | 'failed'> {
    try {
      const response = await fetch('/api/auth/expire', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generation }),
        signal,
      })
      if (response.status === 204) return 'deleted'
      if (response.status === 409) return 'replaced'
      log.warn('[auth] Expiring the dead session cookie failed', undefined, {
        status: response.status,
      })
    } catch (error) {
      if (signal.aborted) return 'failed'
      log.warn('[auth] Expiring the dead session cookie failed', error)
    }
    return 'failed'
  }

  // The deletion request in flight, if any. The server compares the cookie
  // the request carried, not the one the browser holds when the deleting
  // Set-Cookie lands, so a login this tab adopts meanwhile aborts the request
  // and, if the response still arrived, has its session checked again.
  let pendingExpiration:
    { generation: string; controller: AbortController } | undefined
  $effect(() => {
    const generation = profile.sessionGeneration
    if (pendingExpiration && pendingExpiration.generation !== generation)
      pendingExpiration.controller.abort()
  })

  async function requestExpiration(generation: string | undefined) {
    if (!generation) return
    const controller = new AbortController()
    pendingExpiration = { generation, controller }
    const outcome = await expireCookie(generation, controller.signal)
    if (pendingExpiration?.controller === controller)
      pendingExpiration = undefined
    if (outcome === 'replaced' || profile.sessionGeneration !== generation)
      void revalidate()
  }

  async function dismiss() {
    const generation = profile.sessionGeneration
    profile.dismissSessionExpiration()
    if (generation) autoExpired = generation
    await requestExpiration(generation)
  }

  // The prompt alone is dismissable; the expired state it reports is not.
  const prompting = $derived(
    profile.sessionExpired && !profile.sessionExpirationDismissed,
  )

  // Only a visible tab sends the automatic deletion: a hidden tab has nobody
  // reading the prompt, and is where another tab's fresh login is most likely
  // to be the cookie the deletion removes.
  let visible = $state(true)
  $effect(() => {
    const update = () => {
      visible = document.visibilityState === 'visible'
    }
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  })

  // Focus retries follow the expired state, not the prompt: a dismissed
  // banner still belongs to a tab that should adopt a login made elsewhere.
  $effect(() => {
    if (!profile.sessionExpired) {
      revalidated = false
      return
    }
    if (!ready || navigating.to) return

    if (!revalidated) {
      revalidated = true
      // Expiration reported by the server's own session check needs no second
      // check; only a client-side 401 is a suspicion the server must confirm.
      if (!profile.sessionExpirationConfirmed) void revalidate()
    }
    window.addEventListener('focus', revalidate)
    return () => window.removeEventListener('focus', revalidate)
  })

  // A dead cookie left in the browser costs a /api/me round trip per request
  // until the reader logs in again. Once the server has confirmed the current
  // generation is dead, ask it to delete that cookie, once per generation.
  let autoExpired: string | undefined
  $effect(() => {
    const generation = profile.sessionGeneration
    if (
      !visible ||
      !profile.sessionExpired ||
      !profile.sessionExpirationConfirmed ||
      !generation ||
      autoExpired === generation
    )
      return
    autoExpired = generation
    void requestExpiration(generation)
  })
</script>

{#if prompting}
  <div
    role="alert"
    class="sticky top-3 md:top-16 z-40 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
  >
    <p>{$t('toast.sessionExpired')}</p>
    <div class="flex shrink-0 items-center gap-4">
      <a
        href="/login"
        target="_blank"
        rel="noopener noreferrer"
        class="rounded-sm font-semibold underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        {$t('account.login')}
      </a>
      <button
        type="button"
        onclick={dismiss}
        class="rounded-sm text-slate-600 underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-4 dark:text-zinc-400"
      >
        {$t('toast.sessionExpiredDismiss')}
      </button>
    </div>
  </div>
{/if}
