<script lang="ts">
  import Search from './Search.svelte'

  interface Props {
    search: (query: string) => Promise<string[]>
  }

  let { search }: Props = $props()
</script>

<Search {search} extractName={(item: string) => item} placeholder="Community" />
<p>Somewhere else on the page</p>
