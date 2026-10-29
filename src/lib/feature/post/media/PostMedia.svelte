<script lang="ts">
  import type { EmbedImage, PostEmbed } from '$lib/api/coves/types'
  import { type View } from '$lib/app/state/settings.svelte'
  import { PostIframe, PostLink } from '..'
  import PostGallery from './PostGallery.svelte'
  import BlueskyPostCard from './BlueskyPostCard.svelte'
  import {
    bestImageURL,
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
  }

  let {
    view = 'cozy',
    embed,
    type = 'none',
    opened = undefined,
    blur = false,
    priority = false,
  }: Props = $props()

  let embedUrl = $derived(extractEmbedUrl(embed))
  let thumbnailUrl = $derived(extractEmbedThumbnail(embed))
  let embedTitle = $derived(extractEmbedTitle(embed))
  let blueskyEmbed = $derived(getBlueskyPostEmbed(embed))
  /** An image embed's images, or the image an external link points at. */
  let galleryImages = $derived.by((): EmbedImage[] => {
    if (embed?.$type === 'social.coves.embed.images#view') return embed.images
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
  <PostGallery images={galleryImages} {blur} {priority} />
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
    title={embedTitle}
  />
{:else if type === 'embed' && embedUrl}
  <PostLink
    url={embedUrl}
    thumbnail_url={thumbnailUrl}
    embed_title={embedTitle}
    {view}
  />
{/if}
