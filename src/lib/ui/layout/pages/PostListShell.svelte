<script lang="ts">
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import type { FeedPaginationParams, FeedViewPost } from '$lib/api/coves/types'
  import type { SortType } from '$lib/api/types'
  import { settings } from '$lib/app/settings.svelte'
  import Sort from '$lib/feature/filter/Sort.svelte'
  import ViewSelect from '$lib/feature/filter/ViewSelect.svelte'
  import PostFeed from '$lib/feature/post/feed/PostFeed.svelte'
  import VirtualFeed from '$lib/feature/post/feed/VirtualFeed.svelte'
  import { Button } from 'mono-svelte'
  import type { Snippet } from 'svelte'
  import { ArrowRight, Icon } from 'svelte-hero-icons/dist'
  import { Header, Pageination } from '..'

  interface Props {
    posts: FeedViewPost[]
    cursor?: string
    params: {
      sort?: string
    }
    title?: string
    extended?: Snippet
    getParams: FeedPaginationParams | Record<string, unknown>
    header?: boolean
  }

  let {
    params,
    posts = $bindable(),
    cursor = $bindable(),
    title,
    extended: passedExtended,
    getParams,
    header = true,
  }: Props = $props()

  $effect(() => {
    if (filters.sort) settings.defaultSort.sort = filters.sort as SortType
  })

  let filters = $state({
    sort: params.sort,
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
        <form class="" method="get" action={page.url.pathname}>
          <div class="flex flex-row gap-2">
            {#if filters.sort}
              <Sort
                placement="bottom"
                name="sort"
                navigate
                bind:selected={filters.sort}
              />
            {/if}
            <ViewSelect placement="bottom" />

            <noscript>
              <Button
                class="self-end h-[34px] aspect-square"
                size="custom"
                submit
              >
                <Icon src={ArrowRight} size="16" micro />
              </Button>
            </noscript>
          </div>
        </form>
      {/snippet}
    </Header>
  {/if}

  <FeedComponent bind:posts bind:params={getParams} />
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
