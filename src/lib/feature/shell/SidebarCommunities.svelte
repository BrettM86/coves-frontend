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
  import {
    applySavedOrder,
    communityOrder,
    orderWithMovedToEnd,
    reorderGroup,
    undoMove,
  } from '$lib/feature/community/community-order.svelte'
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
  import { ChevronDown, GripVertical, Icon, Star } from '$lib/ui/kit/icon'
  import SidebarButton from '$lib/ui/sidebar/SidebarButton.svelte'
  import type { DID } from '$lib/types/atproto'

  // The list is per viewer and never part of the server render: it loads on
  // the client once the signed-in DID is known and again when it changes.
  let owner = $derived(
    profile.current.type === 'authenticated' ? profile.current.did : undefined,
  )

  $effect(() => {
    if (!browser) return
    if (owner === undefined) {
      subscribedCommunities.reset()
      communityOrder.reset()
    } else if (subscribedCommunities.owner !== owner) {
      communityOrder.load(owner)
      void subscribedCommunities.load(coves(), owner)
    }
  })

  type Group = 'favorites' | 'others'

  /** A drag in progress: the row, its group, and the group's order so far. */
  let drag = $state<{ did: DID; group: Group; preview: DID[] }>()

  // Favorites first, then the rest; each group in the viewer's saved order,
  // with rows that have no saved position after it, A–Z.
  let groups = $derived.by(() => {
    const sorted = orderSidebarCommunities(
      subscribedCommunities.communities,
      isFavorite,
    )
    const favorites = applySavedOrder(sorted.favorites, communityOrder.order)
    const others = applySavedOrder(sorted.others, communityOrder.order)
    if (drag === undefined) return { favorites, others }
    const { group, preview } = drag
    const byDid = new Map(
      (group === 'favorites' ? favorites : others).map((c) => [c.did, c]),
    )
    const previewed = preview.flatMap((did) => byDid.get(did) ?? [])
    // A community that joined the group mid-drag stays visible, at the end.
    for (const community of byDid.values()) {
      if (!preview.includes(community.did)) previewed.push(community)
    }
    return group === 'favorites'
      ? { favorites: previewed, others }
      : { favorites, others: previewed }
  })

  let rows = $derived([
    ...groups.favorites.map((community) => ({
      community,
      group: 'favorites' as const,
    })),
    ...groups.others.map((community) => ({
      community,
      group: 'others' as const,
    })),
  ])

  let announcement = $state('')

  function dids(group: Group): DID[] {
    return groups[group].map((community) => community.did)
  }

  function saveGroup(group: Group, order: DID[]): void {
    communityOrder.save(
      group === 'favorites'
        ? [...order, ...dids('others')]
        : [...dids('favorites'), ...order],
    )
  }

  function announceMove(community: ListedCommunity, group: Group): void {
    const order = dids(group)
    announcement = $t('nav.sidebarCommunities.moved', {
      default: communityAddress(community),
      position: order.indexOf(community.did) + 1,
      count: order.length,
    })
  }

  async function refocusHandle(did: string): Promise<void> {
    await tick()
    list
      ?.querySelector<HTMLButtonElement>(`[data-reorder-did="${did}"]`)
      ?.focus()
  }

  function onHandleKey(
    community: ListedCommunity,
    group: Group,
    event: KeyboardEvent,
  ): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const order = dids(group)
    const from = order.indexOf(community.did)
    const to = from + (event.key === 'ArrowUp' ? -1 : 1)
    if (from < 0 || to < 0 || to >= order.length) return
    saveGroup(group, reorderGroup(order, from, to))
    announceMove(community, group)
    void refocusHandle(community.did)
  }

  /**
   * Pointer drag on the handle (mouse, pen and touch). Moves are tracked on
   * the document: the row is re-inserted as it moves, which would drop a
   * pointer capture held by the handle itself.
   */
  function onHandleDown(
    community: ListedCommunity,
    group: Group,
    event: PointerEvent,
  ): void {
    if (event.button !== 0 || drag !== undefined) return
    event.preventDefault()
    const pointerId = event.pointerId
    drag = { did: community.did, group, preview: dids(group) }

    function stop(): void {
      document.removeEventListener('pointermove', onmove)
      document.removeEventListener('pointerup', onend)
      document.removeEventListener('pointercancel', onend)
      document.removeEventListener('keydown', onkey)
      cancelDrag = undefined
      drag = undefined
    }

    function onkey(key: KeyboardEvent): void {
      if (key.key === 'Escape') stop()
    }

    function onmove(move: PointerEvent): void {
      if (move.pointerId !== pointerId || drag === undefined || !list) return
      // A mouse released outside the window sends no pointerup.
      if (move.pointerType === 'mouse' && move.buttons === 0) {
        stop()
        return
      }
      const rows = [
        ...list.querySelectorAll<HTMLElement>(`[data-row-group="${group}"]`),
      ].filter((row) => row.dataset.rowDid !== community.did)
      const target = rows.filter((row) => {
        const box = row.getBoundingClientRect()
        return box.top + box.height / 2 < move.clientY
      }).length
      const from = drag.preview.indexOf(community.did)
      if (from === target) return
      drag = { ...drag, preview: reorderGroup(drag.preview, from, target) }
    }

    function onend(end: PointerEvent): void {
      if (end.pointerId !== pointerId) return
      const finished = drag
      stop()
      if (finished === undefined || end.type === 'pointercancel') return
      saveGroup(group, finished.preview)
      announceMove(community, group)
    }

    cancelDrag = stop
    document.addEventListener('pointermove', onmove)
    document.addEventListener('pointerup', onend)
    document.addEventListener('pointercancel', onend)
    document.addEventListener('keydown', onkey)
  }

  /** Ends a drag without saving; set while one is in progress. */
  let cancelDrag: (() => void) | undefined

  // A drag never outlives the list it started in: collapsing the section,
  // switching account or leaving the page drops it unsaved.
  $effect(() => {
    void owner
    void settings.expand.communities
    return () => cancelDrag?.()
  })

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
    // Starring sends the row to the end of the other group.
    const startOwner = owner
    const wasFavorite = isFavorite(community)
    const previousOrder = communityOrder.order
    let afterMove: DID[] | undefined
    if (!isFavoritePending(community)) {
      afterMove = orderWithMovedToEnd(
        dids('favorites'),
        dids('others'),
        community.did,
        wasFavorite ? 'others' : 'favorites',
      )
      communityOrder.save(afterMove)
    }
    const run = toggleFavorite(community, coves())
    if (hadFocus) await refocusStar(community.did)
    const outcome = await run
    // The row stayed in its group (failed, refused, or the server kept the
    // old value): put back only this move, and only for the same account.
    const stayed = outcome.kind !== 'ok' || outcome.favorite === wasFavorite
    if (stayed && afterMove !== undefined && owner === startOwner) {
      communityOrder.save(
        undoMove(communityOrder.order, community.did, previousOrder, afterMove),
      )
    }
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

{#snippet row(community: ListedCommunity, group: Group)}
  {@const favorite = isFavorite(community)}
  {@const address = communityAddress(community)}
  {@const dragging = drag?.did === community.did}
  <li
    class={[
      'group flex flex-row items-center gap-1 rounded-xl',
      dragging && 'bg-slate-200/70 dark:bg-zinc-800/70 shadow-sm',
    ]}
    data-row-did={community.did}
    data-row-group={group}
  >
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
        'shrink-0 p-1 rounded-full touch-none cursor-grab active:cursor-grabbing',
        'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-200',
        'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
        dragging && 'opacity-100',
      ]}
      data-reorder-did={community.did}
      aria-label={$t('nav.sidebarCommunities.reorder', { default: address })}
      title={$t('nav.sidebarCommunities.reorder', { default: address })}
      onpointerdown={(event) => onHandleDown(community, group, event)}
      onkeydown={(event) => onHandleKey(community, group, event)}
    >
      <Icon src={GripVertical} size="16" />
    </button>
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
        <!-- One keyed list, so a row that changes group is moved, not rebuilt. -->
        {#each rows as { community, group } (community.did)}
          {@render row(community, group)}
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
    <div class="sr-only" aria-live="polite">{announcement}</div>
  </section>
{/if}
