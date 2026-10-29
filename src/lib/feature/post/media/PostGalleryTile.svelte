<script lang="ts">
  import { imageUrl } from '$lib/api/coves/image-proxy'
  import type { EmbedImage } from '$lib/api/coves/types'
  import { settings } from '$lib/app/state/settings.svelte'
  import ImageUnavailable from '$lib/ui/generic/ImageUnavailable.svelte'
  import { Button, modal } from '$lib/ui/kit'
  import { onMount } from 'svelte'

  interface Props {
    image: EmbedImage
    blur: boolean
    /** The likely largest paint (first feed row, a post page): fetch now. */
    priority: boolean
    /** Images past this tile that have no tile of their own: shown as "+N". */
    hiddenCount: number
    onopen: () => void
  }

  let { image, blur, priority, hiddenCount, onopen }: Props = $props()

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
  let aspectRatio = $derived(
    image.aspectRatio &&
      image.aspectRatio.width > 0 &&
      image.aspectRatio.height > 0
      ? `${image.aspectRatio.width} / ${image.aspectRatio.height}`
      : '4 / 3',
  )

  let img = $state<HTMLImageElement>()
  let imageLoaded: boolean | null = $state(null)
  onMount(() => {
    // A server-rendered image can finish before hydration, and its load event
    // is then already spent: hiding it until one arrives would hide it for
    // good.
    imageLoaded = img?.complete ?? false
  })

  /** The image whose load failed; a new image gets a fresh attempt. */
  let failedImage = $state.raw<EmbedImage>()
  let unavailable = $derived(
    failedImage === image || (!previewUrl && !fullImageUrl),
  )
</script>

<!--
  The backdrop and the image offer the same candidates under the same
  conditions, so the browser picks one file and uses it twice. Above 800px the
  full size is only chosen when the screen's density needs it. The wide source
  has no media query: the first match wins, and `(min-width: 801px)` left a
  zoomed 800.5px viewport with no source at all.
-->
{#snippet sources()}
  {#if previewUrl}
    <source srcset={previewUrl} media="(max-width: 800px)" />
  {/if}
  <source srcset={wideSourceSet} sizes="800px" />
{/snippet}

<div
  class={[
    'relative w-full max-h-[60vh] overflow-hidden rounded-2xl',
    'bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800',
  ]}
  style="aspect-ratio: {aspectRatio}"
>
  <!--disabled preloads here since most people will hover over every image while scrolling-->
  <svelte:element
    this={settings.expandImages ? 'button' : 'div'}
    class="group absolute inset-0 block h-full w-full cursor-pointer"
    data-sveltekit-preload-data="off"
    aria-label={image.alt ?? 'Image'}
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
            'h-full w-full object-contain transition-all group-hover:scale-98 group-active:scale-95',
            'duration-200 ease-cubic',
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
  {#if image.alt}
    <Button
      onclick={() => modal({ title: 'Alt', body: image.alt ?? '' })}
      color="tertiary"
      size="md"
      rounding="pill"
      class="absolute bottom-2 right-2 border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      ALT
    </Button>
  {/if}
</div>
