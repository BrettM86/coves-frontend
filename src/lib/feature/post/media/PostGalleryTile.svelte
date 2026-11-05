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
  import { Button, modal } from '$lib/ui/kit'
  import { onMount } from 'svelte'

  interface Props {
    image: EmbedImage
    blur: boolean
    /** The likely largest paint (first feed row, a post page): fetch now. */
    priority: boolean
    /** Images past this tile that have no tile of their own: shown as "+N". */
    hiddenCount: number
    /** Narrow the tile to its image's shape instead of letterboxing it. */
    fitHeight?: boolean
    /** Tiles across the post column: 2 in the grid. */
    columns?: 1 | 2
    /**
     * Feed card: the image keeps its natural size up to 560px tall, with no
     * blurred backdrop beside it.
     */
    feed?: boolean
    onopen: () => void
  }

  let {
    image,
    blur,
    priority,
    hiddenCount,
    fitHeight = false,
    columns = 1,
    feed = false,
    onopen,
  }: Props = $props()

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
  // below 768px, beside the left sidebar to 1023px, then about 5/9 of the
  // viewport with both sidebars, stopping at 840px of image on wide screens.
  // A feed image is also capped at the width it reserves.
  let sizes = $derived.by(() => {
    if (columns === 2)
      return '(max-width: 767px) calc((100vw - 26px) / 2), (max-width: 1023px) calc((100vw - 306px) / 2), min(420px, calc((55.6vw - 50px) / 2))'
    if (feedWidth === undefined)
      return '(max-width: 767px) calc(100vw - 26px), (max-width: 1023px) calc(100vw - 306px), min(840px, calc(55.6vw - 50px))'
    const cap = `${feedWidth}px`
    return `(max-width: 767px) min(calc(100vw - 26px), ${cap}), (max-width: 1023px) min(calc(100vw - 306px), ${cap}), min(840px, calc(55.6vw - 50px), ${cap})`
  })
  let ratio = $derived(imageAspectRatio(image))
  let aspectRatio = $derived(
    ratio ? `${ratio.width} / ${ratio.height}` : '4 / 3',
  )
  // Before it loads, a feed image holds the box it will fill: its ratio at
  // the width 560px of height allows. The ratio is not pixels, so the box is
  // not clamped to it; a definite px width keeps the box non-zero inside the
  // w-fit wrapper, where a percentage would resolve to 0. Without a ratio
  // nothing is reserved and the natural size shows.
  let reservedWidth = $derived(
    feed && ratio
      ? Math.round(((560 * ratio.width) / ratio.height) * 100) / 100
      : undefined,
  )
  /** Once loaded, a smaller image shows at its natural width, never upscaled. */
  let loadedWidth = $state<number>()
  let feedWidth = $derived(
    reservedWidth === undefined
      ? undefined
      : Math.min(reservedWidth, loadedWidth ?? reservedWidth),
  )

  function onImageLoad(event: Event): void {
    imageLoaded = true
    const { naturalWidth } = event.currentTarget as HTMLImageElement
    if (naturalWidth > 0) loadedWidth = naturalWidth
  }

  let img = $state<HTMLImageElement>()
  let imageLoaded: boolean | null = $state(null)
  onMount(() => {
    // A server-rendered image can finish before hydration, and its load event
    // is then already spent: hiding it until one arrives would hide it for
    // good.
    imageLoaded = img?.complete ?? false
  })

  $effect.pre(() => {
    // A reused feed row showing another image reserves again.
    void image
    loadedWidth = undefined
  })

  /** The image whose load failed; a new image gets a fresh attempt. */
  let failedImage = $state.raw<EmbedImage>()
  let unavailable = $derived(
    failedImage === image || (!previewUrl && !fullImageUrl),
  )
</script>

<!--
  The backdrop and the image offer the same candidates under the same
  conditions, so the browser picks one file and uses it twice. The browser
  picks by the tile's width times the screen's density, so a 3x phone gets
  the full size. A media query here would miss zoomed viewports such as
  800.5px.
-->
{#snippet sources()}
  <source srcset={wideSourceSet} {sizes} />
{/snippet}

{#snippet altBadge()}
  {#if image.alt}
    <Button
      onclick={() =>
        modal({ title: $t('post.image.altTitle'), body: image.alt ?? '' })}
      color="tertiary"
      size="md"
      rounding="pill"
      class="absolute bottom-2 right-2 border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      {$t('post.image.altBadge')}
    </Button>
  {/if}
{/snippet}

{#if feed}
  <div class="relative w-fit max-w-full">
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
        <picture class="block">
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
              !ratio && 'w-auto',
              imageLoaded === false ? 'opacity-0' : 'opacity-100',
              blur && 'blur-3xl',
            ]}
            width={ratio?.width ?? 512}
            height={ratio?.height ?? 300}
            style={ratio && feedWidth !== undefined
              ? `aspect-ratio: ${aspectRatio}; width: ${feedWidth}px`
              : undefined}
            alt={image.alt ?? ''}
            onload={onImageLoad}
            onerror={() => (failedImage = image)}
          />
        </picture>
      {/if}
    </svelte:element>
    {@render altBadge()}
  </div>
{:else}
  <div
    class={[
      'relative w-full max-h-[60vh] overflow-hidden rounded-2xl',
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
              'h-full w-full object-contain transition-opacity duration-200 ease-cubic',
              imageLoaded === false ? 'opacity-0' : 'opacity-100',
              blur && 'blur-3xl',
            ]}
            alt={image.alt ?? ''}
            onload={() => (imageLoaded = true)}
            onerror={() => {
              // A blurred image has no source to fail on.
              if (!blur) failedImage = image
            }}
          />
        </picture>
      {/if}
      {#if hiddenCount > 0}
        <span
          class="absolute inset-0 grid place-items-center bg-black/50 text-2xl font-semibold text-white"
        >
          +{hiddenCount}
        </span>
      {/if}
    </svelte:element>
    {@render altBadge()}
  </div>
{/if}
