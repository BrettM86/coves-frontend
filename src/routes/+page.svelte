<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
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
  import { ArchiveBox, ArrowTopRightOnSquare } from 'svelte-hero-icons/dist'

  let { data = $bindable() } = $props()

  // Defaults are saved by the controls themselves (SortMenu, FeedTabs) on a
  // real selection. Persisting from here instead would rewrite them for anyone
  // who merely *opened* a link that named a sort or feed.

  const FeedComponent = $derived(
    settings.infiniteScroll && browser && !settings.posts.noVirtualize
      ? VirtualFeed
      : PostFeed,
  )
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
    <FeedComponent
      bind:posts={feed.feed}
      bind:params={feed.params}
      loadFeed={data.loadFeed}
    />
    <svelte:element
      this={settings.infiniteScroll && !settings.posts.noVirtualize
        ? 'noscript'
        : 'div'}
    >
      <Pageination
        cursor={{ next: feed.cursor }}
        href={(page) =>
          typeof page == 'number' ? `?page=${page}` : `?cursor=${page}`}
        back={false}
      />
    </svelte:element>
  {:else}
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
  {/if}
{:catch error}
  <div class="flex flex-col items-center gap-4 py-8 text-center">
    <p class="text-lg font-medium text-red-500 dark:text-red-400">
      {$t('message.error')}
    </p>
    <p class="text-sm text-slate-500 dark:text-zinc-400">
      {error?.message ?? String(error)}
    </p>
    <Button onclick={() => goto(page.url, { invalidateAll: true })}>
      {$t('message.retry')}
    </Button>
  </div>
{/await}
