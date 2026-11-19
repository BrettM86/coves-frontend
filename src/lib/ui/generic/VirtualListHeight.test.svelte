<script lang="ts">
  import VirtualList from './VirtualList.svelte'

  interface Props {
    items: number[]
    estimatedHeight?: number
    restore?: { itemHeights: (number | null)[] }
    list?: boolean
  }

  let { items, estimatedHeight = 100, restore, list = false }: Props = $props()
</script>

<VirtualList
  {items}
  {estimatedHeight}
  {restore}
  debounceResize={0}
  role={list ? 'list' : undefined}
  itemRole={list ? 'listitem' : undefined}
>
  {#snippet item(index)}
    <div>Row {index}</div>
  {/snippet}
</VirtualList>
