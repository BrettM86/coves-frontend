<script lang="ts">
  import type { EmbedImage, PostEmbed } from '$lib/api/coves/types'
  import { type View } from '$lib/app/state/settings.svelte'
  import { PostIframe, PostLink } from '..'
  import PostGallery from './PostGallery.svelte'
  import BlueskyPostCard from './BlueskyPostCard.svelte'
  import {
    bestImageURL,
    embedImages,
    extractEmbedThumbnail,
    extractEmbedTitle,
    extractEmbedUrl,
    iframeType,
    getBlueskyPostEmbed,
    type MediaType,
  } from '../helpers'

  interface Props {
    view?: View
    embed?: PostEmbed
    type?: MediaType
    opened?: boolean | undefined
    blur?: boolean
    /** Passed to the gallery: see PostGallery. */
    priority?: boolean
    /** Passed to the gallery: see PostGallery. */
    placedImages?: EmbedImage[]
    /**
     * Feed card: a single image keeps its natural size.
     */
    feed?: boolean
    /** Passed to the gallery: see PostGallery. */
    gifs?: ReadonlySet<string>
  }

  let {
    view = 'cozy',
    embed,
    type = 'none',
    opened = undefined,
    blur = false,
    priority = false,
    placedImages = [],
    feed = false,
    gifs = undefined,
  }: Props = $props()

  let embedUrl = $derived(extractEmbedUrl(embed))
  let thumbnailUrl = $derived(extractEmbedThumbnail(embed))
  let embedTitle = $derived(extractEmbedTitle(embed))
  let blueskyEmbed = $derived(getBlueskyPostEmbed(embed))
  /** An image embed's images, or the image an external link points at. */
  let galleryImages = $derived.by((): EmbedImage[] => {
    const images = embedImages(embed)
    if (images.length > 0) return images
    const url = bestImageURL(embed, false)
    return url ? [{ thumb: url, fullsize: url }] : []
  })
</script>

<!--
  @component
  This component will show either
  - A media item (pictures, videos) (large form factor posts only)
  - Embed link/card.
-->
{#if type === 'image' && view === 'cozy' && galleryImages.length > 0}
  <PostGallery
    images={galleryImages}
    {placedImages}
    {blur}
    {priority}
    {feed}
    {gifs}
  />
{:else if type === 'embed' && blueskyEmbed}
  {#if view !== 'compact'}
    <BlueskyPostCard embed={blueskyEmbed} />
  {/if}
{:else if (type === 'iframe' || type === 'video') && view === 'cozy' && embedUrl}
  <PostIframe
    thumbnail={thumbnailUrl}
    type={iframeType(embedUrl)}
    url={embedUrl}
    {opened}
  />
{:else if type === 'embed' && embedUrl}
  <PostLink
    url={embedUrl}
    thumbnail_url={thumbnailUrl}
    embed_title={embedTitle}
    {view}
  />
{/if}
