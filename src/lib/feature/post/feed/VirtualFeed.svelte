<script lang="ts">
  import { browser } from '$app/environment'
  import { XrpcError } from '$lib/api/coves/xrpc'
  import type { FeedViewPost, FeedPaginationParams } from '$lib/api/coves/types'
  import { errorMessage } from '$lib/app/util/error'
  import { t } from '$lib/app/state/i18n'
  import VirtualList from '$lib/ui/generic/VirtualList.svelte'
  import { settings } from '$lib/app/state/settings.svelte'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import EndPlaceholder from '$lib/ui/layout/EndPlaceholder.svelte'
  import { Button, Material, Spinner } from '$lib/ui/kit'
  import { onMount, tick, untrack } from 'svelte'
  import {
    ArchiveBox,
    ArrowTopRightOnSquare,
    ChevronDoubleUp,
    ExclamationTriangle,
    Icon,
  } from '@xylightdev/svelte-hero-icons'
  import { expoOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { Post } from '..'

  interface Props {
    posts: FeedViewPost[]
    params: FeedPaginationParams
    virtualList?: { itemHeights: (number | null)[] }
    lastSeen?: number
    community?: boolean
    loadFeed?: (
      params: FeedPaginationParams,
    ) => Promise<{ feed: FeedViewPost[]; cursor?: string }>
    children?: import('svelte').Snippet
  }

  let {
    posts = $bindable(),
    params = $bindable(),
    virtualList = $bindable(),
    lastSeen = $bindable(0),
    community = false,
    loadFeed,
    children,
  }: Props = $props()

  let listEl = $state<HTMLUListElement>()
  let listComp = $state<{
    scrollToIndex: (index: number, window?: boolean) => void
  }>()

  let error = $state<unknown>()
  let isAuthError = $derived(
    error instanceof XrpcError &&
      (error.status === 401 || error.status === 403),
  )
  let loading = $state(false)

  // A plain Set: `seenUris` is only ever read and written inside loadMore(),
  // never from the template, so it carries no reactivity.
  function seedSeenUris(feed: FeedViewPost[] | undefined): Set<string> {
    return new Set((feed ?? []).map((fp) => fp.post.uri as string))
  }

  // Neither of these can become a $derived: `hasMore` latches false once the
  // API runs out of pages, and `seenUris` accumulates every URI loadMore() has
  // appended. But this component is reused across client-side navigation, so
  // carrying either into a different feed is wrong — the new feed would start
  // with the old one's end-of-feed latch and silently drop any post whose URI
  // the old feed had already shown.
  //
  // A feed switch is exactly a new `posts` array identity: loadMore() appends
  // with posts.push(), which mutates in place and leaves identity untouched
  // (the same property the {#key posts} block below relies on to avoid
  // rebuilding the virtual list after every page).
  //
  // The identity comparison is REQUIRED, not an optimisation. The effect
  // re-runs whenever route data is rebuilt, while Feed.load returns its SAME
  // cached array when the params are unchanged — so a navigation or
  // invalidation that lands back on the same feed re-runs this effect with an
  // identical array. Re-seeding then would un-latch `hasMore` on an
  // already-exhausted feed, replacing the end-of-feed placeholder with the
  // spinner sentinel and firing a redundant fetch with a stale cursor.
  //
  // The untrack() inside the effect keeps its secondary reads (`loadFeed`,
  // the seed iteration) out of the dependency set, so only a change of
  // `posts` identity re-runs it. The init-time untrack()s below are one-time
  // seeds: init reads are never reactive, so untrack() there documents the
  // intent and silences state_referenced_locally. `lastPosts` is a plain
  // `let`, not $state, so updating it here cannot re-trigger the effect.
  let hasMore = $state(untrack(() => !!loadFeed))
  let seenUris = untrack(() => seedSeenUris(posts))
  let lastPosts = untrack(() => posts)

  $effect(() => {
    const feed = posts
    untrack(() => {
      if (feed === lastPosts) return
      lastPosts = feed
      seenUris = seedSeenUris(feed)
      hasMore = !!loadFeed
      // `error` is per-feed state too. The markup is an if/else chain —
      // {#if error} … {:else if hasMore} is what mounts the sentinel — so
      // carrying a failure from the previous feed would report an error about
      // a feed the user has left AND permanently stall the new one, because
      // the sentinel that triggers page 2 never gets mounted.
      error = undefined
    })
  })

  const SCROLL_THRESHOLD = 300

  // Load-more trigger: observe the loading sentinel so that entering view
  // (scroll, End key, scrollbar drag, programmatic scroll) always loads the
  // next page, independent of how the viewport got there.
  let sentinel = $state<HTMLDivElement>()
  $effect(() => {
    if (!sentinel) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { rootMargin: `${SCROLL_THRESHOLD}px` },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  })

  // A plain `let` for the same reason as `seenUris`: only loadMore() reads or
  // writes it, so it carries no reactivity.
  //
  // IntersectionObserver fires on intersection *changes* only, so a trigger
  // dropped because a request was already in flight is never re-delivered —
  // the sentinel was and stays intersecting. That is the feed-switch stall:
  // the user navigates while page N of the old feed is in flight, the new
  // sentinel's initial callback lands on a busy loadMore() and is lost, and
  // the old request settles onto a feed it no longer owns. Recording the
  // dropped trigger lets the settling request re-arm on its way out.
  let pendingTrigger = false

  /**
   * Whether the sentinel is within SCROLL_THRESHOLD of the viewport — the same
   * question the IntersectionObserver above answers, asked on demand.
   *
   * Deliberately sentinel-relative rather than document-relative: the sentinel
   * is not the end of the page (the `children` snippet renders after it), so a
   * "scrolled to the bottom of the document" test reports false while the
   * spinner sits in plain view.
   */
  function sentinelInView(): boolean {
    if (!browser || !sentinel) return false
    const rect = sentinel.getBoundingClientRect()
    return rect.top - SCROLL_THRESHOLD <= window.innerHeight && rect.bottom >= 0
  }

  async function loadMore(): Promise<void> {
    if (loading) {
      pendingTrigger = true
      return
    }
    if (!hasMore || !loadFeed) return

    // Captured before the await: a navigation can swap the feed while a page
    // is in flight, and every write below targets live bindables. A settlement
    // that arrives for a feed the user has left must be discarded wholesale —
    // the reset $effect above has already re-seeded the per-feed state, and
    // committing would splice the old feed's page into the new feed's array
    // and overwrite its cursor with the old feed's continuation.
    const feed = posts

    try {
      loading = true

      const response = await loadFeed(params)

      if (posts !== feed) return

      error = undefined

      const requestedCursor = params.cursor

      if (response.cursor) {
        params = { ...params, cursor: response.cursor }
      }

      const added = response.feed.filter((feedPost) => {
        const uri = feedPost.post.uri as string
        if (seenUris.has(uri)) return false
        seenUris.add(uri)
        return true
      })

      posts.push(...added)

      // `hasMore` is deliberately computed from the post-dedupe count, not
      // from response.feed.length. A backend whose cursor fails to advance
      // returns the same page forever: every item is a duplicate, `posts`
      // never grows, and the re-arm below would refetch it without end. Zero
      // new posts is the only observable symptom of that, so treat it as the
      // end of the feed and say why.
      if (response.feed.length !== 0 && added.length === 0) {
        console.warn('[feed] page returned no new posts; stopping pagination', {
          cursor: requestedCursor,
          returned: response.feed.length,
        })
      }

      hasMore = added.length !== 0 && !!response.cursor
    } catch (e) {
      if (posts !== feed) {
        // Not `error = e`: that would raise an error banner on the new feed
        // about a request the old feed made.
        console.warn(
          'Discarding failed page load for a feed no longer shown:',
          e,
        )
        return
      }
      console.error('Failed to load more posts:', e)
      error = e
    } finally {
      // Released unconditionally: `loading` belongs to the request, not the
      // feed, and leaving it latched would block the new feed's first page.
      loading = false

      // Re-arm on EVERY settle, including the two discard paths above that
      // return early for a feed the user has left, and the error path. Those
      // are precisely the cases where a trigger went missing: nothing else
      // will call loadMore() again, because the observer has already reported
      // the only intersection change it is ever going to see.
      //
      // Two reasons to continue: a trigger arrived while this request held
      // `loading` (pendingTrigger), or the sentinel is still in view now that
      // this page has rendered — a short first page under a tall viewport
      // never leaves the spinner, so it never re-intersects.
      //
      // Everything consulted after the await is CURRENT state, never the
      // captured `feed`: on a discard path the reset $effect has already run
      // (tick() flushes it) and `hasMore`/`error`/`sentinel` describe the feed
      // now on screen, which is the feed that needs the next page.
      const missedTrigger = pendingTrigger
      pendingTrigger = false

      if (browser) {
        await tick()
        if (!error && hasMore && (missedTrigger || sentinelInView())) {
          // Queued rather than awaited so a run of short pages unwinds this
          // frame instead of nesting one loadMore() inside the last.
          queueMicrotask(() => loadMore())
        }
      }
    }
  }

  const callback: IntersectionObserverCallback = (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return

      const element = entry.target as HTMLElement
      const id = element.getAttribute('data-index')

      if (!id) return

      lastSeen = Number(id)

      observer.unobserve(element)
    })
  }

  onMount(() => {
    const observer = new IntersectionObserver(callback, {
      threshold: 0.5,
    })

    const observePost = (node: Node) => {
      if (
        node instanceof HTMLElement &&
        node.classList.contains('post-container')
      )
        observer.observe(node)
    }

    const unobservePost = (node: Node) => {
      if (
        node instanceof HTMLElement &&
        node.classList.contains('post-container')
      )
        observer.unobserve(node)
    }

    document.querySelectorAll('.post-container').forEach(observePost)

    const feed = document.getElementById('feed')
    if (!feed) return

    new MutationObserver((mutations) => {
      mutations.forEach(({ addedNodes, removedNodes }) => {
        addedNodes.forEach(observePost)
        removedNodes.forEach(unobservePost)
      })
    }).observe(feed, { childList: true, subtree: false })
  })

  $effect(() => {
    if (listComp) {
      untrack(() => {
        if (lastSeen != 0) {
          listComp?.scrollToIndex(lastSeen, true)
        }
      })
    }
  })

  let initialOffset = $derived(listEl?.offsetTop)
