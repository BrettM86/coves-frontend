<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import {
    normalizeTimeframe,
    TIMEFRAME_OPTIONS,
    type CovesSortType,
    type CovesTimeframe,
  } from '$lib/api/coves/sort'
  import Menu from '$lib/ui/kit/popover/Menu.svelte'
  import MenuButton from '$lib/ui/kit/popover/MenuButton.svelte'
  import { Button, toast } from '$lib/ui/kit'
  import {
    Check,
    ChevronDown,
    Clock,
    Fire,
    Icon,
    Star,
    Trophy,
    type IconSource,
  } from '@xylightdev/svelte-hero-icons'

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

  let currentIcon = $derived(sortConfig[sort]?.icon ?? sortConfig.hot.icon)
  let currentLabel = $derived(
    $t(sortConfig[sort]?.labelKey ?? sortConfig.hot.labelKey),
  )

  /**
   * Navigates to the chosen sort, then saves it as the viewer's default.
   *
   * @param timeframeChosen whether the viewer picked this period, as opposed
   * to it being filled in so `sort=top` has one. Only a real choice is saved:
   * otherwise every click on Top would overwrite the saved period with
   * whatever happened to be on screen.
   */
  async function applySort(
    newSort: CovesSortType,
    newTimeframe: CovesTimeframe | undefined,
    timeframeChosen: boolean,
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
      toast({ content: t.get('toast.sortFailed'), type: 'error' })
      sort = prevSort
      timeframe = prevTimeframe
      return
    }

    // Saved only once the navigation lands: feed load()s read these when a URL
    // carries no sort of its own.
    settings.defaultSort.sort = newSort
    if (newSort === 'top' && timeframeChosen && newTimeframe) {
      settings.defaultSort.timeframe = newTimeframe
    }
  }

  function selectSort(newSort: CovesSortType): void {
    if (newSort !== 'top') {
      void applySort(newSort, undefined, false)
      return
    }
    // `sort=top` needs a period in the URL; reuse the one on screen, else the
    // viewer's saved default rather than a blanket 'all'.
    void applySort(
      'top',
      timeframe ?? normalizeTimeframe(settings.defaultSort.timeframe),
      false,
    )
  }

  function selectTimeframe(newTimeframe: CovesTimeframe): void {
    void applySort('top', newTimeframe, true)
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

  <MenuButton icon={Trophy} onclick={() => selectSort('top')}>
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
    {#each TIMEFRAME_OPTIONS as tf (tf.value)}
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
