<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import FeedTabs from '$lib/feature/filter/FeedTabs.svelte'
  import SortMenu from '$lib/feature/filter/SortMenu.svelte'
  import ViewSelect from '$lib/feature/filter/ViewSelect.svelte'
  import PostFeed from '$lib/feature/post/feed/PostFeed.svelte'
  import VirtualFeed from '$lib/feature/post/feed/VirtualFeed.svelte'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import Skeleton from '$lib/ui/generic/Skeleton.svelte'
  import { Header, Pageination } from '$lib/ui/layout'
  import { Button } from '$lib/ui/kit'
  import { Archive, ExternalLink } from '$lib/ui/kit/icon'
  import { untrack } from 'svelte'
  let { data = $bindable() } = $props()

  // Defaults are saved by the controls themselves (SortMenu, FeedTabs) on a
  // real selection. Persisting from here instead would rewrite them for anyone
  // who merely *opened* a link that named a sort or feed.

  let virtualFeed = $state<VirtualFeed>()

  function viewerIdentity(): string | undefined {
    const viewer = profile.current
    return viewer.type === 'authenticated' ? viewer.did : undefined
  }

  let feedViewerIdentity = data.viewerIdentity
  $effect.pre(() => {
    const currentViewerIdentity = viewerIdentity()
    const routeOwnsFeed =
      !browser ||
      !settings.infiniteScroll ||
      settings.posts.noVirtualize ||
      !virtualFeed

    if (currentViewerIdentity === feedViewerIdentity) return

    feedViewerIdentity = currentViewerIdentity
    if (routeOwnsFeed) {
      data.feed.value = untrack(() => data.loadPageOne(currentViewerIdentity))
    }
  })

  let retryRemainingSeconds = $state(0)
  let retryTimeout: number | undefined

  function clearRetryTimeout(): void {
    if (retryTimeout !== undefined) clearTimeout(retryTimeout)
    retryTimeout = undefined
  }

  $effect(() => {
    const retryDeadline = data.recovery.value.retryDeadline
    clearRetryTimeout()
    retryRemainingSeconds = 0
    if (retryDeadline === undefined) return

    const update = () => {
      const remainingSeconds = Math.max(
        0,
        Math.ceil((retryDeadline - Date.now()) / 1000),
      )
      retryRemainingSeconds = remainingSeconds
      if (remainingSeconds === 0) {
        retryTimeout = undefined
        return
      }

      const nextSecond = Math.max(
        1,
        retryDeadline - Date.now() - (remainingSeconds - 1) * 1000,
      )
      retryTimeout = Number(setTimeout(update, nextSecond))
    }

    update()
    return clearRetryTimeout
  })

  function retryRoute(): void {
    if (retryRemainingSeconds > 0) return
    const target = new URL(page.url)
    if (data.recovery.value.target === 'page-one') {
      target.searchParams.delete('cursor')
    }
    void goto(target, { invalidateAll: true })
  }
</script>

<svelte:head>
  <title>Coves</title>
</svelte:head>

<Header pageHeader>
  <FeedTabs bind:selected={data.filters.value.type_} />
  {#snippet extended()}
    <div class="flex flex-row gap-2 items-center">
      <SortMenu
        bind:sort={data.filters.value.sort}
        bind:timeframe={data.filters.value.timeframe}
      />
      <ViewSelect placement="bottom" showLabel={false} />
    </div>
  {/snippet}
</Header>

{#await data.feed.value}
  <div class="space-y-4">
    {#each new Array(5) as _, index}
      <div
        class="animate-pop-in"
        style="animation-delay: {index * 50}ms; opacity: 0; width: {(1 /
          ((index + 1) % 3)) *
          100}%"
      >
        <Skeleton />
      </div>
    {/each}
  </div>
{:then feed}
  {#if feed}
    {#if settings.infiniteScroll && browser && !settings.posts.noVirtualize}
      <VirtualFeed
        bind:this={virtualFeed}
        bind:posts={feed.feed}
        bind:params={feed.params}
        virtualList={feed.virtualList}
        loadFeed={data.loadFeed}
      />
    {:else}
      <PostFeed bind:posts={feed.feed} />
    {/if}
    <svelte:element
      this={settings.infiniteScroll && !settings.posts.noVirtualize
        ? 'noscript'
        : 'div'}
    >
      <Pageination
        cursor={{ next: feed.params.cursor }}
        hasMore={!!feed.params.cursor}
        href={(page) =>
          typeof page == 'number'
            ? `?page=${page}`
            : `?cursor=${encodeURIComponent(page)}`}
        back={false}
      />
    </svelte:element>
  {:else}
    <div class="h-full grid place-items-center my-8">
      <Placeholder
        icon={Archive}
        title={$t('routes.frontpage.empty.title')}
        description={$t('routes.frontpage.empty.description')}
      >
        <Button
          href="/explore/communities"
          rounding="pill"
          color="primary"
          icon={ExternalLink}
        >
          {$t('nav.communities')}
        </Button>
      </Placeholder>
    </div>
  {/if}
{:catch error}
  <div class="flex flex-col items-center gap-4 py-8 text-center">
    <p class="text-lg font-medium text-red-500 dark:text-red-400">
      {$t('message.error')}
    </p>
    <p class="text-sm text-slate-500 dark:text-zinc-400">
      {error?.message ?? String(error)}
    </p>
    {#if retryRemainingSeconds > 0}
      <p role="status" aria-live="off" aria-atomic="true">
        {$t('message.retryAfter', { seconds: retryRemainingSeconds })}
      </p>
    {/if}
    <Button
      disabled={retryRemainingSeconds > 0}
      onclick={retryRoute}
    >
      {$t('message.retry')}
    </Button>
  </div>
{/await}
