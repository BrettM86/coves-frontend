<script lang="ts">
  import { browser } from '$app/environment'
  import { flushSync, tick } from 'svelte'
  import { slide } from 'svelte/transition'
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
  import { isSubscriptionPending } from '$lib/feature/community/subscription.svelte'
  import {
    isFavorite,
    isFavoritePending,
    orderSidebarCommunities,
    type ListedCommunity,
    subscribedCommunities,
    toggleFavorite,
  } from '$lib/feature/community/subscribed-communities.svelte'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import AnimatedStar from '$lib/ui/icon/AnimatedStar.svelte'
  import { toast } from '$lib/ui/kit'
  import { ChevronDown, GripVertical, Icon } from '$lib/ui/kit/icon'
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

  type ReleaseCue = 'immediate' | 'focus' | 'burst'
  /**
   * A just-starred row kept where it was, in its old group, until its release
   * cue. The position is within that group, so a refetch can't carry the row
   * into the other group's rows.
   */
  let hold = $state.raw<{
    did: DID
    group: Group
    index: number
    cue: ReleaseCue
    previousOrder: DID[]
    afterMove: DID[]
  }>()
  let pressedPointer: string | undefined

  let rows = $derived.by(() => {
    const listed = (group: Group) =>
      groups[group].map((community) => ({ community, group }))
    const favorites = listed('favorites')
    const others = listed('others')
    const held = hold
    const row = held
      ? [...favorites, ...others].find((row) => row.community.did === held.did)
      : undefined
    if (!held || !row) return [...favorites, ...others]
    const without = (rows: typeof favorites) =>
      rows.filter((row) => row.community.did !== held.did)
    const settled = { favorites: without(favorites), others: without(others) }
    const target = settled[held.group]
    target.splice(Math.min(held.index, target.length), 0, {
      ...row,
      group: held.group,
    })
    return [...settled.favorites, ...settled.others]
  })

  /**
   * Lets a held row move to its group. Reordering the list can drop focus
   * from a row that moved, so focus goes back to the element that had it, or
   * for a focus cue to the element focus is moving to.
   */
  function release(did: DID, cue: ReleaseCue, next?: EventTarget | null): void {
    if (hold?.did !== did || hold.cue !== cue) return
    const tile = list?.querySelector<HTMLElement>(
      `[data-row-did="${did}"] > .tile`,
    )
    if (!tile) {
      hold = undefined
      return
    }
    const top = tile.getBoundingClientRect().top
    // A focusout passes where focus is going (null when it leaves the page).
    const focused = next === undefined ? document.activeElement : next
    moveTiles(undefined, tile, () => {
      hold = undefined
    })
    keepFocus(focused)
    if (motionEnabled() && tile.getBoundingClientRect().top !== top) {
      tile.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 150,
        easing: 'ease-out',
      })
    }
  }

  /** Puts focus back on an element in the list that a reorder dropped it from. */
  function keepFocus(element: EventTarget | null): void {
    if (
      element instanceof HTMLElement &&
      list?.contains(element) &&
      document.activeElement === document.body
    ) {
      element.focus({ preventScroll: true })
    }
  }

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

  // The li is the stationary hit target and drop slot. Only its tile moves.
  function motionEnabled(): boolean {
    return (
      typeof Element.prototype.animate === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  }

  function moveTiles(
    group: Group | undefined,
    held: HTMLElement,
    update: () => void,
  ): void {
    if (!motionEnabled()) {
      flushSync(update)
      return
    }
    const neighbors = Array.from(
      list?.querySelectorAll<HTMLElement>(
        group
          ? `[data-row-group="${group}"] > .tile`
          : '[data-row-group] > .tile',
      ) ?? [],
    ).filter((tile) => tile !== held)
    const tops = neighbors.map((tile) => tile.getBoundingClientRect().top)
    flushSync(update)
    neighbors.forEach((tile, index) => {
      const slot = tile.parentElement
      if (!slot) return
      const offset = tops[index] - slot.getBoundingClientRect().top
      if (offset) {
        tile.getAnimations?.().forEach((animation) => animation.cancel())
        tile.animate(
          [{ transform: `translateY(${offset}px)` }, { transform: 'none' }],
          {
            duration: 140,
            easing: 'ease-out',
          },
        )
      }
    })
  }

  function landTile(tile: HTMLElement, offset: number): void {
    if (!motionEnabled()) return
    tile.getAnimations?.().forEach((animation) => animation.cancel())
    tile.animate(
      [
        {
          transform: `translateY(${offset}px) scale(1.02)`,
          boxShadow: '0 4px 10px #0003',
        },
        { transform: 'scale(1.006, .97)', offset: 0.75 },
        { transform: 'none', boxShadow: 'none' },
      ],
      { duration: 160, easing: 'ease-out' },
    )
  }

  function onHandleKey(
    community: ListedCommunity,
    group: Group,
    event: KeyboardEvent,
  ): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    if (hold) {
      release(hold.did, hold.cue)
      group = isFavorite(community) ? 'favorites' : 'others'
    }
    const order = dids(group)
    const from = order.indexOf(community.did)
    const to = from + (event.key === 'ArrowUp' ? -1 : 1)
    if (from < 0 || to < 0 || to >= order.length) return
    const tile = (event.currentTarget as HTMLElement).closest<HTMLElement>(
      '.tile',
    )
    const slot = tile?.parentElement
    if (!tile || !slot || drag) return
    const top = tile.getBoundingClientRect().top
    moveTiles(group, tile, () =>
      saveGroup(group, reorderGroup(order, from, to)),
    )
    landTile(tile, top - slot.getBoundingClientRect().top)
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
    if (hold) {
      release(hold.did, hold.cue)
      group = isFavorite(community) ? 'favorites' : 'others'
    }
    const tile = (event.currentTarget as HTMLElement).closest<HTMLElement>(
      '.tile',
    )
    const slot = tile?.parentElement
    if (!tile || !slot) return
    tile.getAnimations?.().forEach((animation) => animation.cancel())
    const grabOffset = event.clientY - slot.getBoundingClientRect().top
    const pointerId = event.pointerId
    const startOrder = dids(group)
    drag = { did: community.did, group, preview: startOrder }

    const stop = (): void => {
      document.removeEventListener('pointermove', onmove)
      document.removeEventListener('pointerup', onend)
      document.removeEventListener('pointercancel', onend)
      document.removeEventListener('keydown', onkey)
      tile.style.removeProperty('--carry-y')
      cancelDrag = undefined
      drag = undefined
    }

    function onkey(key: KeyboardEvent): void {
      if (key.key !== 'Escape') return
      // The Escape belongs to the drag, not to a dialog behind it.
      key.preventDefault()
      key.stopPropagation()
      stop()
    }

    const onmove = (move: PointerEvent): void => {
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
      if (from !== target) {
        const preview = reorderGroup(drag.preview, from, target)
        moveTiles(group, tile, () => {
          drag = { did: community.did, group, preview }
        })
      }
      const offset =
        move.clientY - grabOffset - slot.getBoundingClientRect().top
      tile.style.setProperty('--carry-y', `${offset}px`)
    }

    const onend = (end: PointerEvent): void => {
      if (end.pointerId !== pointerId) return
      const finished = drag
      const offset =
        Number.parseFloat(tile.style.getPropertyValue('--carry-y')) || 0
      const unmoved = finished?.preview.every(
        (did, index) => did === startOrder[index],
      )
      stop()
      if (finished === undefined || end.type === 'pointercancel') return
      // A press without a move changes nothing, so save nothing: saving
      // would pin unordered rows that should keep sorting A–Z.
      if (unmoved) return
      saveGroup(group, finished.preview)
      flushSync()
      landTile(tile, offset)
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
  // switching account or leaving the page drops it unsaved, and settles any
  // held row.
  $effect(() => {
    void owner
    void settings.expand.communities
    return () => {
      cancelDrag?.()
      hold = undefined
      pressedPointer = undefined
    }
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
    if (star) star.focus({ preventScroll: true })
    else if (orHeader) header?.focus({ preventScroll: true })
  }

  async function onStar(
    community: ListedCommunity,
    event: MouseEvent,
  ): Promise<void> {
    const button = event.currentTarget as HTMLButtonElement
    const pointer = (event as PointerEvent).pointerType || pressedPointer
    pressedPointer = undefined
    // A subscribe or unsubscribe in flight refuses the star; don't move it.
    if (isFavoritePending(community) || isSubscriptionPending(community)) return
    // Starring sends the row to the end of the other group.
    // Another row still held settles first, so this one is measured where
    // it really is.
    if (hold && hold.did !== community.did) release(hold.did, hold.cue)
    const startOwner = owner
    const wasFavorite = isFavorite(community)
    const previousOrder = communityOrder.order
    const existing = hold?.did === community.did ? hold : undefined
    const group = existing?.group ?? (wasFavorite ? 'favorites' : 'others')
    const index = rows
      .filter((row) => row.group === group)
      .findIndex((row) => row.community.did === community.did)
    const afterMove =
      existing && (existing.group === 'favorites') !== wasFavorite
        ? undoMove(
            previousOrder,
            community.did,
            existing.previousOrder,
            existing.afterMove,
          )
        : orderWithMovedToEnd(
            dids('favorites'),
            dids('others'),
            community.did,
            wasFavorite ? 'others' : 'favorites',
          )
    let cue: ReleaseCue | undefined
    if (pointer || event.detail) {
      const playsBurst =
        !wasFavorite &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      cue = playsBurst ? 'burst' : 'immediate'
    } else if (button === document.activeElement) {
      cue = 'focus'
    }
    hold = cue
      ? {
          did: community.did,
          group,
          index,
          previousOrder: existing?.previousOrder ?? previousOrder,
          afterMove,
          cue,
        }
      : undefined
    communityOrder.save(afterMove)
    const request = toggleFavorite(community, coves())
    if (cue === 'immediate') release(community.did, cue)
    // The store puts a failed star back before the request settles, and that
    // reorder can drop focus before this function resumes.
    const starHadFocus = document.activeElement === button
    const outcome = await request
    // The row stayed in its group (failed, refused, or the server kept the
    // old value): put back only this move, and only for the same account.
    const stayed = outcome.kind !== 'ok' || outcome.favorite === wasFavorite
    // A request from the previous account says nothing to this one.
    if (owner !== startOwner) return
    if (stayed) {
      const focused =
        starHadFocus && document.activeElement === document.body
          ? button
          : document.activeElement
      flushSync(() => {
        if (hold?.did === community.did) hold = undefined
        communityOrder.save(
          undoMove(
            communityOrder.order,
            community.did,
            previousOrder,
            afterMove,
          ),
        )
      })
      keepFocus(focused)
    }
    if (outcome.kind === 'conflict') {
      // Changed or removed from another tab or device: show what is stored now.
      const restoreFocus = document.activeElement === button
      await reload()
      // Signed out or switched mid-refetch: nothing here is about this viewer.
      if (owner !== startOwner) return
      // A failed refetch shows its own error row with Retry.
      if (subscribedCommunities.status === 'loaded') {
        toast({
          content: $t('nav.sidebarCommunities.conflict'),
          type: 'warning',
        })
      }
      if (restoreFocus && document.activeElement === document.body)
        await refocusStar(community.did, true)
      return
    }
    if (outcome.kind !== 'error') return
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
    class="relative rounded-xl"
    class:slot={dragging}
    data-row-did={community.did}
    data-row-group={group}
    onfocusout={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
        release(community.did, 'focus', event.relatedTarget)
    }}
  >
    <div
      class={[
        'tile group flex flex-row items-center gap-1 rounded-xl',
        dragging && 'held bg-slate-100 dark:bg-zinc-800',
      ]}
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
        aria-disabled={isFavoritePending(community) ||
          isSubscriptionPending(community)}
        onpointerdown={(event) => (pressedPointer = event.pointerType)}
        onpointercancel={() => (pressedPointer = undefined)}
        onkeydown={() => (pressedPointer = undefined)}
        onclick={(event) => onStar(community, event)}
      >
        <AnimatedStar
          starred={favorite}
          onburstend={() => release(community.did, 'burst')}
        />
      </button>
    </div>
  </li>
{/snippet}

{#if owner !== undefined}
  <section class="flex flex-col mt-2">
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
          'motion-safe:transition-transform',
          settings.expand.communities
            ? 'rotate-180 motion-safe:duration-[180ms] ease-out'
            : 'motion-safe:duration-[140ms] ease-in',
        ]}
      />
    </button>
    {#if settings.expand.communities}
      <ul
        id="sidebar-communities"
        class="mt-1 flex flex-col gap-1 [overflow-anchor:none]"
        bind:this={list}
        transition:slide={{
          duration: motionEnabled()
            ? settings.expand.communities
              ? 180
              : 140
            : 0,
        }}
      >
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

<style>
  .slot {
    background: rgb(128 128 128 / 9%);
    z-index: 1;
  }
  .held {
    transition:
      scale 90ms ease-out,
      box-shadow 90ms ease-out;
    transform: translateY(var(--carry-y, 0px));
    scale: 1.02;
    box-shadow: 0 4px 10px #0003;
  }
  @media (prefers-reduced-motion: reduce) {
    .held {
      transition: none;
      transform: none;
      scale: none;
      box-shadow: none;
    }
  }
</style>
