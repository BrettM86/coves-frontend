<script lang="ts">
  import { browser } from '$app/environment'
  import { XrpcError } from '$lib/api/coves/xrpc'
  import type { FeedViewPost, FeedPaginationParams } from '$lib/api/coves/types'
  import { errorMessage } from '$lib/app/error'
  import { t } from '$lib/app/i18n'
  import VirtualList from '$lib/app/render/VirtualList.svelte'
  import { settings } from '$lib/app/settings.svelte'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import EndPlaceholder from '$lib/ui/layout/EndPlaceholder.svelte'
  import { Button, Material, Spinner } from 'mono-svelte'
  import { onMount, untrack } from 'svelte'
  import {
    ArchiveBox,
    ArrowTopRightOnSquare,
    ChevronDoubleUp,
    ExclamationTriangle,
    Icon,
  } from 'svelte-hero-icons/dist'
  import InfiniteScroll from 'svelte-infinite-scroll'
  import { expoOut } from 'svelte/easing'
  import { SvelteSet } from 'svelte/reactivity'
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
  let hasMore = $state(!!loadFeed)

  let seenUris = new SvelteSet<string>(
    (posts ?? []).map((fp) => fp.post.uri as string),
  )

  async function loadMore(): Promise<void> {
    if (!hasMore || loading || !loadFeed) return

    try {
      loading = true

      const response = await loadFeed(params)

      error = null

      hasMore = response.feed.length !== 0 && !!response.cursor

      if (response.cursor) {
        params = { ...params, cursor: response.cursor }
      }

      posts.push(
        ...response.feed.filter((feedPost) => {
          const uri = feedPost.post.uri as string
          if (seenUris.has(uri)) return false
          seenUris.add(uri)
          return true
        }),
      )
    } catch (e) {
      console.error('Failed to load more posts:', e)
      error = e
    } finally {
      loading = false
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
              post={feedPost.post}
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
      <div class="w-full h-32 grid place-items-center">
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
    <InfiniteScroll window threshold={300} on:loadMore={loadMore} />
  {/if}
  {@render children?.()}
</ul>
