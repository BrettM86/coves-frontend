<script lang="ts">
  let { page } = $props<{
    page: { route: { id: string | null }; status: number }
  }>()
</script>

<main data-route={page.route.id}>Destination rendered: {page.status}</main>
