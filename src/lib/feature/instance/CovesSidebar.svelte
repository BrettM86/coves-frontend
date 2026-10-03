<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import LilDude from '$lib/ui/generic/LilDude.svelte'
  import LabelStat from '$lib/ui/info/LabelStat.svelte'
  import EndPlaceholder from '$lib/ui/layout/EndPlaceholder.svelte'
  import SidebarButton from '$lib/ui/sidebar/SidebarButton.svelte'
  import { Spinner } from '$lib/ui/kit'
  import { onMount } from 'svelte'
  import { Building, CodeXml, Compass, Icon } from '$lib/ui/kit/icon'
  import type { ClassValue } from 'svelte/elements'
  import { siteStats } from './siteStats.svelte'

  interface Props {
    class?: ClassValue
  }

  let { class: clazz = '' }: Props = $props()

  let aside = $state<HTMLElement>()

  // Only once the sidebar is actually on screen: below the desktop breakpoint
  // it is display:none, and the profile menu mounts a copy that stays closed
  // until opened. A hidden element never intersects.
  onMount(() => {
    if (!aside) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void siteStats.fetch()
    })
    observer.observe(aside)
    return () => observer.disconnect()
  })

  // Brand glyphs from Simple Icons (CC0); Lucide ships no brand logos.
  const appStores = [
    {
      name: 'App Store',
      href: 'https://apps.apple.com/app/coves-social/id6758530907',
      path: 'M8.8086 14.9194l6.1107-11.0368c.0837-.1513.1682-.302.2437-.4584.0685-.142.1267-.2854.1646-.4403.0803-.3259.0588-.6656-.066-.9767-.1238-.3095-.3417-.5678-.6201-.7355a1.4175 1.4175 0 0 0-.921-.1924c-.3207.043-.6135.1935-.8443.4288-.1094.1118-.1996.2361-.2832.369-.092.1463-.175.2979-.259.4492l-.3864.6979-.3865-.6979c-.0837-.1515-.1667-.303-.2587-.4492-.0837-.1329-.1739-.2572-.2835-.369-.2305-.2353-.5233-.3857-.844-.429a1.4181 1.4181 0 0 0-.921.1926c-.2784.1677-.4964.426-.6203.7355-.1246.311-.1461.6508-.066.9767.038.155.0962.2984.1648.4403.0753.1564.1598.307.2437.4584l1.248 2.2543-4.8625 8.7825H2.0295c-.1676 0-.3351-.0007-.5026.0092-.1522.009-.3004.0284-.448.0714-.3108.0906-.5822.2798-.7783.548-.195.2665-.3006.5929-.3006.9279 0 .3352.1057.6612.3006.9277.196.2683.4675.4575.7782.548.1477.043.296.0623.4481.0715.1675.01.335.009.5026.009h13.0974c.0171-.0357.059-.1294.1-.2697.415-1.4151-.6156-2.843-2.0347-2.843zM3.113 18.5418l-.7922 1.5008c-.0818.1553-.1644.31-.2384.4705-.067.1458-.124.293-.1611.452-.0785.3346-.0576.6834.0645 1.0029.1212.3175.3346.583.607.7549.2727.172.5891.2416.9013.1975.3139-.044.6005-.1986.8263-.4402.1072-.1148.1954-.2424.2772-.3787.0902-.1503.1714-.3059.2535-.4612L6 19.4636c-.0896-.149-.9473-1.4704-2.887-.9218m20.5861-3.0056a1.4707 1.4707 0 0 0-.779-.5407c-.1476-.0425-.2961-.0616-.4483-.0705-.1678-.0099-.3352-.0091-.503-.0091H18.648l-4.3891-7.817c-.6655.7005-.9632 1.485-1.0773 2.1976-.1655 1.0333.0367 2.0934.546 3.0004l5.2741 9.3933c.084.1494.167.299.2591.4435.0837.131.1739.2537.2836.364.231.2323.5238.3809.8449.4232.3192.0424.643-.0244.9217-.1899.2784-.1653.4968-.4204.621-.7257.1246-.3072.146-.6425.0658-.9641-.0381-.1529-.0962-.2945-.165-.4346-.0753-.1543-.1598-.303-.2438-.4524l-1.216-2.1662h1.596c.1677 0 .3351.0009.5029-.009.1522-.009.3007-.028.4483-.0705a1.4707 1.4707 0 0 0 .779-.5407A1.5386 1.5386 0 0 0 24 16.452a1.539 1.539 0 0 0-.3009-.9158Z',
    },
    {
      name: 'Google Play',
      href: 'https://play.google.com/store/apps/details?id=social.coves',
      path: 'M22.018 13.298l-3.919 2.218-3.515-3.493 3.543-3.521 3.891 2.202a1.49 1.49 0 0 1 0 2.594zM1.337.924a1.486 1.486 0 0 0-.112.568v21.017c0 .217.045.419.124.6l11.155-11.087L1.337.924zm12.207 10.065l3.258-3.238L3.45.195a1.466 1.466 0 0 0-.946-.179l11.04 10.973zm0 2.067l-11 10.933c.298.036.612-.016.906-.183l13.324-7.54-3.23-3.21z',
    },
  ]
</script>

<aside
  bind:this={aside}
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
      icon={Compass}
    />
    <SidebarButton
      href="/community-guidelines"
      label="Community Guidelines"
      icon={Building}
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
  <nav
    aria-label="Instance links"
    class="flex flex-wrap items-center gap-1.5 px-3"
  >
    <a
      href="/privacy"
      data-sveltekit-reload
      class="py-1 underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-4"
    >
      Privacy
    </a>
    <span aria-hidden="true" class="text-slate-400 dark:text-zinc-500">·</span>
    <a
      href="/legal"
      class="py-1 underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-4"
    >
      Terms
    </a>
    <span aria-hidden="true" class="text-slate-400 dark:text-zinc-500">·</span>
    <span class="flex items-center -mx-1">
      <a
        href="https://tangled.org/bretton.dev/coves"
        aria-label="Coves source code on Tangled"
        title="Coves source code on Tangled"
        class="inline-flex items-center justify-center p-1 rounded-sm hover:text-slate-900 dark:hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        <Icon src={CodeXml} size="18" />
      </a>
      {#each appStores as store (store.name)}
        <a
          href={store.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Get Coves on ${store.name}`}
          title={`Get Coves on ${store.name}`}
          class="inline-flex items-center justify-center p-1 rounded-sm hover:text-slate-900 dark:hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d={store.path} />
          </svg>
        </a>
      {/each}
    </span>
  </nav>
</aside>
