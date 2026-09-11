<script lang="ts">
  import { initializeSessionRecovery } from '$lib/app/state/session-recovery.svelte'
  let { page } = $props<{
    page: { route: { id: string | null }; status: number }
  }>()
  initializeSessionRecovery()
</script>

<main data-route={page.route.id}>Destination rendered: {page.status}</main>
