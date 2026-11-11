<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { page } from '$app/state'
  import { flushSync, tick } from 'svelte'
  import { coves } from '$lib/api/client.svelte'
  import type {
    BlueskyProfileImportField,
    BlueskyProfileImportFieldName,
    BlueskyProfileImportKnownField as KnownField,
    ImportBlueskyProfileOutput,
  } from '$lib/api/coves/types'
  import { XrpcError } from '$lib/api/coves/xrpc'
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { errorMessage } from '$lib/app/util/error'
  import { isExpiredSessionError } from '$lib/app/util/session-expired-error'
  import { dismissBlueskyProfileImport } from '$lib/feature/bluesky-import/dismiss'
  import { feeds } from '$lib/feature/feeds/feed.svelte'
  import BlueskyButterfly from '$lib/feature/post/media/BlueskyButterfly.svelte'
  import covesMascotUrl from '$lib/assets/lil_dude.svg'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import Blobs from '$lib/ui/generic/Blobs.svelte'
  import { Button, Modal, toast } from '$lib/ui/kit'
  import {
    dropDecision,
    isDragGesture,
    mergeProgress,
    movePlan,
    seatPauseMs,
    type MovePlan,
  } from './drag'
  import { collapseBlankLines } from './bio-preview'
  import { warnImportFailure } from './failure-log'
  import { fireSeatBurst } from './seat-burst'
  import { initialSelection, type ImportMode } from './selection'

  interface Props {
    open?: boolean
    mode: ImportMode
    fields: BlueskyProfileImportField[]
    /** The import request succeeded; the refresh has not finished yet. */
    onimportsucceeded?: (result: ImportBlueskyProfileOutput) => void
    /** The import succeeded but reloading the page data failed. */
    onrefreshfailed?: () => void
    onimported?: (result: ImportBlueskyProfileOutput) => void
  }

  let {
    open = $bindable(false),
    mode,
    fields,
    onimportsucceeded,
    onrefreshfailed,
    onimported,
  }: Props = $props()

  const hintId = $props.id()

  // svelte-ignore state_referenced_locally
  let rows = $state(initialSelection(fields, mode))
  let loading = $state(false)
  /** The import request itself is in flight (not the refresh after it). */
  let requesting = $state(false)
  let error = $state<string>()
  let checkedFields = $derived(
    rows.filter((row) => row.checked).map((row) => row.field),
  )

  const labelKeys: Record<KnownField, string> = {
    displayName: 'form.profile.displayName',
    description: 'form.profile.bio',
    avatar: 'form.profile.avatar',
    banner: 'form.profile.banner',
  }

  /** Order the fields fill into the Coves card; DOM order follows `rows`. */
  const slotOrder: KnownField[] = [
    'banner',
    'avatar',
    'displayName',
    'description',
  ]

  /** Where each field sits in the shared header grid (.profile-card). */
  const fieldArea: Record<KnownField, string> = {
    banner: '[grid-area:banner]',
    avatar:
      '[grid-area:avatar] z-10 -mt-5 ml-4 self-start rounded-full md:-mt-7',
    displayName: '[grid-area:name] rounded-lg pt-0.5 pr-4 pl-3 md:pt-1.5',
    description: '[grid-area:bio] rounded-lg px-4 pt-2 md:pt-3',
  }

  /** A field the lexicon may add later has no entry. */
  function lookup<Value>(
    map: Record<KnownField, Value>,
    field: BlueskyProfileImportFieldName,
  ): Value | undefined {
    return (map as Partial<Record<string, Value>>)[field]
  }

  function label(field: BlueskyProfileImportFieldName): string {
    const key = lookup(labelKeys, field)
    return key ? $t(key) : field
  }

  let account = $derived(
    profile.current.type === 'authenticated' ? profile.current : undefined,
  )
  let handle = $derived(account?.handle)
  let rowFor = $derived(new Map(rows.map((row) => [row.field, row])))

  /** Any close by the user; in the automatic offer it records a dismissal. */
  function dismissed(): void {
    if (mode === 'offer') void dismissBlueskyProfileImport()
  }

  // The move: drag, button or keyboard sends the card into the Coves slot.
  let card = $state<HTMLElement>()
  let target = $state<HTMLElement>()
  /** The card's translation from its resting place; undefined at rest. */
  let offset = $state<{ x: number; y: number }>()
  let dragging = $state(false)
  let overTarget = $state(false)
  let plan = $state<MovePlan>()
  /** Fields filled into the Coves card so far during a move. */
  let revealed = $state<string[]>([])
  /** Read when a gesture or move starts, like the rest of the app does. */
  let reducedMotion = $state(false)
  /** The card has landed and the Coves card shows the imported header. */
  let seated = $state(false)
  /** The card's blend toward Coves styling when it takes over from a ghost. */
  let cardMerge = $state(0)
  let moving = $derived(plan !== undefined)
  /** A move, the import request or the seated pause is under way. */
  let busy = $derived(moving || loading)
  /**
   * Escape, the backdrop and the X cannot close the dialog during the move
   * or the import request; once the request has succeeded, a close only
   * ends the seated pause early.
   */
  let dismissable = $derived(!(moving && !seated) && !requesting)

  type Vector = { x: number; y: number }
  type Press = { pointerId: number; start: Vector; travel: Vector | undefined }
  let press: Press | undefined
  let timers: ReturnType<typeof setTimeout>[] = []
  /**
   * The floating copy of the card shown while dragging. It lives on
   * document.body because the modal's overflow and backdrop-filter would
   * clip anything inside the dialog, even position: fixed.
   */
  let ghost: HTMLElement | undefined
  let focusBeforeGhost: HTMLElement | undefined
  let ghostTimer: ReturnType<typeof setTimeout> | undefined
  /** The card is hidden in its slot while its ghost is shown. */
  let ghosted = $state(false)
  let bodyUserSelect = ''
  /** The ghost's blend toward Coves styling, applied once per frame. */
  let ghostMerge = 0
  let mergeFrame: number | undefined
  let removeBurst: (() => void) | undefined
  /** Ends the seated pause early, when the dialog closes during it. */
  let endPause: (() => void) | undefined
  /**
   * invalidateAll resets page.state to {}, which drops the Modal's history
   * marker, so the Modal reads the import's refresh as a Back press and
   * closes itself (and in the offer would record a dismissal). That close,
   * seen as a close during the refresh with no modal marker left, is
   * ignored; the dialog closes once the seated pause and the refresh have
   * both finished. Escape and the backdrop still close it while the marker
   * is there.
   */
  let refreshing = false

  function refreshDroppedMarker(): boolean {
    return refreshing && !page.state.openModals?.length
  }

  function setOpen(value: boolean): void {
    if (value || !refreshDroppedMarker()) open = value
  }

  function onModalDismissed(): void {
    if (!refreshDroppedMarker()) dismissed()
  }

  const springTransition = 'transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)'
  /** Text and surface switch at the blend's midpoint rather than mixing. */
  const mergeColourTransition = 'background-color 120ms ease, color 120ms ease'

  /** jsdom-based page tests have no matchMedia; treat that as full motion. */
  function prefersReducedMotion(): boolean {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  }

  function centre(rect: DOMRect): Vector {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  /** From the card's resting centre to the target's centre. */
  function travelToTarget(): Vector | undefined {
    if (!card || !target) return undefined
    const from = centre(card.getBoundingClientRect())
    const to = centre(target.getBoundingClientRect())
    return { x: to.x - from.x, y: to.y - from.y }
  }

  function pointerOverTarget(event: PointerEvent): boolean {
    if (!target) return false
    const rect = target.getBoundingClientRect()
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    )
  }

  function onpointerdown(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary || busy) return
    stopTracking()
    removeGhost()
    reducedMotion = prefersReducedMotion()
    press = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      travel: travelToTarget(),
    }
    document.addEventListener('pointermove', onpointermove)
    document.addEventListener('pointerup', onpointerup)
    document.addEventListener('pointercancel', onpointercancel)
  }

  /** The press start to the pointer, in CSS pixels. */
  function delta(event: PointerEvent, start: Vector): Vector {
    return { x: event.clientX - start.x, y: event.clientY - start.y }
  }

  function onpointermove(event: PointerEvent): void {
    if (!press || event.pointerId !== press.pointerId) return
    // The button was released without a pointerup reaching us (for example
    // outside the window); end the gesture rather than drag with no press.
    if (event.buttons === 0) {
      cancelGesture()
      return
    }
    const { x: dx, y: dy } = delta(event, press.start)
    if (!dragging && !isDragGesture(dx, dy)) return
    if (!dragging) {
      // Capture only once the press is a drag: capturing on pointerdown
      // would retarget a tap's click to the card, so fields stop toggling.
      // Synthetic or already-released pointers cannot be captured, and
      // document tracking covers that case.
      try {
        card?.setPointerCapture(event.pointerId)
      } catch {
        // Not capturable; document listeners still track the pointer.
      }
      createGhost()
    }
    dragging = true
    if (ghost) ghost.style.transform = `translate(${dx}px, ${dy}px)`
    overTarget = pointerOverTarget(event)
    if (!reducedMotion) {
      ghostMerge = mergeProgress(progressToward(press.travel, { x: dx, y: dy }))
      mergeFrame ??= requestAnimationFrame(applyGhostMerge)
    }
  }

  /** The move's projection onto the travel to the target, as a fraction. */
  function progressToward(travel: Vector | undefined, moved: Vector): number {
    const length = travel ? travel.x ** 2 + travel.y ** 2 : 0
    return travel && length > 0
      ? (moved.x * travel.x + moved.y * travel.y) / length
      : 0
  }

  function applyGhostMerge(): void {
    mergeFrame = undefined
    ghost?.style.setProperty('--merge-progress', String(ghostMerge))
  }

  function createGhost(): void {
    if (!card) return
    // Hiding the card drops focus from it or its field; restore it afterwards.
    focusBeforeGhost =
      document.activeElement instanceof HTMLElement &&
      card.contains(document.activeElement)
        ? document.activeElement
        : undefined
    const rect = card.getBoundingClientRect()
    const node = card.cloneNode(true) as HTMLElement
    for (const element of [node, ...node.querySelectorAll('[id]')]) {
      element.removeAttribute('id')
    }
    node.removeAttribute('style')
    node.removeAttribute('tabindex')
    node.classList.replace('cursor-grab', 'cursor-grabbing')
    node.classList.replace('shadow-sm', 'shadow-xl')
    node.dataset.dragGhost = ''
    node.setAttribute('aria-hidden', 'true')
    node.inert = true
    Object.assign(node.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      zIndex: '1000',
      boxSizing: 'border-box',
      pointerEvents: 'none',
      transform: 'translate(0px, 0px)',
      transition: mergeColourTransition,
    })
    ghostMerge = 0
    node.style.setProperty('--merge-progress', '0')
    document.body.append(node)
    ghost = node
    ghosted = true
    bodyUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
  }

  /** Springs the ghost back over the card's slot, then shows the card. */
  function returnGhost(): void {
    if (!ghost || ghostTimer) return
    if (reducedMotion) {
      removeGhost()
      return
    }
    ghost.style.transition = `${springTransition}, --merge-progress 300ms ease, ${mergeColourTransition}`
    ghost.style.transform = 'translate(0px, 0px)'
    cancelMergeFrame()
    ghost.style.setProperty('--merge-progress', '0')
    ghostTimer = setTimeout(removeGhost, 300)
  }

  function cancelMergeFrame(): void {
    if (mergeFrame !== undefined) cancelAnimationFrame(mergeFrame)
    mergeFrame = undefined
  }

  function removeGhost(): void {
    clearTimeout(ghostTimer)
    ghostTimer = undefined
    cancelMergeFrame()
    if (!ghost) return
    ghost.remove()
    ghost = undefined
    ghosted = false
    document.body.style.userSelect = bodyUserSelect
    const focusTarget = focusBeforeGhost
    focusBeforeGhost = undefined
    if (focusTarget?.isConnected) {
      // Focus needs the card visible again, which happens on the next render.
      void tick().then(() => focusTarget.focus({ preventScroll: true }))
    }
  }

  function onpointerup(event: PointerEvent): void {
    if (!press || event.pointerId !== press.pointerId) return
    const { travel, start } = press
    stopTracking()
    if (!dragging) return
    swallowNextClick()
    const moved = delta(event, start)
    const progress = progressToward(travel, moved)
    const decision = dropDecision({
      progress,
      overTarget: pointerOverTarget(event),
    })
    if (decision === 'drop' && checkedFields.length > 0) {
      // Put the card where the ghost was, with no transition, so the morph
      // starts from the drop point; reading the rect commits that position.
      offset = moved
      cardMerge = reducedMotion ? 0 : mergeProgress(progress)
      flushSync()
      card?.getBoundingClientRect()
      removeGhost()
      dragging = false
      startMove(travel)
    } else {
      dragging = false
      returnToRest()
      returnGhost()
    }
  }

  /**
   * Cancel and lost capture spring the card back. Our pointerup handler
   * stops tracking first, so the lostpointercapture that follows a normal
   * release finds no press and does nothing.
   */
  function onpointercancel(event: PointerEvent): void {
    if (!press || event.pointerId !== press.pointerId) return
    cancelGesture()
  }

  function cancelGesture(): void {
    stopTracking()
    dragging = false
    returnToRest()
    returnGhost()
  }

  function stopTracking(): void {
    press = undefined
    document.removeEventListener('pointermove', onpointermove)
    document.removeEventListener('pointerup', onpointerup)
    document.removeEventListener('pointercancel', onpointercancel)
  }

  /** The click that ends a drag must not toggle the field it started on. */
  function swallowNextClick(): void {
    const swallow = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      stop()
    }
    const stop = () => {
      window.removeEventListener('click', swallow, true)
      clearTimeout(timer)
    }
    window.addEventListener('click', swallow, true)
    const timer = setTimeout(stop, 0)
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    startMove()
  }

  function clearTimers(): void {
    for (const timer of timers) clearTimeout(timer)
    timers = []
  }

  function returnToRest(): void {
    clearTimers()
    plan = undefined
    offset = undefined
    overTarget = false
    revealed = []
    seated = false
    cardMerge = 0
    endBurst()
  }

  function endBurst(): void {
    removeBurst?.()
    removeBurst = undefined
  }

  /** The card lands: the Coves card becomes the imported header. */
  function seat(): void {
    seated = true
    // The header shows before the import request goes out.
    flushSync()
    if (reducedMotion || !target) return
    endBurst()
    removeBurst = fireSeatBurst(target.getBoundingClientRect())
  }

  function startMove(travel = travelToTarget()): void {
    if (busy || checkedFields.length === 0) return
    const selected = [...checkedFields]
    const slots = slotOrder.filter((field) => selected.includes(field))
    reducedMotion = prefersReducedMotion()
    const next = movePlan(reducedMotion)
    plan = next
    overTarget = false
    if (next.kind === 'morph') {
      offset = travel
      slots.forEach((field, index) => {
        const delay = next.fieldDelaysMs[index] ?? next.fieldDelaysMs.at(-1)
        timers.push(setTimeout(() => (revealed = [...revealed, field]), delay))
      })
    } else {
      offset = undefined
      revealed = slots
    }
    timers.push(
      setTimeout(() => {
        timers = []
        seat()
        void importFields(selected)
      }, next.durationMs),
    )
  }

  // A close mid-drag or mid-move must not import afterwards.
  $effect(() => {
    if (!open) {
      cancelGesture()
      removeGhost()
      endPause?.()
    }
  })
  $effect(() => () => {
    stopTracking()
    clearTimers()
    removeGhost()
    endBurst()
    endPause?.()
  })

  async function importFields(
    selected: BlueskyProfileImportFieldName[],
  ): Promise<void> {
    if (loading) return
    loading = true
    error = undefined
    // The dialog closes once the card has sat as the Coves header for the
    // pause and the import and refresh have finished, whichever is later.
    const pause = new Promise<void>((resolve) => {
      const timer = setTimeout(finish, seatPauseMs(reducedMotion))
      function finish(): void {
        clearTimeout(timer)
        endPause = undefined
        resolve()
      }
      endPause = finish
    })
    let result: ImportBlueskyProfileOutput
    requesting = true
    try {
      result = await coves().importBlueskyProfile({ fields: selected })
    } catch (err) {
      warnImportFailure('Bluesky profile import failed', err)
      endPause?.()
      loading = false
      returnToRest()
      if (err instanceof XrpcError && err.errorName === 'NothingToImport') {
        open = false
        toast({ content: $t('form.profile.blueskyImport.nothingToImport') })
      } else if (!(isExpiredSessionError(err) && profile.sessionExpired)) {
        error = errorMessage(err)
      }
      return
    } finally {
      requesting = false
    }
    onimportsucceeded?.(result)
    // The import is done; a failed refresh only leaves stale data on screen,
    // so it is not reported as an import error here.
    feeds.clear()
    refreshing = true
    try {
      await invalidateAll()
    } catch (err) {
      warnImportFailure('Refresh after the Bluesky profile import failed', err)
      onrefreshfailed?.()
    } finally {
      refreshing = false
    }
    await pause
    loading = false
    open = false
    toast({ content: $t('toast.blueskyProfileImported'), type: 'success' })
    onimported?.(result)
  }

  /** Each field fills into the Coves card over the plan's reveal time. */
  let revealAnimation = $derived(
    plan?.kind === 'morph' && plan.fieldRevealMs > 0
      ? `pop-in ${plan.fieldRevealMs}ms ease-out`
      : undefined,
  )

  let cardTransition = $derived.by(() => {
    if (dragging || reducedMotion) {
      return plan ? `opacity ${plan.durationMs}ms ease` : 'none'
    }
    if (!plan) return springTransition
    const duration = plan.durationMs
    return [
      `transform ${duration}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
      `--merge-progress ${duration}ms ease`,
      mergeColourTransition,
      `opacity ${Math.round(duration * 0.4)}ms ease ${Math.round(duration * 0.6)}ms`,
    ].join(', ')
  })
</script>

<Modal
  bind:open={() => open, setOpen}
  title={$t('form.profile.blueskyImport.title')}
  ondismissed={onModalDismissed}
  {dismissable}
  class="md:max-w-5xl"
>
  <p class="text-xs text-slate-600 md:text-sm dark:text-zinc-400">
    {$t('form.profile.blueskyImport.description')}
  </p>

  <!-- Both cards share the Coves profile header's phone geometry (see
       .profile-card) so the Bluesky card fits its slot exactly. Phones stack
       them; from md they sit side by side with the hint under the row, so
       the dialog fits a laptop window without scrolling. -->
  <div
    class="flex flex-col gap-1 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-x-3"
  >
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (the card is the keyboard handle for the move) -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions (pointer drag and Enter/Space move the card) -->
    <div
      bind:this={card}
      role="group"
      tabindex="0"
      aria-label={$t('form.profile.blueskyImport.blueskyLabel')}
      aria-describedby={hintId}
      {onpointerdown}
      onlostpointercapture={onpointercancel}
      {onkeydown}
      style:transform={offset
        ? `translate(${offset.x}px, ${offset.y}px)`
        : undefined}
      style:transition={cardTransition}
      style:visibility={ghosted ? 'hidden' : undefined}
      style:--merge-progress={moving ? '1' : String(cardMerge)}
      class={[
        'profile-card bluesky-card relative z-10 w-full md:col-start-1 md:row-start-1 min-w-0 shrink-0 touch-none overflow-hidden rounded-xl border-2 font-inter select-none',
        'outline-none focus-visible:ring-2 focus-visible:ring-bluesky-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950',
        dragging ? 'cursor-grabbing shadow-xl' : 'cursor-grab shadow-sm',
        moving && 'opacity-0',
      ]}
    >
      <span
        class="flex min-w-0 items-center gap-1.5 px-3 text-[13px] leading-5 font-semibold [grid-area:label]"
      >
        <span class="merge-accent shrink-0" aria-hidden="true">
          <BlueskyButterfly width={18} height={17} />
        </span>
        {$t('form.profile.blueskyImport.blueskyLabel')}
      </span>
      {#if !rowFor.has('banner')}
        <span class="merge-placeholder block [grid-area:banner]"></span>
      {/if}
      {#if !rowFor.has('avatar')}
        <span
          class="merge-ring relative z-10 -mt-5 ml-4 self-start rounded-full border-3 [grid-area:avatar] md:-mt-7"
        >
          <span
            class="merge-placeholder block size-[50px] rounded-full md:size-[74px]"
          ></span>
        </span>
      {/if}
      {#each rows as row (row.field)}
        <label
          data-selected={row.checked ? 'true' : 'false'}
          class={[
            'group relative block min-w-0 cursor-[inherit]',
            'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-bluesky-brand',
            lookup(fieldArea, row.field),
          ]}
        >
          <input
            type="checkbox"
            class="sr-only"
            value={row.field}
            aria-labelledby={`${hintId}-${row.field}-label`}
            bind:checked={row.checked}
            disabled={busy}
          />
          <span id={`${hintId}-${row.field}-label`} class="sr-only">
            {label(row.field)}
          </span>
          <span
            class="block h-full transition group-data-[selected=false]:opacity-40 group-data-[selected=false]:grayscale"
          >
            {#if row.field === 'banner'}
              {#if row.blueskyImageUrl}
                <img
                  src={row.blueskyImageUrl}
                  alt=""
                  draggable="false"
                  class="size-full object-cover"
                />
              {:else}
                <span class="merge-placeholder block size-full"></span>
              {/if}
            {:else if row.field === 'avatar'}
              {#if row.blueskyImageUrl}
                <img
                  src={row.blueskyImageUrl}
                  alt=""
                  draggable="false"
                  class="merge-ring block size-[56px] rounded-full border-3 md:size-[80px] object-cover"
                />
              {:else}
                <span
                  class="merge-ring block size-[56px] rounded-full border-3 md:size-[80px]"
                >
                  <span
                    class="merge-placeholder block size-full rounded-full"
                  ></span>
                </span>
              {/if}
            {:else if row.field === 'displayName'}
              <span
                class="block truncate text-xl leading-7 font-bold tracking-tight"
              >
                {row.bluesky}
              </span>
            {:else if row.bluesky}
              <span
                class="line-clamp-2 text-sm leading-5 whitespace-pre-wrap break-words md:line-clamp-3"
              >
                {row.field === 'description'
                  ? collapseBlankLines(row.bluesky)
                  : row.bluesky}
              </span>
            {/if}
          </span>
          {#if !row.checked}
            <span
              aria-hidden="true"
              class="absolute top-1 right-1 rounded-full bg-slate-800 px-1.5 text-[10px] leading-4 font-medium text-white dark:bg-zinc-200 dark:text-zinc-900"
            >
              {$t('form.profile.blueskyImport.fieldOff')}
            </span>
          {/if}
        </label>
      {/each}
      {#if handle}
        <span
          class="merge-muted min-w-0 truncate pr-4 pl-3 text-sm leading-5 md:pt-0.5 [grid-area:handle]"
        >
          @{handle}
        </span>
      {/if}
    </div>
    <p
      id={hintId}
      class="my-1 text-center text-xs text-slate-500 md:mt-4 md:mb-0 md:col-span-3 md:col-start-1 md:row-start-2 dark:text-zinc-400"
    >
      {$t('form.profile.blueskyImport.dragHint')}
    </p>
    <span
      aria-hidden="true"
      class="hidden text-xl text-slate-400 md:col-start-2 md:row-start-1 md:block dark:text-zinc-500"
    >
      →
    </span>

    <div
      bind:this={target}
      role="region"
      aria-label={$t('form.profile.blueskyImport.covesTarget')}
      class={[
        'w-full min-w-0 shrink-0 overflow-hidden rounded-xl border-2 transition-colors md:col-start-3 md:row-start-1',
        moving
          ? 'border-solid border-slate-900 bg-slate-50 dark:border-zinc-100 dark:bg-zinc-900'
          : overTarget
            ? 'border-dashed border-slate-900 bg-slate-100 dark:border-zinc-100 dark:bg-zinc-900'
            : 'border-dashed border-slate-300 dark:border-zinc-700',
      ]}
    >
      <!-- Seated, this mirrors the Coves profile header with the imported
         fields; the rest show what that header shows by default. -->
      <div
        class="profile-card text-slate-900 dark:text-zinc-100"
        data-seated={seated ? '' : undefined}
      >
        <span
          class="flex min-w-0 items-center gap-1.5 px-3 text-[13px] leading-5 font-semibold [grid-area:label]"
        >
          <!-- The sidebar's Coves mascot, as a background: it is decoration. -->
          <span
            class="size-[18px] shrink-0 bg-contain bg-center bg-no-repeat"
            style:background-image={`url(${covesMascotUrl})`}
            aria-hidden="true"
          ></span>
          <span class="truncate">
            {$t('form.profile.blueskyImport.covesLabel')}
          </span>
          {#if !moving}
            <span
              class="ml-auto shrink-0 font-medium text-slate-500 dark:text-zinc-400"
            >
              {$t('form.profile.blueskyImport.dropHere')}
            </span>
          {/if}
        </span>
        {#if revealed.includes('banner') && rowFor.get('banner')?.blueskyImageUrl}
          <img
            src={rowFor.get('banner')?.blueskyImageUrl}
            alt=""
            class="size-full object-cover [grid-area:banner]"
            style:animation={revealAnimation}
          />
        {:else if seated}
          <div class="overflow-hidden [grid-area:banner]">
            <div class="size-full scale-150">
              <Blobs seed={handle ?? account?.did ?? 'coves'} />
            </div>
          </div>
        {:else}
          <span
            class="block bg-slate-200 [grid-area:banner] dark:bg-zinc-800"
          ></span>
        {/if}
        <span
          class={[
            'relative z-10 -mt-5 ml-4 self-start rounded-full border-3 border-slate-50 [grid-area:avatar] md:-mt-7 dark:border-zinc-950',
            seated && 'shadow-md',
          ]}
        >
          {#if revealed.includes('avatar') && rowFor.get('avatar')?.blueskyImageUrl}
            <img
              src={rowFor.get('avatar')?.blueskyImageUrl}
              alt=""
              class="block size-[50px] rounded-full object-cover md:size-[74px]"
              style:animation={revealAnimation}
            />
          {:else if seated}
            <Avatar
              width={74}
              url={account?.avatar}
              did={account?.did}
              alt={handle ?? ''}
              circle
              class="size-[50px]! md:size-[74px]!"
            />
          {:else}
            <span
              class="block size-[50px] rounded-full bg-slate-300 md:size-[74px] dark:bg-zinc-700"
            ></span>
          {/if}
        </span>
        {#if revealed.includes('displayName')}
          <span
            class="min-w-0 truncate pt-0.5 pr-4 pl-3 text-xl leading-7 font-bold tracking-tight [grid-area:name] md:pt-1.5"
            style:animation={revealAnimation}
          >
            {rowFor.get('displayName')?.bluesky}
          </span>
          {#if handle}
            <span
              class="min-w-0 truncate pr-4 pl-3 text-sm leading-5 md:pt-0.5 text-slate-600 [grid-area:handle] dark:text-zinc-400"
              style:animation={revealAnimation}
            >
              @{handle}
            </span>
          {/if}
        {:else if seated}
          <span
            class="min-w-0 truncate pt-0.5 pr-4 pl-3 text-xl leading-7 font-bold tracking-tight [grid-area:name] md:pt-1.5"
          >
            @{handle}
          </span>
        {:else}
          <span class="pt-3.5 pr-4 pl-3 [grid-area:name]">
            <span
              class="block h-4 w-32 max-w-full rounded bg-slate-200 dark:bg-zinc-800"
            ></span>
          </span>
          <span class="pt-1.5 pr-4 pl-3 [grid-area:handle]">
            <span
              class="block h-3 w-20 max-w-full rounded bg-slate-200 dark:bg-zinc-800"
            ></span>
          </span>
        {/if}
        {#if revealed.includes('description')}
          <span
            class="line-clamp-2 px-4 pt-2 text-sm leading-5 whitespace-pre-wrap break-words [grid-area:bio] md:line-clamp-3 md:pt-3"
            style:animation={revealAnimation}
          >
            {collapseBlankLines(rowFor.get('description')?.bluesky ?? '')}
          </span>
        {:else if !seated}
          <span class="flex flex-col gap-2 px-4 pt-2 [grid-area:bio] md:pt-4">
            <span
              class="block h-3 w-full rounded bg-slate-200 dark:bg-zinc-800"
            ></span>
            <span
              class="block h-3 w-2/3 rounded bg-slate-200 dark:bg-zinc-800"
            ></span>
          </span>
        {/if}
      </div>
    </div>
  </div>

  {#if error}
    <p role="alert" class="text-sm text-red-600 dark:text-red-400">{error}</p>
  {/if}
  <div class="flex gap-2 md:mt-2">
    <Button
      size="lg"
      class="flex-1"
      disabled={busy}
      onclick={() => {
        open = false
        dismissed()
      }}
    >
      {$t('form.profile.blueskyImport.noThanks')}
    </Button>
    <Button
      size="lg"
      color="primary"
      class="flex-1 whitespace-nowrap"
      {loading}
      disabled={busy || checkedFields.length === 0}
      onclick={() => startMove()}
    >
      {$t('form.profile.blueskyImport.importProfile')}
    </Button>
  </div>
</Modal>

<style>
  /* Lets the blend transition when the card flies into the slot. */
  @property --merge-progress {
    syntax: '<number>';
    inherits: true;
    initial-value: 0;
  }

  /*
   * A label strip, an edge-to-edge banner, an avatar with a 3 px ring
   * straddling the banner's bottom edge beside the name (text-xl) and
   * handle (text-sm), then the bio. Every row has a fixed height, so both
   * cards measure the same whatever their content. Phones get a compact
   * version (80 px banner, 56 px avatar, two bio lines) so the stacked
   * dialog fits without scrolling; from md it is the Coves profile
   * header's geometry (h-36 banner, 74 px avatar, three bio lines).
   */
  .profile-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: 1.75rem 5rem 1.875rem 1.25rem 3rem;
    grid-template-areas:
      'label label'
      'banner banner'
      'avatar name'
      'avatar handle'
      'bio bio';
    padding-bottom: 0.625rem;
  }

  @media (width >= 48rem) {
    .profile-card {
      grid-template-rows: 2.25rem 9rem 2.125rem 1.375rem 4.5rem;
      padding-bottom: 1rem;
    }
  }

  /*
   * The Bluesky card blends from Bluesky's dim palette to the Coves theme
   * by --merge-progress (0 = Bluesky, 1 = Coves). The border mixes
   * smoothly. Mixing text from white to Coves ink would pass through the
   * surface's own mid-grey, so text switches at the midpoint (--merge-step)
   * and the surface jumps there from 20% to 80% of the way, which keeps
   * body text above 4.5:1 at every step in both themes.
   */
  .bluesky-card {
    --merge-step: clamp(0, (var(--merge-progress) - 0.5) * 1000, 1);
    --bluesky-share: calc((1 - var(--merge-progress)) * 100%);
    --surface-share: calc(
      (1 - 0.4 * var(--merge-progress) - 0.6 * var(--merge-step)) * 100%
    );
    --ink-share: calc((1 - var(--merge-step)) * 100%);
    --coves-surface: var(--color-slate-50);
    --coves-border: var(--color-slate-900);
    --coves-ink: var(--color-slate-900);
    --coves-muted: var(--color-slate-600);
    --coves-placeholder: var(--color-slate-200);
    --merge-surface: color-mix(
      in oklab,
      var(--color-bluesky-surface) var(--surface-share),
      var(--coves-surface)
    );
    background-color: var(--merge-surface);
    border-color: color-mix(
      in oklab,
      var(--color-bluesky-border) var(--bluesky-share),
      var(--coves-border)
    );
    color: color-mix(in oklab, #fff var(--ink-share), var(--coves-ink));
  }

  :global(.dark) .bluesky-card {
    --coves-surface: var(--color-zinc-900);
    --coves-border: var(--color-zinc-100);
    --coves-ink: var(--color-zinc-100);
    --coves-muted: var(--color-zinc-400);
    --coves-placeholder: var(--color-zinc-800);
  }

  .merge-muted,
  .merge-accent {
    transition: color 120ms ease;
  }

  .merge-muted {
    color: color-mix(
      in oklab,
      var(--color-bluesky-muted) var(--ink-share),
      var(--coves-muted)
    );
  }

  .merge-accent {
    color: color-mix(
      in oklab,
      var(--color-bluesky-brand) var(--ink-share),
      var(--coves-muted)
    );
  }

  .merge-ring,
  .merge-placeholder {
    transition:
      background-color 120ms ease,
      border-color 120ms ease;
  }

  .merge-ring {
    border-color: var(--merge-surface);
    background-color: var(--merge-surface);
  }

  .merge-placeholder {
    background-color: color-mix(
      in oklab,
      var(--color-bluesky-surface-hover) var(--surface-share),
      var(--coves-placeholder)
    );
  }
</style>
