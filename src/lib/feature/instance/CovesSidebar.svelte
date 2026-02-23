<script lang="ts">
  import { t } from '$lib/app/i18n'
  import LilDude from '$lib/ui/generic/LilDude.svelte'
  import LabelStat from '$lib/ui/info/LabelStat.svelte'
  import EndPlaceholder from '$lib/ui/layout/EndPlaceholder.svelte'
  import SidebarButton from '$lib/ui/sidebar/SidebarButton.svelte'
  import { Spinner } from 'mono-svelte'
  import { onMount } from 'svelte'
  import { BuildingOffice, GlobeAlt } from 'svelte-hero-icons/dist'
  import type { ClassValue } from 'svelte/elements'
  import { siteStats } from './siteStats.svelte'

  interface Props {
    class?: ClassValue
  }

  let { class: clazz = '' }: Props = $props()

  onMount(() => {
    siteStats.fetch().catch(() => {})
  })
</script>

<aside
  class={[
    'w-full text-slate-600 dark:text-zinc-400 flex flex-col gap-4 text-sm',
    clazz,
  ]}
>
  <div class="flex flex-col items-center gap-3 pt-2">
    <LilDude width={80} />
    <div class="text-center">
      <h2 class="text-lg font-semibold text-slate-900 dark:text-zinc-100">
        Coves
      </h2>
      <p class="text-xs text-slate-500 dark:text-zinc-500">
        Community forums on the atmosphere
      </p>
    </div>
  </div>

  <div class="flex flex-col gap-1">
    <SidebarButton
      href="/explore/communities"
      label={$t('routes.explore.title')}
      icon={GlobeAlt}
    />
    <SidebarButton
      href="/legal"
      label="Community Guidelines"
      icon={BuildingOffice}
    />

    {#if siteStats.data || siteStats.loading}
      <EndPlaceholder size="xs" margin="sm">
        {$t('cards.site.stats')}
      </EndPlaceholder>
      {#if siteStats.data}
        <div class="flex flex-row gap-4 flex-wrap px-3">
          <LabelStat
            label={$t('content.communities')}
            content={siteStats.data.communities.toString()}
            formatted
          />
          <LabelStat
            label={$t('content.posts')}
            content={siteStats.data.posts.toString()}
            formatted
          />
          <LabelStat
            label="Subscribers"
            content={siteStats.data.subscribers.toString()}
            formatted
          />
          <LabelStat
            label="Members"
            content={siteStats.data.members.toString()}
            formatted
          />
        </div>
      {:else if siteStats.loading}
        <div class="flex justify-center py-4">
          <Spinner width={20} />
        </div>
      {/if}
    {/if}
  </div>
</aside>
