<script lang="ts">
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Heart from '@lucide/svelte/icons/heart'
  import MessageCircle from '@lucide/svelte/icons/message-circle'
  import Repeat2 from '@lucide/svelte/icons/repeat-2'
  import { onMount } from 'svelte'
  import type { RecordEmbed } from '$lib/api/coves/types'
  import { locale, t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import { normalizeBlueskyPost, type BlueskyPostView } from './bluesky-card'
  import { formatBlueskyTimestamp } from './bluesky-time'
  import BlueskyButterfly from './BlueskyButterfly.svelte'

  interface Props {
    embed: RecordEmbed
  }

  let { embed }: Props = $props()
  let post = $derived(
    normalizeBlueskyPost(embed, $t('post.bluesky.unavailable')),
  )
  let failedSources = $state<string[]>([])
  let target = $derived(settings.openLinksInNewTab ? '_blank' : undefined)
  const rel = 'noopener noreferrer nofollow'
  let now = $state<number | null>(null)

  onMount(() => {
    now = Date.now()
    const timer = setInterval(() => {
      now = Date.now()
    }, 60_000)
    return () => clearInterval(timer)
  })

  const imageFailed = (source: string): boolean =>
    failedSources.includes(source)

  function markImageFailed(source: string): void {
    if (!imageFailed(source)) failedSources = [...failedSources, source]
  }
</script>

{#snippet butterfly()}
  <BlueskyButterfly />
{/snippet}

{#snippet cardContent(current: BlueskyPostView, allowQuote: boolean)}
  <div
    class="post-content"
    class:feed-post={allowQuote && current.kind === 'success'}
  >
    {#if current.kind === 'success'}
      {@const visibleImages = current.images.filter(
        (image) => !imageFailed(image.thumb),
      )}
      {@const mediaCount = Math.max(current.mediaCount, current.images.length)}
      <header
        class="post-header flex min-w-0 items-center gap-1 text-[15px] leading-5"
      >
        <a
          href={current.author.profileUrl}
          {target}
          {rel}
          class="post-avatar grid shrink-0 place-items-center overflow-hidden rounded-full bg-bluesky-border text-sm font-semibold text-white"
          aria-label={$t('post.bluesky.viewProfile', {
            name: current.author.displayName,
          })}
        >
          {#if current.author.avatar && !imageFailed(current.author.avatar)}
            <img
              src={current.author.avatar}
              alt={$t('post.bluesky.avatar', {
                name: current.author.displayName,
              })}
              class="h-full w-full object-cover"
              onerror={() => markImageFailed(current.author.avatar ?? '')}
            />
          {:else}
            <span aria-hidden="true">
              {current.author.displayName.slice(0, 1)}
            </span>
          {/if}
        </a>

        <a
          href={current.author.profileUrl}
          {target}
          {rel}
          class="flex min-w-0 items-baseline gap-1 no-underline"
          aria-label={$t('post.bluesky.viewProfile', {
            name: current.author.displayName,
          })}
        >
          <div class="max-w-[70%] shrink-0 truncate font-semibold text-white">
            {current.author.displayName}
          </div>
          <div class="truncate text-bluesky-muted">
            @{current.author.handle ?? current.author.did}
          </div>
        </a>

        {#if current.createdAt}
          {@const timestamp = formatBlueskyTimestamp(
            current.createdAt,
            now,
            $locale,
          )}
          <span class="text-bluesky-muted" aria-hidden="true">·</span>
          <time
            class="shrink-0 whitespace-nowrap text-bluesky-muted"
            datetime={current.createdAt}
            title={timestamp.label}
          >
            <span aria-hidden="true">{timestamp.text}</span>
            <span class="sr-only">{timestamp.label}</span>
          </time>
        {/if}

        <a
          href={current.author.profileUrl}
          {target}
          {rel}
          class="post-brand ml-auto shrink-0 text-bluesky-brand"
          aria-label={$t('post.bluesky.viewProfile', {
            name: current.author.displayName,
          })}
        >
          {@render butterfly()}
        </a>
      </header>

      {#if current.text}
        <p class="mt-1 whitespace-pre-wrap break-words text-[15px] leading-5">
          {current.text}
        </p>
      {/if}

      {#if visibleImages.length > 0}
        <div
          class="post-images mt-2"
          class:multiple-images={visibleImages.length > 1}
        >
          {#each visibleImages as image}
            <a
              href={image.fullsize}
              {target}
              {rel}
              class="post-image block min-h-0 min-w-0"
              aria-label={image.alt || $t('post.bluesky.viewImage')}
            >
              <img
                src={image.thumb}
                alt={image.alt}
                width={image.aspectRatio?.width}
                height={image.aspectRatio?.height}
                class="block h-auto w-auto max-w-full rounded-xl"
                loading="lazy"
                onerror={() => markImageFailed(image.thumb)}
              />
            </a>
          {/each}
        </div>
      {:else if (current.hasMedia || current.images.length > 0) && mediaCount > 0}
        <div
          class="mt-3 rounded-xl border border-bluesky-border px-3 py-2 text-sm text-bluesky-muted"
        >
          {$t('post.bluesky.media', { count: mediaCount })}
        </div>
      {/if}

      {#if current.external}
        <a
          href={current.external.uri}
          {target}
          {rel}
          class="mt-3 flex overflow-hidden rounded-xl border border-bluesky-border text-white no-underline"
          aria-label={current.external.title ?? current.external.domain}
        >
          {#if current.external.thumb && !imageFailed(current.external.thumb)}
            <img
              src={current.external.thumb}
              alt=""
              class="h-20 w-20 shrink-0 object-cover"
              loading="lazy"
              onerror={() => markImageFailed(current.external?.thumb ?? '')}
            />
          {/if}
          <div class="min-w-0 p-3">
            <div class="truncate text-xs text-bluesky-muted">
              {current.external.domain}
            </div>
            {#if current.external.title}
              <div class="mt-1 font-semibold">{current.external.title}</div>
            {/if}
            {#if current.external.description}
              <p class="mt-1 line-clamp-2 text-sm text-bluesky-muted">
                {current.external.description}
              </p>
            {/if}
          </div>
        </a>
      {/if}

      {#if allowQuote && current.quotedPost}
        <section
          class="mt-3 rounded-xl border border-bluesky-border p-3"
          aria-label={$t('post.bluesky.quotedPost')}
        >
          {@render cardContent(current.quotedPost, false)}
        </section>
      {/if}

      <div
        class="mt-2 grid max-w-80 grid-cols-3 items-center py-1 text-[13px] leading-5 text-bluesky-muted"
      >
        <span
          role="img"
          class="flex min-w-0 items-center gap-1 tabular-nums"
          aria-label={$t('post.bluesky.replies', { count: current.replyCount })}
        >
          <MessageCircle
            size={18}
            strokeWidth={2}
            class="shrink-0"
            aria-hidden="true"
          />
          {current.replyCount}
        </span>
        <span
          role="img"
          class="flex min-w-0 items-center gap-1 tabular-nums"
          aria-label={$t('post.bluesky.reposts', {
            count: current.repostCount,
          })}
        >
          <Repeat2
            size={18}
            strokeWidth={2}
            class="shrink-0"
            aria-hidden="true"
          />
          {current.repostCount}
        </span>
        <span
          role="img"
          class="flex min-w-0 items-center gap-1 tabular-nums"
          aria-label={$t('post.bluesky.likes', { count: current.likeCount })}
        >
          <Heart
            size={18}
            strokeWidth={2}
            class="shrink-0"
            aria-hidden="true"
          />
          {current.likeCount}
        </span>
      </div>
    {:else}
      <div class="flex items-center gap-2 font-semibold">
        <span class="shrink-0 text-bluesky-brand">{@render butterfly()}</span>
        <span>Bluesky</span>
      </div>
      <p class="mt-2 text-bluesky-muted">{current.message}</p>
    {/if}

    {#if current.originalUrl}
      <a
        href={current.originalUrl}
        {target}
        {rel}
        class="ml-auto mt-1 flex w-fit items-center gap-1 py-1 text-[13px] leading-5 text-bluesky-muted no-underline transition-colors hover:text-bluesky-link focus-visible:text-bluesky-link"
      >
        {$t('post.bluesky.viewOriginal')}
        <ExternalLink size={13} aria-hidden="true" />
      </a>
    {/if}
  </div>
{/snippet}

<article
  class="w-full max-w-[480px] overflow-hidden rounded-xl border border-bluesky-border bg-bluesky-surface p-3 font-inter text-white"
  aria-label={$t('post.bluesky.cardLabel')}
>
  {@render cardContent(post, true)}
</article>

<style>
  .post-content {
    position: relative;
    min-width: 0;
  }

  .feed-post {
    padding-left: 52px;
  }

  .post-avatar {
    width: 20px;
    height: 20px;
  }

  .feed-post > .post-header > .post-avatar {
    position: absolute;
    top: 0;
    left: 0;
    width: 42px;
    height: 42px;
  }

  .post-brand :global(svg) {
    width: 18px;
    height: 17px;
  }

  .post-images {
    container-type: inline-size;
  }

  .post-image {
    width: fit-content;
    max-width: 100%;
  }

  .post-image img {
    max-height: min(100cqw, 45svh, 360px);
  }

  .multiple-images {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
    gap: 4px;
  }

  .multiple-images .post-image img {
    max-height: min(50cqw, 22svh, 178px);
  }
</style>
