<script lang="ts">
  import { imageUrl } from '$lib/api/coves/image-proxy'
  import type { EmbedImage } from '$lib/api/coves/types'
  import { showImage } from '$lib/ui/generic/ExpandableImage.svelte'
  import PageDots from '$lib/ui/generic/PageDots.svelte'
  import { swipe } from '$lib/ui/generic/swipe'
  import { t } from '$lib/app/state/i18n'
  import { ChevronLeft, ChevronRight, Icon } from '$lib/ui/kit/icon'
  import PostGalleryTile from './PostGalleryTile.svelte'
  import { isGifImage } from './gif'
  import type { SwipeRelease } from '$lib/app/util/swipe'

  interface Props {
    images: EmbedImage[]
    /** Images placed in the body, which come first in the lightbox. */
    placedImages?: EmbedImage[]
    blur?: boolean
    /** The likely largest paint (first feed row, a post page): fetch now. */
    priority?: boolean
    /** Narrow a single image to its shape instead of letterboxing it. */
    fitHeight?: boolean
    /** Feed card: a single image is framed across the column. See PostGalleryTile. */
    feed?: boolean
    /** CIDs of the GIF blobs among `images` (see gifBlobCids). */
    gifs?: ReadonlySet<string>
  }

  let {
    images,
    placedImages = [],
    blur = false,
    priority = false,
    fitHeight = false,
    feed = false,
    gifs = new Set<string>(),
  }: Props = $props()

  /** Four tiles to a page; more images page through, four at a time. */
  const MAX_TILES = 4

  let pageCount = $derived(Math.ceil(images.length / MAX_TILES))
  let galleryPage = $state(0)
  // A refreshed post with fewer images must not leave an empty page.
  let shownPage = $derived(Math.min(galleryPage, Math.max(pageCount - 1, 0)))
  /** The current page and its neighbours, which a drag brings into view. */
  let renderedPages = $derived(
    Array.from(
      {
        length:
          Math.min(shownPage + 1, pageCount - 1) -
          Math.max(shownPage - 1, 0) +
          1,
      },
      (_, n) => Math.max(shownPage - 1, 0) + n,
    ),
  )

  /** Where the finger has dragged the strip from its resting place, in px. */
  let dragOffset = $state(0)
  let dragging = $state(false)
  let viewport: HTMLElement | undefined = $state()
  /**
   * The viewport's width in its own px and as displayed, read when a drag
   * picks its axis and again on release. They differ under CSS `zoom` (cozy
   * feed posts sit in `zoom: 0.9`), where pointer offsets are in displayed px.
   */
  let localWidth = 0
  let displayedWidth = 0
  /** The axis the drag moves along, set once it has moved far enough to tell. */
  let axis: 'x' | 'y' | null = null
  /** Movement before the drag picks an axis, so a tap jiggle moves nothing. */
  const AXIS_SLOP = 10
  /** Past the first or last page the strip moves at this fraction of the finger. */
  const EDGE_RESISTANCE = 1 / 3
  /** Sideways travel a tap may jiggle and still open the tile. */
  const TAP_SLOP = 20
  /** The page is pinch-zoomed, so a drag pans the zoomed view instead. */
  let zoomed = $state(false)

  $effect(() => {
    const visualViewport = window.visualViewport
    if (pageCount < 2 || !visualViewport) return
    const update = () => (zoomed = visualViewport.scale > 1)
    update()
    visualViewport.addEventListener('resize', update)
    return () => visualViewport.removeEventListener('resize', update)
  })

  function measure(): void {
    localWidth = viewport?.clientWidth ?? 0
    displayedWidth = viewport?.getBoundingClientRect().width ?? 0
  }

  function goToPage(page: number): void {
    galleryPage = Math.min(Math.max(page, 0), pageCount - 1)
  }

  function ondrag(dx: number, dy: number): void {
    if (axis === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_SLOP) return
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      measure()
    }
    if (axis !== 'x') return
    dragging = true
    const pastEdge =
      (shownPage === 0 && dx > 0) || (shownPage === pageCount - 1 && dx < 0)
    // Displayed px to the strip's own px.
    const local = displayedWidth > 0 ? (dx * localWidth) / displayedWidth : dx
    dragOffset = pastEdge ? local * EDGE_RESISTANCE : local
  }

  /**
   * Pages on past half the width, or on a flick at release in its direction;
   * otherwise springs back. Swallows the click that follows when it paged or
   * moved too far to be a tap.
   */
  function onrelease({ dx, flick }: SwipeRelease): boolean {
    if (axis !== 'x') return false
    measure()
    const pastHalf = displayedWidth > 0 && Math.abs(dx) >= displayedWidth / 2
    const before = shownPage
    if (flick === 'left' || flick === 'right')
      goToPage(shownPage + (flick === 'left' ? 1 : -1))
    else if (pastHalf) goToPage(shownPage + (dx < 0 ? 1 : -1))
    return shownPage !== before || Math.abs(dx) > TAP_SLOP
  }

  function onend(): void {
    axis = null
    dragging = false
    dragOffset = 0
  }

  function open(index: number): void {
    showImage(
      [...placedImages, ...images].map((image) => ({
        url: imageUrl(image, 'fullsize') ?? '',
        alt: image.alt,
      })),
      placedImages.length + index,
    )
  }
