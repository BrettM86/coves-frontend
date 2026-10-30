<script lang="ts">
  import { imageUrl } from '$lib/api/coves/image-proxy'
  import type { EmbedImage } from '$lib/api/coves/types'
  import { t } from '$lib/app/state/i18n'
  import ImageUnavailable from '$lib/ui/generic/ImageUnavailable.svelte'

  interface Props {
    image: EmbedImage
    onopen: () => void
    onload?: () => void
  }

  let { image, onopen, onload }: Props = $props()

  let fullImageUrl = $derived(imageUrl(image, 'fullsize'))
  let aspectRatio = $derived(
    image.aspectRatio &&
      image.aspectRatio.width > 0 &&
      image.aspectRatio.height > 0
      ? `${image.aspectRatio.width} / ${image.aspectRatio.height}`
      : '4 / 3',
  )

  /** The image whose load failed; a new image gets a fresh attempt. */
  let failedImage = $state.raw<EmbedImage>()
  let unavailable = $derived(failedImage === image || !fullImageUrl)
</script>

<!--
  @component
  An image placed in the body by an `#image` facet: a block at most the body's
  width, its space reserved from the aspect ratio (4:3 without one).
-->
<div
  class={[
    'relative w-full max-w-full max-h-[60vh] overflow-hidden rounded-xl',
    'bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800',
  ]}
  style="aspect-ratio: {aspectRatio}"
>
  {#if unavailable}
    <ImageUnavailable />
  {:else}
    <button
      type="button"
      class="block h-full w-full cursor-pointer"
      data-sveltekit-preload-data="off"
      aria-label={image.alt ?? $t('post.image.label')}
      onclick={onopen}
    >
      <img
        src={fullImageUrl}
        alt={image.alt ?? ''}
        loading="lazy"
        decoding="async"
        class="h-full w-full object-contain"
        {onload}
        onerror={() => (failedImage = image)}
      />
    </button>
  {/if}
</div>
