<script lang="ts" module>
  import { pushState, replaceState } from '$app/navigation'
  import { page } from '$app/state'
  import { isImageSourceUrl } from '$lib/api/coves/image-proxy'
  import { t } from '$lib/app/state/i18n'
  import { Button, Material, toast } from '$lib/ui/kit'
  import { ChevronLeft, ChevronRight, Forward, X } from '$lib/ui/kit/icon'
  import { backOut } from 'svelte/easing'
  import { SvelteSet } from 'svelte/reactivity'
  import { fade, scale } from 'svelte/transition'
  import { trapFocus } from 'trap-focus-svelte'
  import ImageUnavailable from './ImageUnavailable.svelte'
  import PageDots from './PageDots.svelte'
  import { swipe } from './swipe'

  export interface LightboxImage {
    url: string
    alt?: string
  }

  /** Opens the lightbox on `images`, showing the one at `index`. */
  export function showImage(images: LightboxImage[], index: number) {
    pushState('', {
      openImages: images,
      openImageIndex: index,
    })
  }
</script>

<script lang="ts">
  let images = $derived(page.state.openImages ?? [])
  let index = $derived(
    Math.min(Math.max(page.state.openImageIndex ?? 0, 0), images.length - 1),
  )
  let current = $derived(images[index])
  let url = $derived(
    current && isImageSourceUrl(current.url) ? current.url : undefined,
  )
  /** URLs that failed to load: each shows the placeholder, not a broken image. */
  const failed = new SvelteSet<string>()
  /**
   * URLs whose file is taller than 1:2, such as a comic strip. Fitting one to
   * the viewport height would shrink it past reading, so it keeps only the
   * width cap and the overlay scrolls.
   */
  const tall = new SvelteSet<string>()
  let overlay = $state<HTMLDivElement>()
  /** How far a finger has dragged the image up or down, in px. */
  let dragOffset = $state(0)
  let dragging = $state(false)
  /** A recognised swipe is closing it: the image leaves from where it was. */
  let dismissing = $state(false)
  /** The page is pinch-zoomed, so a drag pans the zoomed view instead. */
  let zoomed = $state(false)
  /**
   * The overlay scrolls, as with long ALT text or a landscape phone: a
   * vertical drag scrolls it instead of closing the lightbox.
   */
  let overflows = $state(false)
  /** The axis the drag moves along, set once it has moved far enough to tell. */
  let axis: 'x' | 'y' | null = null
  /** Movement before the drag picks an axis, so a tap jiggle moves nothing. */
  const AXIS_SLOP = 10
  let open = $derived(current !== undefined)

  // Each image, and each opening, starts at rest, whatever the last one left.
  $effect.pre(() => {
    if (!open) return
    void url
    dragOffset = 0
    dragging = false
    dismissing = false
  })

  $effect(() => {
    const viewport = window.visualViewport
    if (!open || !viewport) return
    const update = () => (zoomed = viewport.scale > 1)
    update()
    viewport.addEventListener('resize', update)
    return () => viewport.removeEventListener('resize', update)
  })

  function measureOverflow(): void {
    overflows = !!overlay && overlay.scrollHeight > overlay.clientHeight
  }

  // Re-checked for each image and ALT text, and on resize; the image's load
  // re-checks too, once its size is known.
  $effect(() => {
    if (!open || !overlay) return
    void url
    void current?.alt
    measureOverflow()
    window.addEventListener('resize', measureOverflow)
    return () => window.removeEventListener('resize', measureOverflow)
  })

  // The page under the lightbox must not scroll. Keyed on `open`, not the
  // image, so stepping between images keeps the value saved at open.
  $effect(() => {
    if (!open) return
    const html = document.documentElement
    const saved = html.style.overflow
    // Keeps the content behind the backdrop from shifting by the scrollbar,
    // on pages that had one to lose.
    const savedGutter = html.style.scrollbarGutter
    const hadScrollbar = window.innerWidth > html.clientWidth
    html.style.overflow = 'hidden'
    if (hadScrollbar) html.style.scrollbarGutter = 'stable'
    return () => {
      html.style.overflow = saved
      html.style.scrollbarGutter = savedGutter
    }
  })

  /**
   * Drag the image up or down to close; anything short of a swipe snaps back.
   * A mostly horizontal drag moves nothing.
   */
  const dismissSwipe = swipe({
    onmove: (dx, dy) => {
      if (axis === null) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_SLOP) return
        axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x'
      }
      if (axis !== 'y') return
      dragging = true
      dragOffset = dy
    },
    onswipe: (direction) => {
      if (axis !== 'y' || (direction !== 'up' && direction !== 'down')) return
      dismissing = true
      history.back()
    },
    onend: () => {
      axis = null
      dragging = false
      if (!dismissing) dragOffset = 0
    },
  })

  // Stepping onto an image with no usable URL removes the focused share
  // button, which drops focus to <body> where the overlay's keys go unheard.
  $effect(() => {
    if (url || !overlay || overlay.contains(document.activeElement)) return
    overlay.querySelector<HTMLElement>('[data-lightbox-close]')?.focus()
  })

  /**
   * Steps through the images, wrapping at either end. It replaces the history
   * entry instead of pushing one, so a single Back still closes the lightbox.
   */
  function step(by: number) {
    replaceState('', {
      ...page.state,
      openImageIndex: (index + by + images.length) % images.length,
    })
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key == 'Escape') history.back()
    else if (event.key == 'ArrowLeft' && images.length > 1) step(-1)
    else if (event.key == 'ArrowRight' && images.length > 1) step(1)
  }
