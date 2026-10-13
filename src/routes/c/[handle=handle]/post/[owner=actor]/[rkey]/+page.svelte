<script lang="ts">
  import { goto, replaceState } from '$app/navigation'
  import { page } from '$app/state'
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/state/auth.svelte'
  import { errorMessage } from '$lib/app/util/error'
  import { isExpiredSessionError } from '$lib/app/util/session-expired-error'
  import { log } from '$lib/app/util/log'
  import { t } from '$lib/app/state/i18n'
  import CommentProvider from '$lib/feature/comment/CommentProvider.svelte'
  import { Post } from '$lib/feature/post'
  import { postLink, postTextFallback } from '$lib/feature/post/helpers'
  import {
    isThreadRootGoneError,
    logThreadRootGone,
    reprobeGoneThread,
    type UnavailableThread,
  } from '$lib/feature/post/owner'
  import PostUnavailable, {
    unavailableTitleKey,
  } from '$lib/feature/post/PostUnavailable.svelte'
  import { Header, Pageination } from '$lib/ui/layout'
  import { Button, Material, Spinner, toast } from '$lib/ui/kit'
  import { Icon, ArrowLeft, MessageSquare } from '$lib/ui/kit/icon'
  import { tick } from 'svelte'
  import { SvelteURL } from 'svelte/reactivity'
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
  const postFeedOrigin = page.state.postFeedOrigin

  // A loaded post can turn out removed once its thread 404s: the loader (for
  // a preloaded post) or a comments retry re-probes it and the comments result
  // names what happened, so the stale post gives way to its tombstone.
  let lateUnavailable = $state<UnavailableThread>()
  $effect(() => {
    const commentsPromise = data.data.value?.comments
    lateUnavailable = undefined
    if (!commentsPromise) return
    let current = true
    commentsPromise.then(
      (result) => {
        if (current && 'postUnavailable' in result && result.postUnavailable) {
          lateUnavailable = result
        }
      },
      // Comment loading failures are surfaced by the await block.
      () => undefined,
    )
    return () => {
      current = false
    }
  })

  function handleBack(event: MouseEvent): void {
    if (
      !postFeedOrigin ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    event.preventDefault()
    // Skip intermediate post-page history while carrying feed restoration state.
    void goto(postFeedOrigin.url, {
      state: { postFeedOrigin },
    })
  }

  // `?uri=` is a one-use hint that lets the loader fetch a newly-created
  // record before the AppView has indexed it. Once that exact post renders on
  // its canonical path, keep the useful query state and fragment but remove
  // the transport detail from the shareable URL.
  $effect(() => {
    const post = data.data.value?.post
    if (
      !post ||
      page.url.pathname !== postLink(post) ||
      page.url.searchParams.get('uri') !== post.uri
    ) {
      return
    }

    const expectedPath = postLink(post)
    const expectedUri = post.uri
    // Initial component effects can flush before SvelteKit marks its router as
    // started. A macrotask crosses that boundary; the second guard prevents an
    // old page instance from rewriting a navigation that won the race.
    const cleanupTimer = setTimeout(() => {
      if (
        page.url.pathname !== expectedPath ||
        page.url.searchParams.get('uri') !== expectedUri
      ) {
        return
      }

      const currentUrl = new SvelteURL(page.url)
      currentUrl.searchParams.delete('uri')
      // Fragments do not reach the server, so SvelteKit's initial page URL can
      // omit one that is present in the browser address bar.
      if (window.location.hash) currentUrl.hash = window.location.hash
      replaceState(
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
        page.state,
      )
    }, 0)

    return () => clearTimeout(cleanupTimer)
  })

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
      // A gone thread has no comment to scroll to; the page already says so.
      .then(async (result) => {
        if ('unavailable' in result) return false
        await tick()
        return true
      })
      .then((threadLoaded) => {
        if (cancelled || !threadLoaded) return
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

  // Latest reload wins: an older request that settles after a newer one, or
  // after navigation to another post, must not overwrite what is on screen.
  let reloadGeneration = 0

  async function reloadComments(): Promise<void> {
    const value = data.data.value
    if (!value?.post) return
    const generation = ++reloadGeneration
    const superseded = () =>
      generation !== reloadGeneration || data.data.value !== value
    try {
      const comments = await coves().getComments(value.params.comments)
      if (superseded()) return
      // Only swap in the (already-resolved) result on success so a transient
      // failure keeps the previously loaded comment tree on screen.
      value.comments = Promise.resolve(comments)
      value.params.thread.singleThread = false
    } catch (err) {
      // The post was removed since it loaded: show that, not a failure. Ask
      // what happened to it, since the page may have loaded long ago.
      if (isThreadRootGoneError(err)) {
        const uri = value.params.comments.post
        logThreadRootGone(err, uri)
        const gone = await reprobeGoneThread(coves(), uri)
        if (superseded()) return
        value.comments = Promise.resolve(gone)
        return
      }
      log.error('[post] Failed to reload comments', err)
      if (superseded()) return
      if (isExpiredSessionError(err) && profile.sessionExpired) return
      toast({ content: errorMessage(err), type: 'error' })
    }
  }
</script>

<svelte:head>
  {#if lateUnavailable?.postUnavailable}
    <title>{$t(unavailableTitleKey(lateUnavailable.postUnavailable))}</title>
  {:else if data.data.value?.post}
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
    <title>{$t(unavailableTitleKey(data.data.value.unavailable))}</title>
  {/if}
</svelte:head>

{#snippet backNavigation()}
  <Button
    href={postFeedOrigin?.url ?? '/'}
    size="custom"
    color="none"
    rounding="xl"
    class="h-11 w-11 shrink-0 p-2 hover:bg-slate-100 focus-visible:bg-slate-100 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800"
    title={$t('common.back')}
    aria-label={$t('common.back')}
    onclick={handleBack}
  >
    <Icon src={ArrowLeft} size="24" />
  </Button>
{/snippet}

{#if lateUnavailable?.postUnavailable || !data.data.value?.post}
  <Header pageHeader class="items-center">
    {@render backNavigation()}
  </Header>
{/if}

<div class="flex flex-col gap-4 w-full max-w-full">
  {#if lateUnavailable?.postUnavailable}
    <PostUnavailable
      kind={lateUnavailable.postUnavailable}
      community={lateUnavailable.community}
    />
  {:else if data.data.value?.post}
    {@const post = data.data.value.post}

    <Material padding="none" rounding="2xl" class="overflow-hidden px-4">
      <Post
        {post}
        actions={true}
        view="cozy"
        priority
        expandBody
        navigation={backNavigation}
      />
    </Material>

    <!-- Comments Section -->
    <section id="comments" class="flex flex-col gap-2">
      <h2
        class="flex items-center gap-2 text-lg font-medium text-slate-700 dark:text-zinc-300 px-1"
      >
        <Icon src={MessageSquare} size="20" />
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
      {:then commentsPage}
        <!-- The post was removed after it loaded; its thread is gone. -->
        {#if 'unavailable' in commentsPage}
          <p class="text-sm text-slate-500 dark:text-zinc-400 py-4 text-center">
            {$t('post.unavailable.comments')}
          </p>
        {:else}
          {@const comments = commentsPage.comments}
          <CommentProvider
            bind:this={commentProvider}
            bind:post={data.data.value.post}
            {comments}
            sort={data.data.value.params.comments.sort}
            focus={data.data.value.params.thread.focus}
            onupdate={reloadComments}
            showContext={data.data.value.params.thread.showContext}
            singleThread={data.data.value.params.thread.singleThread}
          />
          {#if commentsPage.cursor}
            <Pageination
              cursor={{ next: commentsPage.cursor }}
              hasMore={!!commentsPage.cursor}
              href={(cursor) =>
                `?cursor=${encodeURIComponent(cursor)}&sort=${encodeURIComponent(data.data.value.params.comments.sort ?? 'hot')}`}
              back={false}
              state={postFeedOrigin ? { postFeedOrigin } : undefined}
            />
          {/if}
          {#if comments.length === 0 && !post.stats?.commentCount}
            <p
              class="text-sm text-slate-500 dark:text-zinc-400 py-4 text-center"
            >
              No comments yet. Be the first to comment!
            </p>
          {/if}
        {/if}
      {:catch}
        <div class="flex flex-col items-center gap-2 py-4">
          <p class="text-sm text-red-500 text-center">
            Failed to load comments.
          </p>
          <Button onclick={reloadComments}>{$t('message.retry')}</Button>
        </div>
      {/await}
    </section>
  {:else if data.data.value?.unavailable}
    <PostUnavailable
      kind={data.data.value.unavailable}
      community={data.data.value.community}
    />
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
  @reference '../../../../../../app.css';

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
