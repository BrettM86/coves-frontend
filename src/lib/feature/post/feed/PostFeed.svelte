<script lang="ts">
  import type { FeedViewPost } from '$lib/api/coves/types'
  import { settings } from '$lib/app/settings.svelte'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import { Button } from 'mono-svelte'
  import type { Snippet } from 'svelte'
  import { ArchiveBox, Plus } from 'svelte-hero-icons/dist'
  import { Post } from '..'

  interface Props {
    posts: FeedViewPost[]
    community?: boolean
    children?: Snippet
  }

  let { posts = $bindable(), community = false, children }: Props = $props()
</script>

<ul
  class="flex flex-col list-none divide-y divide-slate-200 dark:divide-zinc-800"
>
  {#if posts?.length == 0}
    <div class="h-full grid place-items-center">
      <Placeholder
        icon={ArchiveBox}
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
      <li class="relative post-container">
        <Post
          hideCommunity={community}
          pinned={feedPost.reason?.$type === 'social.coves.feed.defs#reasonPin'}
          view={feedPost.reason?.$type === 'social.coves.feed.defs#reasonPin' &&
          settings.posts.compactFeatured
            ? 'compact'
            : settings.view}
          post={feedPost.post}
          class="transition-all duration-250"
        />
      </li>
    {/each}
  {/if}
  {@render children?.()}
</ul>
