<script lang="ts">
  import type { PostView } from '$lib/api/coves/types'
  import { type View, settings } from '$lib/app/settings.svelte'
  import { publishedToDate } from '$lib/ui/util/date'
  import type { ClassValue } from 'svelte/elements'
  import {
    PostActions,
    PostBody,
    PostMedia,
    PostMediaCompact,
    PostMeta,
  } from '.'
  import { extractEmbedTitle, extractEmbedUrl, mediaType } from './helpers'
  import { type MetaTag, parseTags } from './PostMeta.svelte'

  interface Props {
    post: PostView
    actions?: boolean
    hideCommunity?: boolean
    pinned?: boolean
    view?: View
    style?: string
    class?: ClassValue
    extraBadges?: import('svelte').Snippet
  }

  let {
    post = $bindable(),
    actions = true,
    hideCommunity = false,
    pinned = false,
    view = settings.view,
    style = '',
    class: clazz = '',
    extraBadges,
  }: Props = $props()

  let tags = $derived.by<{ title?: string; tags: MetaTag[] }>(() => {
    const parsed = parseTags(post.record?.title)

    return {
      title: parsed.title,
      tags: parsed.tags,
    }
  })
  let type = $derived(mediaType(post.embed))
  let embedUrl = $derived(extractEmbedUrl(post.embed))
  let embedTitle = $derived(extractEmbedTitle(post.embed))
  let hideTitle = $derived(
    settings.posts.deduplicateEmbed &&
      embedTitle === post.record?.title &&
      view !== 'compact' &&
      type !== 'iframe',
  )

  let badges = $derived({
    featured: pinned,
    saved: post.viewer?.saved ?? false,
  })
</script>

<!--
  @component
  This is the sole component for displaying posts.
  It adapts to all kinds of form factors for different contexts, such as feeds, full post view, and crosspost list.
-->
<article
  class={[
    'relative group/post',
    settings.leftAlign && 'left-align',
    view == 'compact' && 'py-3 list-type compact',
    view == 'cozy' && 'py-5 flex flex-col gap-2',
    clazz,
  ]}
  id={post.uri}
  {style}
>
  <PostMeta
    community={post.community}
    showCommunity={!hideCommunity}
    user={post.author}
    published={publishedToDate(post.createdAt)}
    {badges}
    uri={post.uri}
    title={hideTitle
      ? undefined
      : tags?.title
        ? tags.title
        : post.record?.title}
    style="grid-area: meta;"
    edited={post.editedAt}
    tags={tags?.tags}
    postUrl={embedUrl}
    {view}
    {extraBadges}
  />
  {#key embedUrl}
    <div style="grid-area:embed;" class={{ contents: view == 'cozy' }}>
      <PostMedia embed={post.embed} {view} {type} />
    </div>
    {#if view == 'compact'}
      <PostMediaCompact
        embed={post.embed}
        {type}
        class="{settings.leftAlign ? 'mr-3' : 'ml-3'} shrink no-list-margin"
        style="grid-area: media;"
        {view}
      />
    {/if}
  {/key}
  {#if post.record?.content && view != 'compact'}
    <PostBody
      element="section"
      body={post.record.content}
      style="grid-area: body"
      class="relative"
    />
  {/if}
  {#if actions}
    <PostActions bind:post style="grid-area: actions;" {view} />
  {/if}
</article>

<style>
  .list-type {
    display: grid;
    grid-template-areas: 'meta media' 'title media' 'body media' 'embed embed' 'actions actions';
    grid-template-columns: minmax(0, 1fr) auto;
    width: 100%;
    height: 100%;
  }

  /* Swap media/item positions */
  .list-type.left-align {
    grid-template-areas: 'media meta' 'media title' 'media body' 'embed embed' 'actions actions';
    grid-template-columns: auto minmax(0, 1fr);
  }

  /* Has media on the right for all of them */
  @media (min-width: 480px) {
    .list-type.compact {
      grid-template-areas: 'meta media' 'title media' 'body media' 'embed media' 'actions media';
    }
  }

  /* Swap above again */
  @media (min-width: 480px) {
    .list-type.compact.left-align {
      grid-template-areas: 'media meta' 'media title' 'media body' 'media embed' 'media actions';
    }
  }

  :global(.compact > *:not(.no-list-margin):not(:first-child)) {
    margin-top: 0.3rem;
  }

  :global(.list-type:not(.compact) > *:not(.no-list-margin):not(:first-child)) {
    margin-top: 0.5rem;
  }
</style>
