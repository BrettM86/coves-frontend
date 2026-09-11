<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children }: { children?: Snippet<[boolean]> } = $props()
</script>

{@render children?.(true)}
