<script lang="ts">
  import type { EmbedImageAspectRatio, PostEmbed } from '$lib/api/coves/types'
  import { settings } from '$lib/app/state/settings.svelte'
  import { showImage } from '$lib/ui/generic/ExpandableImage.svelte'
  import { Button, modal } from '$lib/ui/kit'
  import { onMount } from 'svelte'
  import { bestImageURL, extractEmbedAlt } from '../helpers'

  interface Props {
    embed: PostEmbed
    blur?: boolean
    /** The likely largest paint (first feed row, a post page): fetch now. */
    priority?: boolean
    /**
     * Feed card: the image keeps its natural size up to 560px tall, with no
     * blurred backdrop beside it.
     */
    feed?: boolean
  }

  let { embed, blur = false, priority = false, feed = false }: Props = $props()

  let img = $state<HTMLImageElement>()
  let imageLoaded: boolean | null = $state(null)
  onMount(() => {
    // A server-rendered image can finish before hydration, and its load event
    // is then already spent: hiding it until one arrives would hide it for
    // good.
    imageLoaded = img?.complete ?? false
  })

  let altText = $derived(extractEmbedAlt(embed))
  let previewUrl = $derived(bestImageURL(embed, false, 'thumb'))
  let fullImageUrl = $derived(bestImageURL(embed, false, 'fullsize'))
  // The URL whose load failed: its reserved box would stay empty, so it
  // collapses. Keyed by URL, a new image reserves again.
  let failedUrl = $state<string>()
  let loadFailed = $derived(!blur && failedUrl === fullImageUrl)
  // A feed image reserves its own ratio before it loads; elsewhere, when the
  // embed has none, or when it failed to load, the box hint stays 512x300.
  // The ratio is untrusted record data and is written into the inline style,
  // so only two finite positive numbers are accepted.
  let aspectRatio = $derived.by((): EmbedImageAspectRatio | undefined => {
    if (!feed || loadFailed || embed.$type !== 'social.coves.embed.images#view')
      return undefined
    const raw: unknown = embed.images[0]?.aspectRatio
    if (typeof raw !== 'object' || raw === null) return undefined
    const { width, height } = raw as Record<string, unknown>
    return typeof width === 'number' &&
      Number.isFinite(width) &&
      width > 0 &&
      typeof height === 'number' &&
      Number.isFinite(height) &&
      height > 0
      ? { width, height }
      : undefined
  })
  // Before it loads, the feed image holds the box it will fill: its ratio at
  // the width 560px of height allows. aspectRatio is a ratio, not pixels, so
  // the reservation is not clamped to it; a definite px width keeps the box
  // non-zero inside the w-fit wrapper, where a percentage would resolve to 0.
  let reservedWidth = $derived(
    aspectRatio
      ? Math.round(((560 * aspectRatio.width) / aspectRatio.height) * 100) / 100
      : undefined,
  )
  // Once loaded, a smaller image shows at its natural width, never upscaled.
  let loadedWidth = $state<number>()
  let reservedStyle = $derived.by(() => {
    if (!aspectRatio || reservedWidth === undefined) return undefined
    const width = loadedWidth ?? reservedWidth
    return `aspect-ratio: ${aspectRatio.width} / ${aspectRatio.height}; width: ${width}px`
  })

  function onImageLoad(event: Event) {
    imageLoaded = true
    if (reservedWidth === undefined) return
    const { naturalWidth } = event.currentTarget as HTMLImageElement
    if (naturalWidth > 0) loadedWidth = Math.min(reservedWidth, naturalWidth)
  }
</script>

<!--
  The backdrop and the image offer the same candidates under the same
  conditions, so the browser picks one file and uses it twice. The backdrop
  used to always load the preview while wide screens loaded the full size:
  two downloads per image. Above 800px the full size is only chosen when the
  screen's density needs it. The wide source has no media query: the first
  match wins, and `(min-width: 801px)` left a zoomed 800.5px viewport with no
  source at all.
-->
{#snippet sources()}
  <source srcset={previewUrl} media="(max-width: 800px)" />
  <source srcset="{previewUrl} 800w, {fullImageUrl} 1600w" sizes="800px" />
{/snippet}

<!--disabled preloads here since most people will hover over every image while scrolling-->
<svelte:element
  this={settings.expandImages ? 'button' : 'div'}
  class={[
    'z-10 cursor-pointer relative overflow-hidden group',
    feed
      ? 'block w-fit max-w-full rounded-[12px]'
      : [
          'container/a rounded-2xl bg-slate-100 dark:bg-zinc-900 transition-colors',
          'border border-slate-200 dark:border-zinc-800',
        ],
  ]}
  data-sveltekit-preload-data="off"
  aria-label={altText ?? 'Image'}
  onclick={() => showImage(fullImageUrl)}
  role="button"
  tabindex="0"
>
  {#if !feed}
    <picture class="inset-0 absolute -z-10 rounded-xl overflow-hidden">
      {@render sources()}
      <img
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        src={previewUrl}
        alt=""
        class=" object-cover w-full h-full opacity-50 blur-lg"
      />
    </picture>
  {/if}
  <picture class={feed ? 'block' : 'max-h-[60vh]'}>
    {@render sources()}
    <img
      bind:this={img}
      src={blur ? '' : fullImageUrl}
      loading={priority ? 'eager' : 'lazy'}
      fetchpriority={priority ? 'high' : 'auto'}
      decoding="async"
      class={[
        'max-w-full z-30 transition-all duration-500 group-hover:scale-98 group-active:scale-95',
        feed
          ? 'block h-auto max-h-[560px] rounded-[12px] outline-1 -outline-offset-1 outline-image-edge'
          : 'rounded-xl max-h-[60vh] object-contain mx-auto',
        // Without a ratio there is nothing to reserve: the natural size shows.
        feed && !aspectRatio && 'w-auto',
        'duration-200 ease-cubic',
        imageLoaded === false ? 'opacity-0' : 'opacity-100',
        blur && 'blur-3xl',
      ]}
      width={aspectRatio?.width ?? 512}
      height={aspectRatio?.height ?? 300}
      style={reservedStyle}
      alt={altText ?? ''}
      onload={onImageLoad}
      onerror={() => {
        imageLoaded = true
        if (!blur) failedUrl = fullImageUrl
      }}
    />
  </picture>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="absolute bottom-0 left-0 right-0 flex justify-between items-center
        rounded-full ml-auto w-max m-2 p-0 gap-1
        *:bg-white *:border *:border-slate-200 dark:*:border-zinc-800 dark:*:bg-zinc-900"
    onclick={(e) => e.stopPropagation()}
  >
    {#if altText}
      <Button
        onclick={(e) => {
          e.stopPropagation()
          modal({
            title: 'Alt',
            body: altText ?? '',
          })
        }}
        color="tertiary"
        size="md"
        rounding="pill"
      >
        ALT
      </Button>
    {/if}
  </div>
</svelte:element>
