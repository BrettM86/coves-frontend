<script lang="ts">
  import { untrack } from 'svelte'
  import { profile, type ServerSession } from '$lib/app/state/auth.svelte'
  import SessionRecovery from '$lib/feature/shell/SessionRecovery.svelte'

  let {
    page,
  }: {
    page: {
      data: {
        session?: ServerSession | null
        sessionGeneration?: string
        sessionExpired?: boolean
      }
      route: { id: string | null }
      status: number
    }
  } = $props()

  // Mirrors the root layout: the single syncFromServer call site.
  $effect(() => {
    const { session, sessionGeneration, sessionExpired } = page.data
    untrack(() =>
      profile.syncFromServer(session ?? undefined, {
        sessionGeneration,
        sessionExpired,
      }),
    )
  })
</script>

<main data-route={page.route.id}>Destination rendered: {page.status}</main>
<SessionRecovery />