</script>

{#if current}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed top-0 left-0 w-screen h-svh overflow-auto overscroll-contain
    flex flex-col z-100 pt-8 pb-20"
    transition:fade={{ duration: 150 }}
    onclick={() => history.back()}
    {onkeydown}
    use:trapFocus
    bind:this={overlay}
  >
    <!-- The backdrop is its own layer so a drag can fade it, not the image. -->
    <div
      class={[
        'fixed inset-0 -z-10 bg-white/80 dark:bg-black/80 backdrop-blur-md',
        !dragging && 'motion-safe:transition-opacity',
      ]}
      style:opacity={dragOffset
        ? 1 - Math.min(Math.abs(dragOffset) / 400, 0.6)
        : undefined}
    ></div>
    <!-- The arrows and dots sit on the image itself, so they follow its size. -->
    <!-- A drag moves this wrapper, so the arrows and dots go with the image. -->
    <div
      class={[
        'relative mx-auto my-auto w-fit max-w-full',
        !dragging && !dismissing && 'motion-safe:transition-[translate]',
      ]}
      style:translate={dragOffset ? `0 ${dragOffset}px` : undefined}
    >
      {#if url && !failed.has(url)}
        <img
          width={800}
          height={800}
          src={url}
          class={[
            'block max-w-[calc(100vw-2rem)] md:max-w-[min(90vw,calc(100vw-10rem))] w-auto h-auto object-contain rounded-xl shadow-2xl overscroll-contain bg-white dark:bg-zinc-900',
            !tall.has(url) && 'max-h-[min(80svh,calc(100svh-10rem))]',
          ]}
          style:touch-action={tall.has(url) || zoomed || overflows
            ? undefined
            : 'pinch-zoom'}
          {@attach !tall.has(url) && !overflows && dismissSwipe}
          transition:scale={{ start: 1.04, easing: backOut, duration: 250 }}
          alt={current.alt ?? ''}
          onload={(event) => {
            const { naturalWidth, naturalHeight } =
              event.currentTarget as HTMLImageElement
            if (naturalHeight > naturalWidth * 2) tall.add(url)
            measureOverflow()
          }}
          onerror={() => failed.add(url)}
        />
      {:else}
        <!-- The md width cap matches the img's, so the arrows outside it stay
             on screen. -->
        <div
          class="aspect-[4/3] w-[min(800px,calc(100vw-2rem))] md:max-w-[min(90vw,calc(100vw-10rem))]"
          style:touch-action={zoomed || overflows ? undefined : 'pinch-zoom'}
          {@attach !overflows && dismissSwipe}
        >
          <ImageUnavailable />
        </div>
      {/if}
      {#if images.length > 1}
        <PageDots
          class="absolute bottom-3 left-1/2 -translate-x-1/2"
          count={images.length}
          {index}
          label={$t('aria.lightbox.position', {
            index: index + 1,
            count: images.length,
          })}
        />
        <Button
          onclick={(e) => {
            e.stopPropagation()
            step(-1)
          }}
          color="tertiary"
          size="square-xl"
          rounding="pill"
          class="absolute left-2 top-1/2 z-10 -translate-y-1/2 md:-left-16 bg-[#262626]/90! text-[#fff8f0]! hover:bg-[#262626]!"
          aria-label={$t('aria.lightbox.previous')}
          icon={ChevronLeft}
        ></Button>
        <Button
          onclick={(e) => {
            e.stopPropagation()
            step(1)
          }}
          color="tertiary"
          size="square-xl"
          rounding="pill"
          class="absolute right-2 top-1/2 z-10 -translate-y-1/2 md:-right-16 bg-[#262626]/90! text-[#fff8f0]! hover:bg-[#262626]!"
          aria-label={$t('aria.lightbox.next')}
          icon={ChevronRight}
        ></Button>
      {/if}
    </div>
    {#if current.alt}
      <p
        class="mx-auto max-w-[800px] px-4 pt-2 text-sm whitespace-pre-wrap text-slate-900 dark:text-zinc-100"
      >
        {current.alt}
      </p>
    {/if}
    <div class="fixed z-10 bottom-4 left-1/2 -translate-x-1/2 w-max">
      <Material
        class="gap-1 p-0.5 px-1 flex flex-row items-center"
        rounding="full"
        padding="none"
        color="uniform"
        onclick={(e) => e.stopPropagation()}
      >
        {#if url}
          <Button
            onclick={() => {
              navigator.clipboard.writeText(url ?? '')
              toast({ content: $t('toast.copied') })
            }}
            color="tertiary"
            size="square-lg"
            rounding="pill"
            aria-label={$t('post.actions.more.share')}
            icon={Forward}
          ></Button>
        {/if}
        <Button
          onclick={() => history.back()}
          color="tertiary"
          size="square-lg"
          rounding="pill"
          aria-label={$t('common.back')}
          icon={X}
          data-lightbox-close
        ></Button>
      </Material>
    </div>
  </div>
{/if}
