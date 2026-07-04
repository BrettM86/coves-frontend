<script lang="ts">
  import { page } from '$app/state'
  import { coves } from '$lib/api/client.svelte'
  import { errorMessage } from '$lib/app/error'
  import { t } from '$lib/app/i18n'
  import { settings } from '$lib/app/settings.svelte'
  import { mapSort } from '$lib/app/sort'
  import CommentProvider from '$lib/feature/comment/CommentProvider.svelte'
  import { commentLink, Post, postLink } from '$lib/feature/post'
  import { Button, Material, Spinner, toast } from 'mono-svelte'
  import { ArrowUturnUp, QueueList } from 'svelte-hero-icons/dist'
  import type { PageData } from './$types'

  interface Props {
    data: PageData
  }

  let { data }: Props = $props()

  let post = $derived(data.data.value.post)
  let focused = $derived(data.data.value.focused)

  async function reloadComments(): Promise<void> {
    const value = data.data.value
    // Mirror the loader's precedence: an explicit ?sort= URL param wins over
    // the user's default comment sort.
    const { sort } = mapSort(
      page.url.searchParams.get('sort') ?? settings.defaultSort.comments,
    )
    try {
      const { comments } = await coves().getComments({
        ...value.params.comments,
        sort,
      })
      // Only swap in the (already-resolved) result on success so a transient
      // failure keeps the previously loaded comment tree on screen.
      value.comments = Promise.resolve(comments)
    } catch (err) {
      console.error('[comment-permalink] Failed to reload comments:', err)
      toast({ content: errorMessage(err), type: 'error' })
    }
  }
</script>

<svelte:head>
  <title>
    {post.record?.title ?? $t('comment.permalink.postFallback')} · {$t(
      'comment.permalink.title',
    )}
  </title>
  <meta
    name="description"
    content={post.record?.content?.slice(0, 200) ?? ''}
  />
  <meta
    property="og:title"
    content={post.record?.title ?? $t('comment.permalink.postFallback')}
  />
  <meta
    property="og:description"
    content={post.record?.content?.slice(0, 200) ?? ''}
  />
</svelte:head>

<div class="flex flex-col gap-4 w-full max-w-full">
  <!-- Compact post header for context; the title links back to the post page. -->
  <Material padding="none" rounding="2xl" class="overflow-hidden">
    <Post {post} actions={true} view="compact" class="px-4 sm:px-6" />
  </Material>

  <!-- Single-thread banner: explicit text + real links, not just color. -->
  <Material
    padding="sm"
    rounding="xl"
    color="info"
    class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
  >
    <p class="text-sm font-medium px-1.5">
      {$t('comment.permalink.single')}
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <Button
        href="{postLink(post)}#comment-{encodeURIComponent(focused.rkey)}"
        rounding="pill"
        color="secondary"
        icon={QueueList}
      >
        {$t('comment.permalink.allComments')}
      </Button>
      {#if focused.parentUri}
        <Button
          href={commentLink(post, focused.parentUri)}
          rounding="pill"
          color="secondary"
          icon={ArrowUturnUp}
        >
          {$t('comment.permalink.context')}
        </Button>
      {/if}
    </div>
  </Material>

  <!-- The focused comment's subtree, rooted at the focused comment. -->
  <section
    class="flex flex-col gap-2"
    aria-label={$t('routes.post.commentCount')}
  >
    {#await data.data.value.comments}
      <div
        class="flex justify-center py-8"
        role="status"
        aria-label={$t('comment.permalink.loading')}
      >
        <Spinner width={24} />
      </div>
    {:then comments}
      <CommentProvider {post} {comments} onupdate={reloadComments} />
    {:catch}
      <p class="text-sm text-red-500 py-4 text-center">
        {$t('comment.permalink.failed')}
      </p>
    {/await}
  </section>
</div>
