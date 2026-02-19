<script lang="ts">
  import type { PostEmbed } from '$lib/api/coves/types'
  import { type View } from '$lib/app/settings.svelte'
  import { PostIframe, PostImage, PostLink } from '..'
  import {
    extractEmbedThumbnail,
    extractEmbedTitle,
    extractEmbedUrl,
    iframeType,
    type MediaType,
  } from '../helpers'

  interface Props {
    view?: View
    embed?: PostEmbed
    type?: MediaType
    opened?: boolean | undefined
    blur?: boolean
    [key: string]: unknown
  }

  let {
    view = 'cozy',
    embed,
    type = 'none',
    opened = undefined,
    blur = false,
    ...rest
  }: Props = $props()

  let embedUrl = $derived(extractEmbedUrl(embed))
  let thumbnailUrl = $derived(extractEmbedThumbnail(embed))
  let embedTitle = $derived(extractEmbedTitle(embed))
</script>

<!--
  @component
  This component will show either
  - A media item (pictures, videos) (large form factor posts only)
  - Embed link/card.
-->
{#if type === 'image' && view === 'cozy' && embed}
  <PostImage {embed} {blur} {...rest} />
{:else if (type === 'iframe' || type === 'video') && view === 'cozy' && embedUrl}
  <PostIframe
    thumbnail={thumbnailUrl}
    type={iframeType(embedUrl)}
    url={embedUrl}
    {opened}
    title={embedTitle}
    {...rest}
  />
{:else if type === 'embed' && embedUrl}
  <PostLink
    url={embedUrl}
    thumbnail_url={thumbnailUrl}
    embed_title={embedTitle}
    {view}
    {...rest}
  />
{/if}
