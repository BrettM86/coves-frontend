<script lang="ts">
  import { browser } from '$app/environment'
  import { tick } from 'svelte'
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import { communityAddress } from '$lib/app/util/community'
  import { errorMessage } from '$lib/app/util/error'
  import { isExpiredSessionError } from '$lib/app/util/session-expired-error'
  import { communityIdentifier } from '$lib/feature/community/helpers'
  import {
    isFavorite,
    isFavoritePending,
    orderSidebarCommunities,
    type ListedCommunity,
    subscribedCommunities,
    toggleFavorite,
  } from '$lib/feature/community/subscribed-communities.svelte'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import { toast } from '$lib/ui/kit'
  import { ChevronDown, Icon, Settings, Star } from '$lib/ui/kit/icon'
  import SidebarButton from '$lib/ui/sidebar/SidebarButton.svelte'

  // The list is per viewer and never part of the server render: it loads on
  // the client once the signed-in DID is known and again when it changes.
  let owner = $derived(
    profile.current.type === 'authenticated' ? profile.current.did : undefined,
  )

  $effect(() => {
    if (!browser) return
    if (owner === undefined) {
      subscribedCommunities.reset()
    } else if (subscribedCommunities.owner !== owner) {
      void subscribedCommunities.load(coves(), owner)
    }
  })

  let ordered = $derived(
    orderSidebarCommunities(subscribedCommunities.communities, isFavorite),
  )

  let list = $state<HTMLElement>()
  let header = $state<HTMLButtonElement>()

  /**
   * Starring moves the row between groups, and a moved node loses focus;
   * put keyboard focus back on the same star.
   */
  async function refocusStar(did: string, orHeader = false): Promise<void> {
    await tick()
    const star = list?.querySelector<HTMLButtonElement>(
      `[data-favorite-did="${did}"]`,
    )
    // A refetch can remove the row; keep focus inside the section.
    if (star) star.focus()
    else if (orHeader) header?.focus()
  }

  async function onStar(
    community: ListedCommunity,
    event: MouseEvent,
  ): Promise<void> {
    const hadFocus = event.currentTarget === document.activeElement
    const run = toggleFavorite(community, coves())
    if (hadFocus) await refocusStar(community.did)
    const outcome = await run
    if (outcome.kind === 'conflict') {
      // Changed or removed from another tab or device: show what is stored now.
      toast({ content: $t('nav.sidebarCommunities.conflict'), type: 'warning' })
      await reload()
      if (hadFocus) await refocusStar(community.did, true)
      return
    }
    if (outcome.kind !== 'error') return
    if (hadFocus) await refocusStar(community.did)
    if (isExpiredSessionError(outcome.error) && profile.sessionExpired) return
    toast({ content: errorMessage(outcome.error), type: 'error' })
  }

  async function reload(): Promise<void> {
    if (owner !== undefined) await subscribedCommunities.load(coves(), owner)
  }

  function retry(): void {
    void reload()
  }
</script>

{#snippet row(community: ListedCommunity)}
  {@const favorite = isFavorite(community)}
  {@const address = communityAddress(community)}
  <li class="flex flex-row items-center gap-1">
    <SidebarButton
      href="/c/{communityIdentifier(community)}"
      exact
      title={address}
      class="flex-1 min-w-0"
    >
      {#snippet customIcon()}
        <Avatar url={community.avatar} alt="" width={24} class="shrink-0" />
      {/snippet}
      <span class="truncate">{community.name}</span>
    </SidebarButton>
    <button
      type="button"
      class={[
        'shrink-0 p-2 rounded-full transition-colors cursor-pointer',
        'hover:bg-slate-200/50 dark:hover:bg-zinc-800/50',
        favorite
          ? 'text-slate-700 dark:text-zinc-200'
          : 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-200',
      ]}
      data-favorite-did={community.did}
      aria-pressed={favorite}
      aria-label={$t('nav.sidebarCommunities.favorite', { default: address })}
      title={$t('nav.sidebarCommunities.favorite', { default: address })}
      aria-disabled={isFavoritePending(community)}
      onclick={(event) => onStar(community, event)}
    >
      <Icon src={Star} size="16" class={[favorite && 'fill-current']} />
    </button>
  </li>
{/snippet}

{#if owner !== undefined}
  <section class="flex flex-col gap-1 mt-2">
    <button
      type="button"
      class={[
        'flex flex-row items-center justify-between px-3 py-2 rounded-xl cursor-pointer',
        'text-xs font-semibold uppercase tracking-wider',
        'text-slate-500 dark:text-zinc-400 hover:bg-slate-200/50 dark:hover:bg-zinc-800/50',
      ]}
      bind:this={header}
      aria-expanded={settings.expand.communities}
      aria-controls="sidebar-communities"
      onclick={() =>
        (settings.expand.communities = !settings.expand.communities)}
    >
      {$t('nav.communities')}
      <Icon
        src={ChevronDown}
        size="16"
        class={[
          'transition-transform duration-200',
          settings.expand.communities && 'rotate-180',
        ]}
      />
    </button>
    {#if settings.expand.communities}
      <ul id="sidebar-communities" class="flex flex-col gap-1" bind:this={list}>
        <li>
          <SidebarButton
            href="/explore/communities"
            label={$t('nav.sidebarCommunities.manage')}
            icon={Settings}
            class="w-full"
          />
        </li>
        {#each [...ordered.favorites, ...ordered.others] as community (community.did)}
          {@render row(community)}
        {/each}
        {#if subscribedCommunities.status === 'error'}
          <li
            class="flex flex-row items-center gap-2 px-3 py-2 text-sm text-slate-500 dark:text-zinc-400"
          >
            {$t('nav.sidebarCommunities.error')}
            <button
              type="button"
              class="underline cursor-pointer hover:text-slate-900 dark:hover:text-zinc-50"
              onclick={retry}
            >
              {$t('nav.sidebarCommunities.retry')}
            </button>
          </li>
        {:else if subscribedCommunities.status === 'loaded' && subscribedCommunities.communities.length === 0}
          <li class="px-3 py-2 text-sm text-slate-500 dark:text-zinc-400">
            {$t('nav.sidebarCommunities.empty')}
          </li>
        {/if}
      </ul>
    {/if}
  </section>
{/if}
