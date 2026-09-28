<script lang="ts" generics="T">
  import { browser } from '$app/environment'
  import { Expandable } from '$lib/ui/kit'
  import { debounce } from '$lib/ui/kit/util/time'
  import { type Snippet, onDestroy, onMount, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { innerHeight } from 'svelte/reactivity/window'
  import { settings } from '$lib/app/state/settings.svelte'
  import { renderingServerMarkup } from '$lib/app/util/ssr'
  import type { VirtualListRestoration } from '$lib/types/virtual-list'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    items: T[]
    estimatedHeight?: number
    overscan?: number
    item: Snippet<[number]>
    restore?: VirtualListRestoration
    initialOffset?: number
    debounceResize?: number
    useWindow?: boolean
    height?: number
  }

  let {
    items,
    estimatedHeight = 100,
    overscan = 6,
    item: itemSnippet,
    initialOffset = 0,
    restore,
    debounceResize = 100,
    useWindow = true,
    height = 0,
    ...rest
  }: Props = $props()

  export function scrollToIndex(index: number, useWindow: boolean = false) {
    const targetPx = cumulativeItemHeights[index] - (initialOffset || 0)
    const targetStart = index === 0 ? 0 : cumulativeItemHeights[index - 1]
    const scrollTop = scrollY - (initialOffset || 0)
    if (
      targetStart >= scrollTop &&
      cumulativeItemHeights[index] <= scrollTop + (innerHeight.current ?? 0)
    ) {
      return
    }
    scrollY = targetPx
    if (useWindow && browser) {
      requestAnimationFrame(() => {
        window.scrollTo({ behavior: 'instant', top: scrollY })
      })
    }
  }

  const restorationOwner = untrack(() => restore)

  onDestroy(() => {
    if (restorationOwner) restorationOwner.itemHeights = [...itemHeights]
  })

  let virtualListEl = $state<HTMLElement>()

  // One-time sizing of the height cache: re-seeding on every `items` change
  // would throw away every measured height. The $effect.pre below keeps the
  // cache's length in sync — appending nulls when `items` grows, dropping the
  // stale tail when it shrinks; the ResizeObserver then fills individual
  // entries in as rows are measured.
  let itemHeights = $state<(number | null)[]>(
    untrack(() => [
      ...(restorationOwner?.itemHeights ?? Array(items.length).fill(null)),
    ]),
  )

  let cumulativeItemHeights = $derived.by<number[]>(() => {
    let cumulation = new Array(itemHeights.length)
    let sum = 0

    for (let i = 0; i < itemHeights.length; i++) {
      const height = itemHeights[i] || estimatedHeight
      sum += height
      cumulation[i] = sum
    }

    return cumulation
  })

  let scrollY = $state(0)
  let viewportHeight = $state(0)

  // On the server, and while hydrating what it sent, the list renders its
  // first rows in normal flow with no fixed height. That is all the server can
  // do without a viewport, and the hydrating render must produce the same
  // markup or Svelte throws the server's rows away and rebuilds them. onMount
  // then measures those real rows and switches to windowing. Lists created by
  // client-side navigation start windowed, as they always have.
  const STATIC_ROWS = 50
  const serverShaped = renderingServerMarkup()
  let mounted = $state(!serverShaped)
  let visibleItems = $state<{ index: number; offset: number }[]>(
    untrack(() =>
      serverShaped
        ? items.slice(0, STATIC_ROWS).map((_, index) => ({ index, offset: 0 }))
        : [],
    ),
  )

  $effect.pre(() => {
    if (items.length > itemHeights.length) {
      const missing = items.length - itemHeights.length
      itemHeights = [...itemHeights, ...Array(missing).fill(null)]
    } else if (items.length < itemHeights.length) {
      // Without this, stale trailing entries keep counting toward
      // cumulativeItemHeights — inflating the scroll height — and the binary
      // search can land on an index past the end of `items`.
      itemHeights = itemHeights.slice(0, items.length)
    }
  })

  $effect(() => {
    if (items.length) {
      untrack(() => {
        if (mounted) visibleItems = updateVisibleItems()
      })
    } else {
      // An emptied list must also empty the viewport: keeping the previous
      // visibleItems would render rows that index into items that no longer
      // exist.
      visibleItems = []
    }
  })

  function findFirstVisibleIndex(
    scrollTop: number,
    cumulativeHeights: number[],
  ): number {
    let low = 0
    let high = cumulativeHeights.length - 1
    let mid = 0

    while (low <= high) {
      mid = Math.floor((low + high) / 2)

      if (cumulativeHeights[mid] <= scrollTop) low = mid + 1
      else high = mid - 1
    }

    return low
  }

  function updateVisibleItems() {
    if (!virtualListEl) return []

    viewportHeight = innerHeight?.current ?? 1000
    const scrollTop = scrollY - initialOffset

    let newVisibleItems: { index: number; offset: number }[] = []

    const firstIndex = findFirstVisibleIndex(scrollTop, cumulativeItemHeights)

    const startIndex = Math.max(0, firstIndex - overscan)

    let i = startIndex
    let offset = i == 0 ? 0 : cumulativeItemHeights[i - 1]

    while (i < items.length) {
      newVisibleItems.push({ index: i, offset: offset })
      const height = itemHeights[i] || estimatedHeight
      offset += height

      if (offset > scrollTop + viewportHeight + overscan * estimatedHeight)
        break

      i++
    }

    return newVisibleItems ?? []
  }

  function resizeObserver(node: HTMLElement) {
    observer?.observe(node)

    return {
      destroy() {
        observer?.unobserve(node)
      },
    }
  }

  // The debounce interval is fixed when the wrapper is created: rebuilding it
  // to pick up a new `debounceResize` would drop any in-flight resize entries,
  // so the prop is read once here on purpose.
  const debouncedUpdate = debounce(
    (measurements: { index: number; height: number }[]) => {
      let changed = false
      for (const measurement of measurements) {
        if (itemHeights[measurement.index] !== measurement.height) {
          itemHeights[measurement.index] = measurement.height
          changed = true
        }
      }
      // Once per batch, not once per row: each pass walks the whole list.
      if (changed && mounted) visibleItems = updateVisibleItems()
    },
    untrack(() => debounceResize),
  )

  // Browser only: the constructor does not exist on the server, which renders
  // this list too.
  const observer = browser
    ? new ResizeObserver((entries) => {
        const measurements: { index: number; height: number }[] = []
        for (const entry of entries) {
          const indexAttr = entry.target.getAttribute('data-index')
          if (indexAttr === null) continue
          const index = Number(indexAttr)
          if (isNaN(index)) continue

          const height =
            entry.borderBoxSize?.[0]?.blockSize ??
            entry.target.getBoundingClientRect().height
          if (Number.isFinite(height)) measurements.push({ index, height })
        }
        debouncedUpdate(measurements)
      })
    : undefined

  onDestroy(() => {
    observer?.disconnect()
  })

  // Scroll position changes (only every few px)
  let oldScroll = 0
  $effect(() => {
    const currentScrollY = scrollY ?? 0
    untrack(() => {
      if (!mounted) return
      if (Math.abs(currentScrollY - oldScroll) > estimatedHeight) {
        visibleItems = updateVisibleItems()
        oldScroll = currentScrollY
      }
    })
  })

  onMount(() => {
    if (virtualListEl && browser) {
      Array.from(virtualListEl.children).forEach((node) => {
        const indexAttr = node.getAttribute('data-index')
        if (indexAttr === null) return
        const index = Number(indexAttr)
        if (isNaN(index)) return

        const newHeight = node.getBoundingClientRect().height
        if (itemHeights[index] !== newHeight) {
          itemHeights[index] = newHeight
        }
      })

      untrack(() => {
        visibleItems = updateVisibleItems()
        mounted = true
      })
    }
  })
