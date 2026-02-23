<script lang="ts">
  import { page } from '$app/state'
  import { t } from '$lib/app/i18n'
  import { searchParam } from '$lib/app/util.svelte'
  import { Header, SearchBar } from '$lib/ui/layout'
  import { Option, Select } from 'mono-svelte'
  import {
    ChartBar,
    Fire,
    Icon,
    Language,
    Star,
    UserGroup,
  } from 'svelte-hero-icons/dist'

  let { data, children } = $props()

  let search = $state(page.data.query || '')
  let sort = $state(data.sort)
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
