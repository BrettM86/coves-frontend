<script lang="ts">
  import { imageUrl } from '$lib/api/coves/image-proxy'
  import type { EmbedImage } from '$lib/api/coves/types'
  import { showImage } from '$lib/ui/generic/ExpandableImage.svelte'
  import PostGalleryTile from './PostGalleryTile.svelte'

  interface Props {
    images: EmbedImage[]
    blur?: boolean
    /** The likely largest paint (first feed row, a post page): fetch now. */
    priority?: boolean
  }

  let { images, blur = false, priority = false }: Props = $props()

  /** At most four tiles; the rest are reached through the lightbox. */
  const MAX_TILES = 4

  let tiles = $derived(images.slice(0, MAX_TILES))
  let hiddenCount = $derived(images.length - tiles.length)

  function open(index: number): void {
    showImage(
      images.map((image) => ({
        url: imageUrl(image, 'fullsize') ?? '',
        alt: image.alt,
      })),
      index,
    )
  }
</script>

<!--
  @component
  Every image of a post: one image spans the full width, two or more sit in a
  two-column grid of at most four tiles, the last carrying "+N" for the rest.
  Each tile reserves its space from the image's aspect ratio (4:3 without one).
-->
{#if images.length === 1}
  <PostGalleryTile
    image={images[0]}
    {blur}
    {priority}
    hiddenCount={0}
    onopen={() => open(0)}
  />
{:else if images.length > 1}
  <div class="grid grid-cols-2 items-start gap-1">
    {#each tiles as image, index (index)}
      <PostGalleryTile
        {image}
        {blur}
        priority={priority && index === 0}
        hiddenCount={index === tiles.length - 1 ? hiddenCount : 0}
        onopen={() => open(index)}
      />
    {/each}
  </div>
{/if}
