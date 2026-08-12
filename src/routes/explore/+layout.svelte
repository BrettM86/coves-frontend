<script lang="ts">
  import { page } from '$app/state'
  import { t } from '$lib/app/i18n'
  import { searchParam } from '$lib/app/util.svelte'
  import { Header, SearchBar } from '$lib/ui/layout'
  import { Option, Select } from 'mono-svelte'
  import { untrack } from 'svelte'
  import {
    ChartBar,
    Fire,
    Icon,
    Language,
    Star,
    UserGroup,
  } from 'svelte-hero-icons/dist'

  let { data, children } = $props()

  // Navigating within /explore re-runs load() but reuses this layout, so a
  // lone one-time seed would leave the controls showing whatever the URL said
  // when the section was first entered. The URL stays the source of truth and
  // the effects below re-sync after a navigation that actually changes it.
  // Seeds are still needed because effects don't run during SSR — the
  // server-rendered first paint needs values; init reads are never reactive,
  // so untrack() marks them as deliberate one-time seeds and silences
  // state_referenced_locally.
  //
  // The latches are REQUIRED, not an optimisation. `page.data` is $state.raw,
  // which SvelteKit replaces wholesale on every navigation, and `data` arrives
  // through a freshly built object each load — so these effects re-run on every
  // navigation regardless of whether the value changed. SearchBar binds
  // straight into `search`, so an unguarded re-sync would erase whatever the
  // user had typed the moment the sort dropdown fired its `goto(...,
  // { invalidateAll: true })`. Only a change in the URL-derived value may
  // overwrite the local control. `lastQuery`/`lastSort` are plain `let`s, not
  // $state, so updating them here cannot re-trigger the effect.
  let search = $state(untrack(() => page.data.query || ''))
  let sort = $state(untrack(() => data.sort))

  let lastQuery = untrack(() => page.data.query || '')
  let lastSort = untrack(() => data.sort)

  $effect(() => {
    const query = page.data.query || ''
    if (query === lastQuery) return
    lastQuery = query
    search = query
  })

  $effect(() => {
    const routeSort = data.sort
    if (routeSort === lastSort) return
    lastSort = routeSort
    sort = routeSort
  })
</script>

<svelte:head>
  <title>{$t('routes.explore.title')}</title>
</svelte:head>

<Header pageHeader>
  {$t('routes.explore.title')}
  {#snippet extended()}
    {#if page.route.id == '/explore/communities'}
      <form method="get" action={page.url.pathname} class="contents">
        <SearchBar bind:query={search} />

        <div class="flex flex-row flex-wrap gap-4 items-center">
          <Select
            name="sort"
            bind:value={sort}
            onchange={() => searchParam(page.url, 'sort', sort)}
          >
            {#snippet customLabel()}
              <span class="flex items-center gap-1">
                <Icon src={ChartBar} size="13" micro />
                {$t('filter.sort.label')}
              </span>
            {/snippet}
            <Option value="popular" icon={Fire}>Popular</Option>
            <Option value="active" icon={UserGroup}>Active</Option>
            <Option value="new" icon={Star}>
              {$t('filter.sort.new')}
            </Option>
            <Option value="alphabetical" icon={Language}>A–Z</Option>
          </Select>
        </div>
      </form>
    {/if}
  {/snippet}
</Header>

{@render children?.()}
