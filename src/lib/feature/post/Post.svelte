<script lang="ts">
  import type { PostView } from '$lib/api/coves/types'
  import { type View, settings } from '$lib/app/state/settings.svelte'
  import { publishedToDate } from '$lib/ui/util/date'
  import type { ClassValue } from 'svelte/elements'
  import {
    PostActions,
    PostBody,
    PostMedia,
    PostMediaCompact,
    PostMeta,
  } from '.'
  import {
    bestImageURL,
    extractEmbedTitle,
    extractEmbedUrl,
    mediaType,
    postTextFallback,
  } from './helpers'
  import { type MetaTag, parseTags } from './tags'
  import { hasNSFWLabel } from './content-labels'
  import { Badge, Button } from '$lib/ui/kit'
  import { Icon, Info } from '$lib/ui/kit/icon'
  import { t } from '$lib/app/state/i18n'

  interface Props {
    post: PostView
    expandBody?: boolean
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
    expandBody = false,
    actions = true,
    hideCommunity = false,
    pinned = false,
    view = settings.view,
    style = '',
    class: clazz = '',
    extraBadges: additionalBadges,
  }: Props = $props()

  let tags = $derived(
    settings.parseTags
      ? parseTags(post.record?.title)
      : { tags: [] as readonly MetaTag[], title: post.record?.title },
  )
  let type = $derived(mediaType(post.embed))
  let sensitive = $derived(hasNSFWLabel(post.record?.labels))
  let nativeImage = $derived(
    post.embed?.$type === 'social.coves.embed.images#view',
  )
  let previewImage = $derived(
    nativeImage ? bestImageURL(post.embed, false, 'thumb') : '',
  )
  let postUri = $derived(post.uri)
  let revealedPost = $state<string>()
  let concealed = $derived(
    sensitive && settings.nsfwBlur && revealedPost !== post.uri,
  )
  const sensitiveContentId = $props.id()
  const sensitiveBannerId = `${sensitiveContentId}-banner`
  $effect(() => {
    // Reset only when the row represents another post, not when its data refreshes.
    void postUri
    revealedPost = undefined
  })
  let embedUrl = $derived(extractEmbedUrl(post.embed))
  let embedTitle = $derived(extractEmbedTitle(post.embed))
  let hideTitle = $derived(
    !concealed &&
      settings.posts.deduplicateEmbed &&
      !!post.record?.title &&
      embedTitle === post.record.title &&
      view !== 'compact' &&
      type !== 'iframe',
  )

  // Coves posts may legitimately have no title. Cozy/list views render the
  // body below the meta row, but compact rows would show no text at all — so
  // fall back to a plain-text body excerpt there. Everywhere else the title
  // slot simply stays empty.
  let compactExcerpt = $derived(
    view == 'compact' && !concealed
      ? postTextFallback(post.record?.content)
      : undefined,
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
      : tags.title || post.record?.title || compactExcerpt}
    style="grid-area: meta;"
    edited={post.editedAt}
    tags={tags.tags}
    postUrl={embedUrl}
    {view}
  >
    {#snippet extraBadges()}
      {#if sensitive}
        <Badge color="red-subtle">{$t('post.badges.nsfw')}</Badge>
      {/if}
      {@render additionalBadges?.()}
    {/snippet}
  </PostMeta>
  {#if sensitive && settings.nsfwBlur}
    <Button
      id={sensitiveBannerId}
      color="none"
      size="custom"
      shadow="none"
      alignment="left"
      style="grid-area: sensitive;"
      class="my-2 w-full min-h-16 px-4 py-4 gap-3 bg-slate-100 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-300 transition-colors"
      aria-label={$t(concealed ? 'post.sensitive.show' : 'post.sensitive.hide')}
      aria-expanded={!concealed}
      aria-controls={sensitiveContentId}
      onclick={() => (revealedPost = concealed ? post.uri : undefined)}
    >
      <Icon src={Info} size="20" class="shrink-0" />
      <span>{$t('post.sensitive.label')}</span>
      <span class="ms-auto shrink-0 text-slate-900 dark:text-zinc-100">
        {$t(
          concealed ? 'post.sensitive.showAction' : 'post.sensitive.hideAction',
        )}
      </span>
    </Button>
  {/if}
  <div id={sensitiveContentId} class="contents">
    {#if concealed && nativeImage}
      <Button
        color="none"
        size="custom"
        shadow="none"
        alignment="center"
        rounding="2xl"
        style="grid-area: {view === 'compact' ? 'media' : 'embed'};"
        class={[
          'relative isolate overflow-hidden border border-slate-200 dark:border-zinc-700 bg-slate-200 dark:bg-zinc-900',
          view === 'compact'
            ? ['w-22 h-22 sm:w-28', settings.leftAlign ? 'me-3' : 'ms-3']
            : 'w-full',
        ]}
        aria-label={$t('post.sensitive.show')}
        aria-expanded={false}
        aria-controls={sensitiveContentId}
        onclick={() => {
          revealedPost = post.uri
          document
            .getElementById(sensitiveBannerId)
            ?.focus({ preventScroll: true })
        }}
      >
        {#if previewImage}
          <img
            src={previewImage}
            alt=""
            aria-hidden="true"
            loading="lazy"
            class="absolute inset-0 h-full w-full object-cover pointer-events-none"
            style="filter: blur(32px); transform: scale(1.2);"
          />
          {#if view !== 'compact'}
            <img
              src={previewImage}
              alt=""
              aria-hidden="true"
              loading="lazy"
              width={512}
              height={300}
              class="max-w-full max-h-[60vh] object-contain mx-auto pointer-events-none"
              style="filter: blur(32px);"
            />
          {/if}
        {/if}
        <span
          class={[
            'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex w-max max-w-[calc(100%_-_1rem)] items-center gap-3 rounded-xl bg-black/75 text-white border border-white/20 font-medium pointer-events-none',
            view === 'compact'
              ? 'px-1 py-2 text-xs flex-col gap-1'
              : 'px-4 py-3 text-base',
          ]}
        >
          <Icon src={Info} size="20" class="shrink-0" />
          <span>{$t('post.sensitive.label')}</span>
          <span>
            {$t('post.sensitive.showAction')}
          </span>
        </span>
      </Button>
    {:else if !concealed}
      {#key embedUrl}
        <div
          style="grid-area:embed;"
          class={{
            contents: view === 'cozy' && !nativeImage,
            '[&>*]:block [&>*]:w-full': view === 'cozy' && nativeImage,
          }}
        >
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
          collapsible={!expandBody}
          body={post.record.content}
          facets={post.record.facets}
          style="grid-area: body"
          class="relative"
        />
      {/if}
    {/if}
  </div>
  {#if actions}
    <PostActions bind:post style="grid-area: actions;" {view} />
  {/if}
</article>

<style>
  .list-type {
    display: grid;
    grid-template-areas: 'meta media' 'title media' 'sensitive media' 'body media' 'embed embed' 'actions actions';
    grid-template-columns: minmax(0, 1fr) auto;
    width: 100%;
    height: 100%;
  }

  /* Swap media/item positions */
  .list-type.left-align {
    grid-template-areas: 'media meta' 'media title' 'media sensitive' 'media body' 'embed embed' 'actions actions';
    grid-template-columns: auto minmax(0, 1fr);
  }

  /* Has media on the right for all of them */
  @media (min-width: 480px) {
    .list-type.compact {
      grid-template-areas: 'meta media' 'title media' 'sensitive media' 'body media' 'embed media' 'actions media';
    }
  }

  /* Swap above again */
  @media (min-width: 480px) {
    .list-type.compact.left-align {
      grid-template-areas: 'media meta' 'media title' 'media sensitive' 'media body' 'media embed' 'media actions';
    }
  }

  :global(.compact > *:not(.no-list-margin):not(:first-child)) {
    margin-top: 0.3rem;
  }

  :global(.list-type:not(.compact) > *:not(.no-list-margin):not(:first-child)) {
    margin-top: 0.5rem;
  }
</style>
