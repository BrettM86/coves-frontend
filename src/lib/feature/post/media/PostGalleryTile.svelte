<script lang="ts">
  import { imageUrl } from '$lib/api/coves/image-proxy'
  import type { EmbedImage } from '$lib/api/coves/types'
  import { t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import ImageUnavailable from '$lib/ui/generic/ImageUnavailable.svelte'
  import {
    fittedImageWidth,
    imageAspectRatio,
  } from '$lib/feature/richtext/image-layout'
  import { modal } from '$lib/ui/kit'
  import { onMount } from 'svelte'
  import type { ClassValue } from 'svelte/elements'

  interface Props {
    image: EmbedImage
    blur: boolean
    /** The likely largest paint (first feed row, a post page): fetch now. */
    priority: boolean
    /** Narrow the tile to its image's shape instead of letterboxing it. */
    fitHeight?: boolean
    /** Tiles across the post column: 2 in the grid. */
    columns?: 1 | 2
    /**
     * Feed card: the image spans the column in a frame up to 560px tall,
     * over a blurred copy of itself (see feedFrame).
     */
    feed?: boolean
    /** An animated GIF: it plays from its full file, with pause and play. */
    gif?: boolean
    onopen: () => void
  }

  let {
    image,
    blur,
    priority,
    fitHeight = false,
    columns = 1,
    feed = false,
    gif = false,
    onopen,
  }: Props = $props()

  // A paused GIF is covered by a canvas holding the frame it stopped on. It
  // sits in the image's <picture> with the image's own layout and fit, so it
  // lands on the same box and is clipped by the same frame.
  let gifPaused = $state(false)
  let gifCanvas = $state<HTMLCanvasElement>()

  $effect(() => {
    if (!frozen || !gifCanvas || !img) return
    gifCanvas.width = img.naturalWidth || 1
    gifCanvas.height = img.naturalHeight || 1
    // Draws the frame showing now. The canvas may be cross-origin tainted;
    // it is only displayed, never read back.
    if (img.complete && img.naturalWidth > 0)
      gifCanvas.getContext('2d')?.drawImage(img, 0, 0)
  })

  let previewUrl = $derived(imageUrl(image, 'thumb'))
  let fullImageUrl = $derived(imageUrl(image, 'fullsize'))
  let wideSourceSet = $derived(
    [
      previewUrl && `${previewUrl} 800w`,
      fullImageUrl && `${fullImageUrl} 1600w`,
    ]
      .filter(Boolean)
      .join(', '),
  )
  // The post column's width, measured on the shell's layouts: full width
  // below 768px, beside the left sidebar to 1023px, then half of the
  // viewport with both sidebars, stopping at 750px of image on wide screens.
  // With the width limit off (settings.newWidth) the column is 54% of the
  // viewport from 1024px, with no cap. A feed image is also capped at the
  // width it reserves.
  let sizes = $derived.by(() => {
    const wide = settings.newWidth ? '50vw - 50px' : '54vw - 50px'
    const wideCap = settings.newWidth ? 750 : undefined
    if (columns === 2)
      return slotSizes(
        ['calc((100vw - 26px) / 2)'],
        ['calc((100vw - 306px) / 2)'],
        [`calc((${wide}) / 2)`, wideCap && wideCap / 2],
      )
    return slotSizes(
      ['calc(100vw - 26px)', reservedWidth],
      ['calc(100vw - 306px)', reservedWidth],
      [`calc(${wide})`, wideCap, reservedWidth],
    )
  })

  /** Phone, tablet and desktop slots, each a width and optional px caps. */
  function slotSizes(...slots: [string, ...(number | undefined)[]][]): string {
    const [phone, tablet, desktop] = slots.map(([width, ...caps]) => {
      const bounds = caps.filter((cap) => cap !== undefined)
      return bounds.length > 0
        ? `min(${[width, ...bounds.map((cap) => `${cap}px`)].join(', ')})`
        : width
    })
    return `(max-width: 767px) ${phone}, (max-width: 1023px) ${tablet}, ${desktop}`
  }
  let ratio = $derived(imageAspectRatio(image))
  // A grid tile is always a 4:3 crop, so a gallery fits one screen however
  // tall its images are; the lightbox shows each one whole.
  let aspectRatio = $derived(
    ratio && columns === 1 ? `${ratio.width} / ${ratio.height}` : '4 / 3',
  )
  // The widest a framed feed image is drawn: its ratio at 560px of height,
  // which caps the file the browser picks.
  let reservedWidth = $derived.by(() => {
    if (!feed || !ratio) return undefined
    // A very tall image shows at up to its file's own width (cropped below).
    if (feedFrame === 'tall') return tallWidth
    return Math.round(((560 * ratio.width) / ratio.height) * 100) / 100
  })
  /**
   * The loaded file's own pixels. naturalWidth can't be used: with srcset
   * width descriptors it is the slot width scaled by the file's real width
   * over its descriptor, so a file narrower than its descriptor reads small.
   */
  let loadedSize = $state<{ width: number; height: number }>()
  // Every feed image spans the column, like Reddit: up to 560px tall,
  // centred over a blurred copy of itself where it cannot fill the width.
  // A wide image fills the frame exactly, so it shows no bars. Very tall ones
  // (comics) are cropped from the top at 560px rather than shrunk to a sliver.
  let frameShape = $derived(loadedSize ?? ratio)
  let feedFrame = $derived.by((): 'fit' | 'tall' | undefined => {
    if (!feed || !frameShape) return undefined
    return frameShape.width / frameShape.height < 0.5 ? 'tall' : 'fit'
  })
  // The file's own width, so a small comic is not upscaled. A record ratio
  // only counts as pixels when it is plausibly a pixel size.
  let tallWidth = $derived(
    loadedSize?.width ??
      (ratio && ratio.width >= 200 ? ratio.width : undefined),
  )
  let frameImageStyle = $derived(
    feedFrame === 'tall'
      ? `width: ${tallWidth ? `min(100%, ${tallWidth}px)` : '100%'}`
      : loadedSize
        ? // A small file may grow to twice its size to fill the frame,
          // never further, so a tiny image does not turn to mush.
          `max-width: ${loadedSize.width * 2}px; max-height: ${loadedSize.height * 2}px`
        : undefined,
  )
  function onImageLoad(event: Event): void {
    imageLoaded = true
    void measure(event.currentTarget as HTMLImageElement)
  }

  async function measure(loaded: HTMLImageElement): Promise<void> {
    if (!feed) return
    const url = loaded.currentSrc || loaded.src
    // An image without srcset has a density of 1, so its natural size is the
    // file's. The file is cached, so this does not fetch it again, and its
    // size is known on load without decoding the pixels.
    const probe = new Image()
    const measured = new Promise<boolean>((resolve) => {
      probe.onload = () => resolve(true)
      probe.onerror = () => resolve(false)
    })
    probe.src = url
    if (!(await measured)) return
    // A later file (another image, or the full size after unblurring) has
    // replaced this one: its own load measures it.
    if (url !== (img?.currentSrc || img?.src)) return
    if (probe.naturalWidth > 0 && probe.naturalHeight > 0)
      loadedSize = { width: probe.naturalWidth, height: probe.naturalHeight }
  }

  let img = $state<HTMLImageElement>()
  let imageLoaded: boolean | null = $state(null)
  onMount(() => {
    // A server-rendered image can finish before hydration, and its load event
    // is then already spent: hiding it until one arrives would hide it for
    // good.
    imageLoaded = img?.complete ?? false
    if (img?.complete) void measure(img)
  })

  $effect.pre(() => {
    // A reused feed row showing another image reserves again. Keyed by URL:
    // the image object is rebuilt whenever the post refreshes.
    void fullImageUrl
    loadedSize = undefined
    gifPaused = false
  })

  /** The image whose load failed; a new image gets a fresh attempt. */
  let failedImage = $state.raw<EmbedImage>()
  let unavailable = $derived(
    failedImage === image || (!previewUrl && !fullImageUrl),
  )
  // A frozen frame needs a playing GIF to stand in for.
  let frozen = $derived(gif && !blur && !unavailable && gifPaused)
</script>

<!--
  The backdrop and the image offer the same candidates under the same
  conditions, so the browser picks one file and uses it twice. The browser
  picks by the tile's width times the screen's density, so a 3x phone gets
  the full size. A media query here would miss zoomed viewports such as
  800.5px.
-->
{#snippet sources()}
  <!-- A GIF's smaller candidate is a still JPEG: it always loads the full file. -->
  {#if !gif}
    <source srcset={wideSourceSet} {sizes} />
  {/if}
{/snippet}

{#snippet frozenFrame(fit: ClassValue, style?: string)}
  {#if frozen}
    <canvas
      bind:this={gifCanvas}
      aria-hidden="true"
      class={['pointer-events-none', fit]}
      {style}
    ></canvas>
  {/if}
{/snippet}

{#snippet gifControls()}
  <!-- A GIF that has not loaded has no frame to pause on. -->
  {#if gif && !blur && !unavailable && imageLoaded === true}
    {#if gifPaused}
      <button
        type="button"
        class="absolute inset-0 m-auto grid size-[60px] cursor-pointer place-items-center rounded-full bg-[rgb(10_21_23/0.72)] text-white transition-transform duration-200 hover:scale-[1.08] focus-visible:outline-2 focus-visible:outline-white motion-reduce:transition-none"
        aria-label={$t('post.image.playGif')}
        onclick={() => (gifPaused = false)}
      >
        <svg
          viewBox="0 0 24 24"
          width="26"
          height="26"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M7 4.5v15l12-7.5z" />
        </svg>
      </button>
    {:else}
      <button
        type="button"
        class="absolute bottom-2 left-2 grid size-8 cursor-pointer place-items-center rounded-full bg-[#262626]/90 text-[#fff8f0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        aria-label={$t('post.image.pauseGif')}
        onclick={() => (gifPaused = true)}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="currentColor"
          aria-hidden="true"
        >
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      </button>
    {/if}
  {/if}
{/snippet}

{#snippet altBadge()}
  {#if image.alt}
    <!-- A dark chip over the image, the same in light and dark themes. -->
    <button
      type="button"
      onclick={() =>
        modal({ title: $t('post.image.altTitle'), body: image.alt ?? '' })}
      class="absolute bottom-2 right-2 cursor-pointer rounded-[7px] bg-[#222]/90 px-[7.5px] py-[4.5px] text-[10.5px] font-bold leading-none tracking-wide text-white transition-colors hover:bg-[#222] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      {$t('post.image.altBadge')}
    </button>
  {/if}
{/snippet}

{#if feed && feedFrame && !unavailable}
  <div data-gallery-tile class="relative w-full whitespace-normal">
    <!--disabled preloads here since most people will hover over every image while scrolling-->
    <svelte:element
      this={settings.expandImages ? 'button' : 'div'}
      data-feed-frame={feedFrame}
      class="relative block w-full cursor-pointer overflow-hidden rounded-[12px] bg-slate-100 dark:bg-zinc-900 outline-1 -outline-offset-1 outline-image-edge"
      style={feedFrame === 'fit' && frameShape
        ? `aspect-ratio: ${frameShape.width} / ${frameShape.height}; max-height: 560px`
        : 'height: 560px'}
      data-sveltekit-preload-data="off"
      aria-label={image.alt ?? $t('post.image.label')}
      onclick={onopen}
      role="button"
      tabindex="0"
    >
      <picture class="absolute inset-0">
        {#if !blur}
          {@render sources()}
        {/if}
        <!-- A GIF's backdrop is its still preview: a second copy of the full
             file would keep playing behind a paused frame. -->
        <img
          src={blur || gif ? previewUrl : fullImageUrl}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          aria-hidden="true"
          alt=""
          class="h-full w-full scale-110 object-cover blur-2xl brightness-75"
        />
      </picture>
      <picture
        class={feedFrame === 'fit' ? 'absolute inset-0' : 'relative block'}
      >
        {#if !blur}
          {@render sources()}
        {/if}
        <img
          bind:this={img}
          src={blur ? previewUrl : fullImageUrl}
          loading={priority ? 'eager' : 'lazy'}
          fetchpriority={priority ? 'high' : 'auto'}
          decoding="async"
          class={[
            feedFrame === 'fit'
              ? 'absolute inset-0 m-auto h-full w-full object-contain'
              : 'relative mx-auto block h-auto',
            'transition-opacity duration-200 ease-cubic',
            imageLoaded === false ? 'opacity-0' : 'opacity-100',
            frozen && 'invisible',
            blur && 'blur-3xl',
          ]}
          style={frameImageStyle}
          alt={image.alt ?? ''}
          onload={onImageLoad}
          onerror={() => (failedImage = image)}
        />
        {@render frozenFrame(
          feedFrame === 'fit'
            ? 'absolute inset-0 m-auto h-full w-full object-contain'
            : 'absolute inset-x-0 top-0 mx-auto block h-auto',
          frameImageStyle,
        )}
      </picture>
      {#if feedFrame === 'tall'}
        <div
          data-tall-fade
          class="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-black/45 to-transparent"
        ></div>
      {/if}
    </svelte:element>
    {@render gifControls()}
    {@render altBadge()}
  </div>
{:else if feed}
  <div data-gallery-tile class="relative w-fit max-w-full whitespace-normal">
    <!--disabled preloads here since most people will hover over every image while scrolling-->
    <svelte:element
      this={settings.expandImages ? 'button' : 'div'}
      class="block w-fit max-w-full cursor-pointer overflow-hidden rounded-[12px]"
      data-sveltekit-preload-data="off"
      aria-label={image.alt ?? $t('post.image.label')}
      onclick={onopen}
      role="button"
      tabindex="0"
    >
      {#if unavailable}
        <div
          class="relative aspect-[4/3] w-[560px] max-w-full overflow-hidden rounded-[12px] bg-slate-100 dark:bg-zinc-900"
        >
          <ImageUnavailable />
        </div>
      {:else}
        <picture class="relative block">
          <!-- A blurred image shows the preview: the full size must not load. -->
          {#if !blur}
            {@render sources()}
          {/if}
          <img
            bind:this={img}
            src={blur ? previewUrl : fullImageUrl}
            loading={priority ? 'eager' : 'lazy'}
            fetchpriority={priority ? 'high' : 'auto'}
            decoding="async"
            class={[
              'block h-auto max-w-full max-h-[560px] rounded-[12px] outline-1 -outline-offset-1 outline-image-edge',
              'transition-opacity duration-200 ease-cubic',
              'w-auto',
              imageLoaded === false ? 'opacity-0' : 'opacity-100',
              frozen && 'invisible',
              blur && 'blur-3xl',
            ]}
            width={ratio?.width ?? 512}
            height={ratio?.height ?? 300}
            alt={image.alt ?? ''}
            onload={onImageLoad}
            onerror={() => (failedImage = image)}
          />
          {@render frozenFrame(
            'absolute inset-0 h-full w-full rounded-[12px] object-contain',
          )}
        </picture>
      {/if}
    </svelte:element>
    {@render gifControls()}
    {@render altBadge()}
  </div>
{:else}
  <div
    data-gallery-tile
    class={[
      // whitespace-normal: a comment body is pre-wrap, which would lay out
      // the markup's line breaks inside <picture> as lines above the image.
      'relative w-full max-h-[60vh] overflow-hidden rounded-2xl whitespace-normal',
      'bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800',
    ]}
    style="aspect-ratio: {aspectRatio}{fitHeight
      ? `; width: ${fittedImageWidth(image)}`
      : ''}"
  >
    <!--disabled preloads here since most people will hover over every image while scrolling-->
    <svelte:element
      this={settings.expandImages ? 'button' : 'div'}
      class="absolute inset-0 block h-full w-full cursor-pointer"
      data-sveltekit-preload-data="off"
      aria-label={image.alt ?? $t('post.image.label')}
      onclick={onopen}
      role="button"
      tabindex="0"
    >
      {#if unavailable}
        <ImageUnavailable />
      {:else}
        <picture class="absolute inset-0 overflow-hidden">
          {@render sources()}
          <img
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            src={previewUrl}
            alt=""
            class="h-full w-full object-cover opacity-50 blur-lg"
            onerror={() => (failedImage = image)}
          />
        </picture>
        <picture class="relative block h-full w-full">
          <!-- A blurred image offers no candidates: its file must not load. -->
          {#if !blur}
            {@render sources()}
          {/if}
          <img
            bind:this={img}
            src={blur ? '' : fullImageUrl}
            loading={priority ? 'eager' : 'lazy'}
            fetchpriority={priority ? 'high' : 'auto'}
            decoding="async"
            class={[
              'h-full w-full transition-opacity duration-200 ease-cubic',
              columns === 2 ? 'object-cover' : 'object-contain',
              imageLoaded === false ? 'opacity-0' : 'opacity-100',
              frozen && 'invisible',
              blur && 'blur-3xl',
            ]}
            alt={image.alt ?? ''}
            onload={() => (imageLoaded = true)}
            onerror={() => {
              // A blurred image has no source to fail on.
              if (!blur) failedImage = image
            }}
          />
          {@render frozenFrame([
            'absolute inset-0 h-full w-full',
            columns === 2 ? 'object-cover' : 'object-contain',
          ])}
        </picture>
      {/if}
    </svelte:element>
    {@render gifControls()}
    {@render altBadge()}
  </div>
{/if}
