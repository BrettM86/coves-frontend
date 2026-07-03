<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import { settings } from '$lib/app/settings.svelte'
  import { mapSort } from '$lib/app/sort'
  import CommentProvider from '$lib/feature/comment/CommentProvider.svelte'
  import { Post } from '$lib/feature/post'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import { Material, Spinner } from 'mono-svelte'
  import { ChatBubbleOvalLeft, Icon, NoSymbol } from 'svelte-hero-icons/dist'
  import type { PageData } from './$types'

  interface Props {
    data: PageData
  }

  let { data }: Props = $props()

  function reloadComments() {
    const value = data.data.value
    if (!value?.post) return
    const { sort } = mapSort(settings?.defaultSort?.comments ?? 'hot')
    value.comments = coves()
      .getComments({ ...value.params.comments, sort })
      .then((r) => r.comments)
    value.params.thread.singleThread = false
  }
</script>

<svelte:head>
  {#if data.data.value?.post}
    <title>
      {data.data.value.post.record?.title ?? 'Post'}
    </title>
    <meta
      name="description"
      content={data.data.value.post.record?.content?.slice(0, 200) ?? ''}
    />
    <meta
      property="og:title"
      content={data.data.value.post.record?.title ?? 'Post'}
    />
    <meta
      property="og:description"
      content={data.data.value.post.record?.content?.slice(0, 200) ?? ''}
    />
  {:else if data.data.value?.unavailable}
    <title>Post unavailable</title>
  {/if}
</svelte:head>

<div class="flex flex-col gap-4 w-full max-w-full">
  {#if data.data.value?.post}
    {@const post = data.data.value.post}

    <Material padding="none" rounding="2xl" class="overflow-hidden">
      <Post {post} actions={true} view="cozy" />
    </Material>

    <!-- Comments Section -->
    <section id="comments" class="flex flex-col gap-2">
      <h2
        class="flex items-center gap-2 text-lg font-medium text-slate-700 dark:text-zinc-300 px-1"
      >
        <Icon src={ChatBubbleOvalLeft} size="20" mini />
        Comments
        {#if post.stats?.commentCount}
          <span class="text-sm text-slate-500 dark:text-zinc-400">
            ({post.stats.commentCount})
          </span>
        {/if}
      </h2>

      {#await data.data.value.comments}
        <div
          class="flex justify-center py-8"
          role="status"
          aria-label="Loading comments"
        >
          <Spinner width={24} />
        </div>
      {:then comments}
        <CommentProvider
          {post}
          {comments}
          focus={data.data.value.params.thread.focus}
          onupdate={reloadComments}
          showContext={data.data.value.params.thread.showContext}
          singleThread={data.data.value.params.thread.singleThread}
        />
        {#if comments.length === 0}
          <p class="text-sm text-slate-500 dark:text-zinc-400 py-4 text-center">
            No comments yet. Be the first to comment!
          </p>
        {/if}
      {:catch}
        <p class="text-sm text-red-500 py-4 text-center">
          Failed to load comments.
        </p>
      {/await}
    </section>
  {:else if data.data.value?.unavailable}
    <Material padding="lg" rounding="2xl" class="py-12">
      <Placeholder
        icon={NoSymbol}
        title="Post unavailable"
        description={data.data.value.unavailable === 'blocked'
          ? "You've blocked this post's author."
          : "This post may have been removed, or it isn't available yet."}
      />
    </Material>
  {:else}
    <div
      class="flex justify-center py-8"
      role="status"
      aria-label="Loading post"
    >
      <Spinner width={24} />
    </div>
  {/if}
</div>
