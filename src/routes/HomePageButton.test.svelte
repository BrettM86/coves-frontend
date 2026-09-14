<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    children,
    disabled = false,
    onclick,
  }: {
    children?: Snippet
    disabled?: boolean
    onclick?: (event: MouseEvent) => void
  } = $props()
</script>

<button {disabled} {onclick}>{@render children?.()}</button>
