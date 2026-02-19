<script lang="ts">
  // @ts-nocheck TODO(coves-migration): remove when file is migrated to Coves XRPC
  import { ReactiveState } from '$lib/app/util.svelte'
  import UserPage from '../../u/[handle]/+page.svelte'

  let { data } = $props()
</script>

{#if data.user && data.sort && data.type && data.page}
  <UserPage
    data={{
      items: new ReactiveState(data.user.submissions),
      filters: new ReactiveState({
        page: data.page,
        sort: data.sort,
        type: data.type,
        limit: data.limit,
      }),
      person_view: { value: data.user.person_view },
      moderates: { value: data.user.moderates },
    }}
  />
{:else}
  User data is missing.
  <pre>
    {JSON.stringify(data)}
  </pre>
{/if}
