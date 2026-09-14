<script lang="ts">
  import type { FeedViewPost } from '$lib/api/coves/types'
  import { settings } from '$lib/app/state/settings.svelte'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import { Button } from '$lib/ui/kit'
  import type { Snippet } from 'svelte'
  import { Archive, Plus } from '$lib/ui/kit/icon'
  import { Post } from '..'
  import { handlePostFeedClick } from './navigation'
  import { restorePostFeedScrollWhen } from './restoration.svelte'

  interface Props {
    posts: FeedViewPost[]
    community?: boolean
    children?: Snippet
  }

  let { posts = $bindable(), community = false, children }: Props = $props()

  let listEl = $state<HTMLUListElement>()
  restorePostFeedScrollWhen(() =>
    posts.length > 0 && listEl?.querySelector('.post-container')
      ? listEl
      : undefined,
  )
</script>

<!-- svelte-ignore a11y_click_events_have_key_events (delegates native anchor clicks) -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions (delegates native anchor clicks) -->
<ul
  bind:this={listEl}
  class="flex flex-col list-none divide-y divide-slate-200 dark:divide-zinc-800"
  onclick={handlePostFeedClick}
>
  {#if posts?.length == 0}
    <div class="h-full grid place-items-center">
      <Placeholder
        icon={Archive}
        title="No posts"
        description="There are no posts that match this filter."
      >
        <Button href="/communities" icon={Plus}>
          <span>Follow some communities</span>
        </Button>
      </Placeholder>
    </div>
  {:else}
    {#each posts as feedPost (feedPost.post.uri)}
      <li class="relative post-container" data-post-uri={feedPost.post.uri}>
        <Post
          hideCommunity={community}
          pinned={feedPost.reason?.$type === 'social.coves.feed.defs#reasonPin'}
          view={feedPost.reason?.$type === 'social.coves.feed.defs#reasonPin' &&
          settings.posts.compactFeatured
            ? 'compact'
            : settings.view}
          bind:post={feedPost.post}
          class="transition-all duration-250"
        />
      </li>
    {/each}
  {/if}
  {@render children?.()}
</ul>
