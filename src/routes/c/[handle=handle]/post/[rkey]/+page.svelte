<script lang="ts">
  import { page } from '$app/state'
  import { coves } from '$lib/api/client.svelte'
  import { errorMessage } from '$lib/app/error'
  import { t } from '$lib/app/i18n'
  import { settings } from '$lib/app/settings.svelte'
  import { mapSort } from '$lib/app/sort'
  import CommentProvider from '$lib/feature/comment/CommentProvider.svelte'
  import { Post } from '$lib/feature/post'
  import { postTextFallback } from '$lib/feature/post/helpers'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import { Material, Spinner, toast } from 'mono-svelte'
  import { ChatBubbleOvalLeft, Icon, NoSymbol } from 'svelte-hero-icons/dist'
  import { tick } from 'svelte'
  import type { PageData } from './$types'

  interface Props {
    data: PageData
  }

  let { data }: Props = $props()

  const HIGHLIGHT_CLASS = 'comment-highlight'
  const HIGHLIGHT_DURATION_MS = 2500
  /** Total budget for the target row to mount and measure before giving up. */
  const SCROLL_DEADLINE_MS = 2000
  const SCROLL_POLL_INTERVAL_MS = 50

  let commentProvider = $state<CommentProvider>()

  // Deep links carry a `#comment-<rkey>` fragment (see `commentLink`). Once
  // the comment tree has rendered, mount the target's top-level row in the
  // virtualized list, scroll the target into view, and flash a brief
  // highlight. When the target can't be honored — its rkey isn't in the
  // loaded tree (deeper than the inline cutoff or unloaded), or its row never
  // mounts within the deadline — say so with a toast instead of no-oping.
  $effect(() => {
    // page.url.hash is the reactive trigger for client-side navigations, but
    // it's empty on the initial load (the fragment never reaches the server,
    // and hydration keeps the SSR URL) — window.location is the truth.
    void page.url.hash
    const hash = window.location.hash
    const commentsPromise = data.data.value?.comments
    if (!hash.startsWith('#comment-') || !commentsPromise) return

    let cancelled = false
    let highlightTimer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setTimeout> | undefined

    let id: string
    try {
      id = decodeURIComponent(hash.slice(1))
    } catch {
      return // malformed percent-encoding in the fragment
    }
    const rkey = id.slice('comment-'.length)

    const notFound = () =>
      toast({ content: $t('toast.commentNotFound'), type: 'error' })

    const highlight = (el: HTMLElement) => {
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches
      // Class first: it also sets scroll-margin-top, which must be in
      // place before scrollIntoView measures the target position.
      el.classList.add(HIGHLIGHT_CLASS)
      el.scrollIntoView({
        behavior: reduceMotion ? 'instant' : 'smooth',
        block: 'start',
      })
      highlightTimer = setTimeout(() => {
        el.classList.remove(HIGHLIGHT_CLASS)
      }, HIGHLIGHT_DURATION_MS)
    }

    void commentsPromise
      .then(() => tick())
      .then(() => {
        if (cancelled) return
        const deadline = Date.now() + SCROLL_DEADLINE_MS
        let rowScrolled = false

        // The target may start unmounted (virtualized below the fold), so
        // point the virtualizer at its top-level row first, then poll —
        // bounded by a deadline rather than a single timeout guess, so slow
        // devices get more than one frame — for the element to mount.
        const attempt = () => {
          if (cancelled) return
          const el = document.getElementById(id)
          if (el) {
            highlight(el)
            return
          }
          if (!rowScrolled && commentProvider) {
            const result = commentProvider.scrollToComment(rkey)
            if (result === 'missing') {
              notFound()
              return
            }
            rowScrolled = result === 'scrolled'
          }
          if (Date.now() >= deadline) {
            notFound()
            return
          }
          pollTimer = setTimeout(attempt, SCROLL_POLL_INTERVAL_MS)
        }
        attempt()
      })
      .catch(() => {
        // Comment loading failures are already surfaced by the await block.
      })

    return () => {
      cancelled = true
      if (highlightTimer !== undefined) clearTimeout(highlightTimer)
      if (pollTimer !== undefined) clearTimeout(pollTimer)
    }
  })

  async function reloadComments(): Promise<void> {
    const value = data.data.value
    if (!value?.post) return
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
      value.params.thread.singleThread = false
    } catch (err) {
      console.error('[post] Failed to reload comments:', err)
      toast({ content: errorMessage(err), type: 'error' })
    }
  }
</script>

<svelte:head>
  {#if data.data.value?.post}
    {@const headPost = data.data.value.post}
    {@const headTitle =
      headPost.record?.title ??
      postTextFallback(headPost.record?.content, 80) ??
      `Post by @${headPost.author.handle}`}
    <title>
      {headTitle}
    </title>
    <meta
      name="description"
      content={headPost.record?.content?.slice(0, 200) ?? ''}
    />
    <meta property="og:title" content={headTitle} />
    <meta
      property="og:description"
      content={headPost.record?.content?.slice(0, 200) ?? ''}
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
          bind:this={commentProvider}
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

<style>
  @reference '../../../../../app.css';

  /* Applied transiently by the #comment-<rkey> deep-link effect above:
     a primary-tinted background that fades out over the comment row. */
  :global(.comment-highlight) {
    --comment-highlight-from: color-mix(
      in oklab,
      var(--color-primary-100) 60%,
      transparent
    );
    @variant dark {
      --comment-highlight-from: color-mix(
        in oklab,
        var(--color-primary-900) 40%,
        transparent
      );
    }
    scroll-margin-top: calc(var(--spacing) * 20);
    border-radius: var(--radius-xl);
    animation: comment-highlight-fade 2.4s cubic-bezier(0.075, 0.82, 0.165, 1)
      both;
  }

  @keyframes comment-highlight-fade {
    from {
      background-color: var(--comment-highlight-from);
    }
    to {
      background-color: transparent;
    }
  }
</style>
