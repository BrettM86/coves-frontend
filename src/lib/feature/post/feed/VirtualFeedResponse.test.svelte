<script lang="ts">
  import type { FeedPaginationParams, FeedViewPost } from '$lib/api/coves/types'
  import VirtualFeed from './VirtualFeed.svelte'

  interface Response {
    feed: FeedViewPost[]
    params: FeedPaginationParams
    virtualList: { itemHeights: (number | null)[] }
  }

  interface Props {
    response: Response
  }

  let { response = $bindable() }: Props = $props()
</script>

<VirtualFeed
  bind:posts={response.feed}
  bind:params={response.params}
  virtualList={response.virtualList}
/>
