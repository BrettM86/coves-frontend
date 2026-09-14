<script lang="ts">
  import type { Snippet } from 'svelte'

  let { navigation }: { navigation?: Snippet } = $props()
</script>

{@render navigation?.()}
