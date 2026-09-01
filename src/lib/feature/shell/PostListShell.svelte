<script lang="ts">
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import type { FeedPaginationParams, FeedViewPost } from '$lib/api/coves/types'
  import { t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import {
    mapSort,
    TIMEFRAME_OPTIONS,
    type CovesSortParams,
    type CovesSortType,
    type CovesTimeframe,
  } from '$lib/api/coves/sort'
  import SortMenu from '$lib/feature/filter/SortMenu.svelte'
  import ViewSelect from '$lib/feature/filter/ViewSelect.svelte'
  import PostFeed from '$lib/feature/post/feed/PostFeed.svelte'
  import VirtualFeed from '$lib/feature/post/feed/VirtualFeed.svelte'
  import { Button } from '$lib/ui/kit'
  import { untrack, type Snippet } from 'svelte'
  import { Icon, ArrowRight } from '$lib/ui/kit/icon'
  import { Header, Pageination } from '$lib/ui/layout'

  interface Props {
    posts: FeedViewPost[]
    cursor?: string
    /** Raw sort params from the route's `load()`; validated before display. */
    params: {
      sort?: string
      timeframe?: string
    }
    title?: string
    extended?: Snippet
    getParams: FeedPaginationParams | Record<string, unknown>
    header?: boolean
    loadFeed?: (
      params: FeedPaginationParams,
    ) => Promise<{ feed: FeedViewPost[]; cursor?: string }>
  }

  let {
    params,
    posts = $bindable(),
    cursor = $bindable(),
    title,
    extended: passedExtended,
    getParams,
    header = true,
    loadFeed,
  }: Props = $props()

  function resolveSort(sort?: string, timeframe?: string): CovesSortParams {
    return sort ? mapSort(sort, timeframe) : { sort: 'hot' }
  }

  const routeSort = $derived(resolveSort(params.sort, params.timeframe))

  // Seeded from `routeSort` rather than a second resolveSort() call so the
  // derived stays the single source of truth for route params. A seed is
  // needed because effects don't run during SSR, so the first paint can't wait
  // for the $effect below; init reads are never reactive, so untrack() marks
  // this as a deliberate one-time seed and silences state_referenced_locally.
  let filters = $state<{
    sort: CovesSortType
    timeframe: CovesTimeframe | undefined
  }>(untrack(() => ({ sort: routeSort.sort, timeframe: routeSort.timeframe })))

  // SortMenu navigates, which re-runs load() and hands down new params; the
  // route stays the source of truth so back/forward navigation stays in sync.
  $effect(() => {
    filters.sort = routeSort.sort
    filters.timeframe = routeSort.timeframe
  })

  const FeedComponent = $derived(
    settings.infiniteScroll && browser && !settings.posts.noVirtualize
      ? VirtualFeed
      : PostFeed,
  )
</script>

<div class="flex flex-col gap-2 max-w-full w-full min-w-0">
  {#if header}
    <Header pageHeader>
      {#if title}
        {title}
      {/if}
      {#snippet extended()}
        {@render passedExtended?.()}
        <div class="flex flex-row gap-2 items-center">
          <SortMenu
            bind:sort={filters.sort}
            bind:timeframe={filters.timeframe}
          />
          <ViewSelect placement="bottom" showLabel={false} />

          <noscript>
            <form
              class="flex flex-row gap-2 items-end"
              method="get"
              action={page.url.pathname}
            >
              <select
                name="sort"
                class="btn btn-secondary btn-md rounded-xl"
                aria-label={$t('filter.sort.label')}
              >
                <option value="hot" selected={filters.sort == 'hot'}>
                  {$t('filter.sort.hot')}
                </option>
                <option value="top" selected={filters.sort == 'top'}>
                  {$t('filter.sort.top.label')}
                </option>
                <option value="new" selected={filters.sort == 'new'}>
                  {$t('filter.sort.new')}
                </option>
              </select>
              <select
                name="timeframe"
                class="btn btn-secondary btn-md rounded-xl"
                aria-label={$t('filter.sort.top.time.label')}
              >
                {#each TIMEFRAME_OPTIONS as option (option.value)}
                  <option
                    value={option.value}
                    selected={(filters.timeframe ?? 'all') == option.value}
                  >
                    {$t(option.labelKey)}
                  </option>
                {/each}
              </select>
              <Button class="h-[34px] aspect-square" size="custom" submit>
                <Icon src={ArrowRight} size="16" />
              </Button>
            </form>
          </noscript>
        </div>
      {/snippet}
    </Header>
  {/if}

  <FeedComponent bind:posts bind:params={getParams} {loadFeed} />
  <svelte:element
    this={settings.infiniteScroll && !settings.posts.noVirtualize
      ? 'noscript'
      : 'div'}
    class="mt-auto flex flex-col"
  >
    <Pageination
      cursor={{ next: cursor }}
      href={(page) =>
        typeof page == 'number' ? `?page=${page}` : `?cursor=${page}`}
      back={false}
    />
  </svelte:element>
</div>
