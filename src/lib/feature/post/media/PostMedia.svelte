<script lang="ts">
  import type { PostEmbed } from '$lib/api/coves/types'
  import { type View } from '$lib/app/state/settings.svelte'
  import { PostIframe, PostImage, PostLink } from '..'
  import BlueskyPostCard from './BlueskyPostCard.svelte'
  import {
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
  }

  let {
    view = 'cozy',
    embed,
    type = 'none',
    opened = undefined,
    blur = false,
  }: Props = $props()

  let embedUrl = $derived(extractEmbedUrl(embed))
  let thumbnailUrl = $derived(extractEmbedThumbnail(embed))
  let embedTitle = $derived(extractEmbedTitle(embed))
  let blueskyEmbed = $derived(getBlueskyPostEmbed(embed))
</script>

<!--
  @component
  This component will show either
  - A media item (pictures, videos) (large form factor posts only)
  - Embed link/card.
-->
{#if type === 'image' && view === 'cozy' && embed}
  <PostImage {embed} {blur} />
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
