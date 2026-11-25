<script lang="ts">
  import type { LikedItem } from '$lib/api/coves/types'
  import { settings } from '$lib/app/state/settings.svelte'
  import { Post } from '$lib/feature/post'
  import { handlePostFeedClick } from '$lib/feature/post/feed/navigation'
  import { restorePostFeedScrollWhen } from '$lib/feature/post/feed/restoration.svelte'
  import LikedCommentRow from './LikedCommentRow.svelte'

  interface Props {
    items: LikedItem[]
  }

  let { items = $bindable() }: Props = $props()

  let listEl = $state<HTMLUListElement>()
  restorePostFeedScrollWhen(() =>
    items.length > 0 && listEl ? listEl : undefined,
  )

  function itemKey(item: LikedItem): string {
    return item.$type === 'social.coves.actor.getLikes#likedComment'
      ? item.comment.uri
      : item.post.uri
  }
</script>

<!-- One list in server order. Post rows match PostFeed's, so the feed's
     click-to-post navigation and scroll restoration work across both kinds;
     comment rows are thread comments. -->
<!-- svelte-ignore a11y_click_events_have_key_events (delegates native anchor clicks) -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions (delegates native anchor clicks) -->
<ul
  bind:this={listEl}
  class="flex flex-col list-none"
  onclick={handlePostFeedClick}
>
  {#each items as item, index (itemKey(item))}
    {#if item.$type === 'social.coves.actor.getLikes#likedPost'}
      <li
        class={[
          'relative post-container',
          index > 0 &&
            (settings.view == 'cozy'
              ? 'border-t-[0.5px] border-card-border'
              : 'border-t border-slate-200 dark:border-zinc-800'),
        ]}
        data-post-uri={item.post.uri}
      >
        <Post
          priority={index === 0}
          view={settings.view}
          bind:post={item.post}
          class={[
            'transition-all duration-250',
            settings.view == 'cozy' && 'md:[zoom:0.9]',
          ]}
        />
      </li>
    {:else}
      <LikedCommentRow
        bind:item={() => item, (value) => (items[index] = value)}
        class={[index > 0 && 'border-t border-slate-200 dark:border-zinc-800']}
      />
    {/if}
  {/each}
</ul>
