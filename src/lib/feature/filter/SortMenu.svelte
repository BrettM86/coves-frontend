<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { t } from '$lib/app/i18n'
  import type { CovesSortType, CovesTimeframe } from '$lib/app/sort'
  import Menu from '$lib/ui/shared/popover/Menu.svelte'
  import MenuButton from '$lib/ui/shared/popover/MenuButton.svelte'
  import { Button } from 'mono-svelte'
  import {
    Check,
    ChevronDown,
    Clock,
    Fire,
    Icon,
    Star,
    Trophy,
    type IconSource,
  } from 'svelte-hero-icons/dist'

  interface Props {
    sort: CovesSortType
    timeframe?: CovesTimeframe
    class?: string
  }

  let {
    sort = $bindable(),
    timeframe = $bindable(),
    class: clazz = '',
  }: Props = $props()

  let menuOpen = $state(false)

  const sortConfig: Record<
    CovesSortType,
    { icon: IconSource; labelKey: string }
  > = {
    hot: { icon: Fire, labelKey: 'filter.sort.hot' },
    top: { icon: Trophy, labelKey: 'filter.sort.top.label' },
    new: { icon: Star, labelKey: 'filter.sort.new' },
  }

  const timeframeConfig: {
    value: CovesTimeframe
    labelKey: string
  }[] = [
    { value: 'day', labelKey: 'filter.sort.top.time.day' },
    { value: 'week', labelKey: 'filter.sort.top.time.week' },
    { value: 'month', labelKey: 'filter.sort.top.time.month' },
    { value: 'all', labelKey: 'filter.sort.top.time.all' },
  ]

  let currentIcon = $derived(sortConfig[sort]?.icon ?? sortConfig.hot.icon)
  let currentLabel = $derived(
    $t(sortConfig[sort]?.labelKey ?? sortConfig.hot.labelKey),
  )

  async function selectSort(
    newSort: CovesSortType,
    newTimeframe?: CovesTimeframe,
  ): Promise<void> {
    const url = new URL(page.url)
    url.searchParams.set('sort', newSort)
    if (newSort === 'top' && newTimeframe) {
      url.searchParams.set('timeframe', newTimeframe)
    } else {
      url.searchParams.delete('timeframe')
    }
    url.searchParams.delete('cursor')
    url.searchParams.delete('page')

    const prevSort = sort
    const prevTimeframe = timeframe

    sort = newSort
    timeframe = newSort === 'top' ? (newTimeframe ?? 'all') : undefined
    menuOpen = false

    try {
      await goto(url, { invalidateAll: true })
    } catch (err) {
      console.error('[SortMenu] Navigation failed:', err)
      sort = prevSort
      timeframe = prevTimeframe
    }
  }

  function selectTimeframe(newTimeframe: CovesTimeframe): void {
    selectSort('top', newTimeframe)
  }
</script>

<Menu bind:open={menuOpen}>
  {#snippet target(attachment)}
    <Button
      {@attach attachment}
      color="secondary"
      size="sm"
      class={['gap-1.5', clazz]}
    >
      <Icon src={currentIcon} size="16" micro />
      {currentLabel}
      <Icon src={ChevronDown} size="14" micro />
    </Button>
  {/snippet}

  <MenuButton icon={Fire} onclick={() => selectSort('hot')}>
    {$t('filter.sort.hot')}
    {#snippet suffix()}
      {#if sort === 'hot'}
        <Icon
          src={Check}
          size="16"
          micro
          class="ml-auto text-primary-900 dark:text-primary-100"
        />
      {/if}
    {/snippet}
  </MenuButton>

  <MenuButton
    icon={Trophy}
    onclick={() => selectSort('top', timeframe ?? 'all')}
  >
    {$t('filter.sort.top.label')}
    {#snippet suffix()}
      {#if sort === 'top'}
        <Icon
          src={Check}
          size="16"
          micro
          class="ml-auto text-primary-900 dark:text-primary-100"
        />
      {/if}
    {/snippet}
  </MenuButton>

  {#if sort === 'top'}
    {#each timeframeConfig as tf (tf.value)}
      <MenuButton
        icon={Clock}
        class="pl-4"
        onclick={() => selectTimeframe(tf.value)}
      >
        {$t(tf.labelKey)}
        {#snippet suffix()}
          {#if timeframe === tf.value}
            <Icon
              src={Check}
              size="16"
              micro
              class="ml-auto text-primary-900 dark:text-primary-100"
            />
          {/if}
        {/snippet}
      </MenuButton>
    {/each}
  {/if}

  <MenuButton icon={Star} onclick={() => selectSort('new')}>
    {$t('filter.sort.new')}
    {#snippet suffix()}
      {#if sort === 'new'}
        <Icon
          src={Check}
          size="16"
          micro
          class="ml-auto text-primary-900 dark:text-primary-100"
        />
      {/if}
    {/snippet}
  </MenuButton>
</Menu>