</script>

<!--
  @component
  Every image of a post: one image spans the full width, two or more sit in a
  two-column grid of four tiles to a page, with arrows and dots to page on.
  A touch drag moves the pages with the finger and pages on past half the
  width or on a flick. Only the current page and its neighbours render; the
  neighbours are inert and hidden from assistive technology.
  Each tile reserves its space from the image's aspect ratio (4:3 without one).
-->
{#if images.length === 1}
  <PostGalleryTile
    image={images[0]}
    {blur}
    {priority}
    {fitHeight}
    {feed}
    gif={isGifImage(images[0], gifs)}
    onopen={() => open(0)}
  />
{:else if images.length > 1}
  <div class="relative">
    <!-- With pages, horizontal drags move the strip; vertical scroll and
         pinch stay native. -->
    <div
      class="overflow-hidden"
      style:touch-action={pageCount > 1 && !zoomed
        ? 'pan-y pinch-zoom'
        : undefined}
      bind:this={viewport}
      {@attach pageCount > 1 && swipe({ onmove: ondrag, onrelease, onend })}
    >
      <div
        class={['strip relative', dragging && 'dragging']}
        style:transform="translateX(calc({-shownPage * 100}% + {dragOffset}px))"
      >
        <!-- Only the current page is in flow and sets the height; the
             neighbours sit beside it, out of flow, so a drag never changes
             the gallery's height. `inert` goes through a spread so it is
             set as an attribute: in the server HTML, and where the DOM has
             no inert property to reflect it (jsdom). -->
        {#each renderedPages as page (page)}
          {@const first = page * MAX_TILES}
          {@const current = page === shownPage}
          <div
            class={[
              'grid w-full grid-cols-2 items-start gap-1',
              current ? 'relative' : 'absolute top-0',
            ]}
            style:left="{page * 100}%"
            {...{ inert: current ? undefined : true }}
            aria-hidden={current ? undefined : 'true'}
          >
            {#each images.slice(first, first + MAX_TILES) as image, index (first + index)}
              <PostGalleryTile
                {image}
                {blur}
                priority={priority && current && first + index === 0}
                columns={2}
                gif={isGifImage(image, gifs)}
                onopen={() => open(first + index)}
              />
            {/each}
          </div>
        {/each}
      </div>
    </div>
    {#if shownPage > 0}
      <button
        type="button"
        class="page-arrow left-2"
        aria-label={$t('aria.gallery.previous')}
        onclick={() => goToPage(shownPage - 1)}
      >
        <Icon src={ChevronLeft} size="18" />
      </button>
    {/if}
    {#if shownPage < pageCount - 1}
      <button
        type="button"
        class="page-arrow right-2"
        aria-label={$t('aria.gallery.next')}
        onclick={() => goToPage(shownPage + 1)}
      >
        <Icon src={ChevronRight} size="18" />
      </button>
    {/if}
  </div>
  {#if pageCount > 1}
    <div class="mt-2 flex justify-center">
      <PageDots
        count={pageCount}
        index={shownPage}
        label={$t('aria.gallery.page', {
          index: shownPage + 1,
          count: pageCount,
        })}
      />
    </div>
  {/if}
{/if}

<style>
  .strip {
    transition: transform 250ms ease-out;
  }

  .strip.dragging {
    transition: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .strip {
      transition: none;
    }
  }

  /* Matches the dark pill of the page dots and the mobile app's media chips. */
  .page-arrow {
    position: absolute;
    top: 50%;
    translate: 0 -50%;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 9999px;
    background-color: rgb(38 38 38 / 0.9);
    color: #fff8f0;
    cursor: pointer;
  }

  .page-arrow:focus-visible {
    outline: 2px solid #fff8f0;
    outline-offset: 2px;
  }
</style>