</script>

<svelte:window
  bind:scrollY={
    () => (useWindow ? scrollY : 0),
    (v) => {
      if (useWindow) scrollY = v
    }
  }
/>

<div
  bind:this={virtualListEl}
  style="position: relative;{mounted
    ? ` height: ${
        height || cumulativeItemHeights[cumulativeItemHeights.length - 1] || 0
      }px;`
    : ''}"
  {...rest}
  id="feed"
  onscroll={() => {
    if (!useWindow) scrollY = virtualListEl?.scrollTop ?? 0
  }}
>
  <div
    style="height: {cumulativeItemHeights[visibleItems?.[0]?.index - 1] ||
      0}px; border: 0 !important;"
  ></div>
  {#each visibleItems as item (item.index)}
    <div
      data-index={item.index}
      class="post-container fix-divide group/virtual"
      use:resizeObserver
    >
      {@render itemSnippet(item.index)}
    </div>
  {/each}
</div>
{#if settings.debugInfo}
  <Expandable>
    {#snippet title()}
      Debug
    {/snippet}
    <pre>
      Virtual list debug info

      List items: {items.length}
      Rendering items: {visibleItems?.length} ({visibleItems?.[0]
        ?.index} - {visibleItems?.[visibleItems?.length - 1]?.index})
      Viewport height: {viewportHeight}
      Current scroll position: {scrollY}
      Container height: {cumulativeItemHeights[
        visibleItems?.[visibleItems?.length - 1]?.index
      ]}
      Overscan: {overscan}
      Guess item height: {estimatedHeight}
      Bumpscosity: {Math.floor(Math.random() * 5000)}
      Restore data: {JSON.stringify(restore)}
    </pre>
  </Expandable>
{/if}

<style>
  .fix-divide:nth-child(2) {
    border-top: 0;
  }
</style>
