<script lang="ts">
  // @ts-nocheck
  interface Props {
    ordered: boolean
    start: number
    children?: import('svelte').Snippet
  }

  let { ordered, start, children }: Props = $props()
</script>

{#if ordered}
  <ol {start} class="pl-5 list-decimal">
    {@render children?.()}
  </ol>
{:else}
  <ul class="list-disc pl-8 *:marker:content-['• ']!">
    {@render children?.()}
  </ul>
{/if}
