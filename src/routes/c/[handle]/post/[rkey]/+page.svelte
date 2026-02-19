<script lang="ts">
  import type { ThreadViewComment } from '$lib/api/coves/types'
  import Markdown from '$lib/app/markdown/Markdown.svelte'
  import { Post } from '$lib/feature/post'
  import UserLink from '$lib/feature/user/UserLink.svelte'
  import { publishedToDate } from '$lib/ui/util/date'
  import { Material, Spinner } from 'mono-svelte'
  import { formatRelativeDate } from 'mono-svelte/util/RelativeDate.svelte'
  import { ChatBubbleOvalLeft, ChevronDown, Icon } from 'svelte-hero-icons/dist'
  import type { PageData } from './$types'

  interface Props {
    data: PageData
  }

  let { data }: Props = $props()
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
        {#if comments.length === 0}
          <p class="text-sm text-slate-500 dark:text-zinc-400 py-4 text-center">
            No comments yet. Be the first to comment!
          </p>
        {:else}
          <div class="flex flex-col gap-1">
            {#each comments as thread (thread.comment.uri)}
              {@render commentThread(thread, 0)}
            {/each}
          </div>
        {/if}
      {:catch}
        <p class="text-sm text-red-500 py-4 text-center">
          Failed to load comments.
        </p>
      {/await}
    </section>
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

{#snippet commentThread(thread: ThreadViewComment, depth: number)}
  {@const maxVisibleDepth = 6}
  <div
    class={[
      depth > 0 && 'border-l-2 border-slate-200 dark:border-zinc-700 pl-3',
    ]}
    style={depth === 0
      ? ''
      : `margin-left: ${Math.min(depth, maxVisibleDepth) > 1 ? '0.25rem' : '0'}`}
  >
    <Material padding="sm" rounding="xl" class="mb-1">
      <div
        class="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400"
      >
        <UserLink user={thread.comment.author} avatarSize={18} avatar />
        <span>
          {formatRelativeDate(publishedToDate(thread.comment.createdAt), {
            style: 'short',
          })}
        </span>
        {#if thread.comment.stats}
          <span class="text-xs">
            {thread.comment.stats.score} points
          </span>
        {/if}
      </div>
      <div class="mt-1 text-sm text-slate-700 dark:text-zinc-300">
        <Markdown source={thread.comment.record.content} />
      </div>
    </Material>

    {#if thread.replies?.length}
      <div class="flex flex-col gap-0.5">
        {#each thread.replies as reply (reply.comment.uri)}
          {#if depth < maxVisibleDepth}
            {@render commentThread(reply, depth + 1)}
          {:else}
            <!-- Prevent excessively deep nesting -->
            <a
              href="?thread=0.{reply.comment.uri}"
              class="text-xs text-primary-600 dark:text-primary-400 hover:underline pl-3 py-1"
            >
              <Icon src={ChevronDown} size="12" mini class="inline" />
              Continue thread
            </a>
          {/if}
        {/each}
      </div>
    {/if}

    {#if thread.hasMore}
      <!-- TODO: Implement "load more" when the comments API supports
           cursor-based pagination within a thread -->
      <a
        href="?thread=0.{thread.comment.uri}"
        class="text-xs text-primary-600 dark:text-primary-400 hover:underline pl-3 py-1 block"
      >
        Load more replies...
      </a>
    {/if}
  </div>
{/snippet}
