<script lang="ts">
  import type {
    EmbedImage,
    ExternalEmbedExternal,
    PostEmbed,
  } from '$lib/api/coves/types'
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
     * Feed card: a single image keeps its natural size, and Post draws the
     * attached link as its link card.
     */
    feed?: boolean
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
  /**
   * The link card input for an `imagesWithAttachment` whose attachment is a
   * flattened external link; a post attachment carries only a strongRef and
   * renders nothing.
   */
  let attachedLink = $derived.by((): ExternalEmbedExternal | undefined => {
    if (embed?.$type !== 'social.coves.embed.imagesWithAttachment#view')
      return undefined
    const attachment = embed.attachment
    if (attachment.$type !== 'social.coves.embed.external#viewExternal')
      return undefined
    return {
      uri: attachment.uri,
      title: attachment.title,
      description: attachment.description,
      thumb: attachment.thumb,
      domain: attachment.domain,
    }
  })
</script>

<!--
  @component
  This component will show either
  - A media item (pictures, videos) (large form factor posts only)
  - Embed link/card.
-->
{#if type === 'image' && view === 'cozy' && galleryImages.length > 0}
  <PostGallery images={galleryImages} {placedImages} {blur} {priority} {feed} />
  {#if attachedLink && !feed}
    <div class="mt-3">
      <PostLink
        url={attachedLink.uri}
        thumbnail_url={attachedLink.thumb}
        embed_title={attachedLink.title}
        {view}
      />
    </div>
  {/if}
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
