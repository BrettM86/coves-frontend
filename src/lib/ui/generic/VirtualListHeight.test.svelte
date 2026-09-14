<script lang="ts">
  import VirtualList from './VirtualList.svelte'

  interface Props {
    items: number[]
    estimatedHeight?: number
    restore?: { itemHeights: (number | null)[] }
  }

  let { items, estimatedHeight = 100, restore }: Props = $props()
</script>

<VirtualList {items} {estimatedHeight} {restore} debounceResize={0}>
  {#snippet item(index)}
    <div>Row {index}</div>
  {/snippet}
</VirtualList>