</script>

<ul class="flex flex-col list-none" bind:this={listEl}>
  {#key posts}
    {#if posts?.length == 0}
      <div class="h-full grid place-items-center my-8">
        <Placeholder
          icon={ArchiveBox}
          title={$t('routes.frontpage.empty.title')}
          description={$t('routes.frontpage.empty.description')}
        >
          <Button
            href="/explore/communities"
            rounding="pill"
            color="primary"
            icon={ArrowTopRightOnSquare}
          >
            {$t('nav.communities')}
          </Button>
        </Placeholder>
      </div>
    {:else}
      <VirtualList
        id="feed"
        class="divide-y -mx-3 sm:-mx-6 divide-slate-100 dark:divide-zinc-900"
        items={posts}
        {initialOffset}
        overscan={3}
        estimatedHeight={settings.view == 'cozy' ? 500 : 150}
        bind:restore={virtualList}
        bind:this={listComp}
      >
        {#snippet item(row)}
          {@const feedPost = posts[row]}
          {@const isPinned =
            feedPost?.reason?.$type === 'social.coves.feed.defs#reasonPin'}
          <li
            in:fly={row < 7
              ? { duration: 800, easing: expoOut, y: 24, delay: row * 50 }
              : { opacity: 1, duration: 0 }}
            data-index={row}
            class={['relative post-container', row < 7 && '']}
          >
            <Post
              bind:post={posts[row].post}
              pinned={isPinned}
              hideCommunity={community}
              view={isPinned && settings.posts.compactFeatured
                ? 'compact'
                : settings.view}
              class="px-3 sm:px-6 hover:bg-slate-100/30 hover:dark:bg-zinc-900/30 transition-colors"
            ></Post>
          </li>
        {/snippet}
      </VirtualList>
    {/if}
  {/key}

  {#if settings.infiniteScroll && browser && posts.length > 0}
    {#if error}
      <Material color="error" class="flex flex-col gap-4">
        <div>
          <Icon
            src={ExclamationTriangle}
            size="20"
            micro
            class="inline-block rounded-lg clear-both float-left mr-2"
          />
          {#if isAuthError}
            {$t('toast.sessionExpired')}
          {:else}
            {errorMessage(error)}
          {/if}
        </div>
        {#if isAuthError}
          <Button color="primary" href="/login">
            {$t('account.login')}
          </Button>
        {:else}
          <Button
            color="primary"
            {loading}
            disabled={loading}
            onclick={() => loadMore()}
          >
            {$t('message.retry')}
          </Button>
        {/if}
      </Material>
    {:else if hasMore}
      <div bind:this={sentinel} class="w-full h-32 grid place-items-center">
        <Spinner width={24} />
      </div>
    {:else}
      <div style="border-top-width: 0">
        <EndPlaceholder>
          {$t('routes.frontpage.endFeed')}
          {#snippet action()}
            <Button color="tertiary" icon={ChevronDoubleUp}>
              {$t('routes.post.scrollToTop')}
            </Button>
          {/snippet}
        </EndPlaceholder>
      </div>
    {/if}
  {/if}
  {@render children?.()}
</ul>
