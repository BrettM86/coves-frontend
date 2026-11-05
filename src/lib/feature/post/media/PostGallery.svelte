<script lang="ts">
  import { imageUrl } from '$lib/api/coves/image-proxy'
  import type { EmbedImage } from '$lib/api/coves/types'
  import { showImage } from '$lib/ui/generic/ExpandableImage.svelte'
  import PageDots from '$lib/ui/generic/PageDots.svelte'
  import { t } from '$lib/app/state/i18n'
  import { ChevronLeft, ChevronRight, Icon } from '$lib/ui/kit/icon'
  import PostGalleryTile from './PostGalleryTile.svelte'
  import { isGifImage } from './gif'

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
  let firstShown = $derived(shownPage * MAX_TILES)
  let tiles = $derived(images.slice(firstShown, firstShown + MAX_TILES))

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
    <div class="grid grid-cols-2 items-start gap-1">
      {#each tiles as image, index (firstShown + index)}
        <PostGalleryTile
          {image}
          {blur}
          priority={priority && firstShown + index === 0}
          columns={2}
          gif={isGifImage(image, gifs)}
          onopen={() => open(firstShown + index)}
        />
      {/each}
    </div>
    {#if shownPage > 0}
      <button
        type="button"
        class="page-arrow left-2"
        aria-label={$t('aria.gallery.previous')}
        onclick={() => (galleryPage = shownPage - 1)}
      >
        <Icon src={ChevronLeft} size="18" />
      </button>
    {/if}
    {#if shownPage < pageCount - 1}
      <button
        type="button"
        class="page-arrow right-2"
        aria-label={$t('aria.gallery.next')}
        onclick={() => (galleryPage = shownPage + 1)}
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
