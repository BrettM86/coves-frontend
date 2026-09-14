<script lang="ts">
  import type { FeedPaginationParams, FeedViewPost } from '$lib/api/coves/types'
  import { untrack } from 'svelte'
  import VirtualFeed from './VirtualFeed.svelte'

  type VirtualFeedParams = FeedPaginationParams & { listing?: string }

  let {
    initialPosts,
    initialParams,
    loadFeed,
  }: {
    initialPosts: FeedViewPost[]
    initialParams: VirtualFeedParams
    loadFeed: (
      params: VirtualFeedParams,
    ) => Promise<{ feed: FeedViewPost[]; cursor?: string }>
  } = $props()

  let posts = $state(untrack(() => initialPosts))
  let params = $state(untrack(() => initialParams))

  export function currentPosts(): FeedViewPost[] {
    return posts
  }

  export function replacePosts(nextPosts: FeedViewPost[]): void {
    posts = nextPosts
  }

  export function currentParams(): VirtualFeedParams {
    return params
  }

  export function replaceParams(nextParams: VirtualFeedParams): void {
    params = nextParams
  }
</script>

<VirtualFeed bind:posts bind:params {loadFeed} />
