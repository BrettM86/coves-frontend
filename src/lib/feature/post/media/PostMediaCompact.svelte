<script lang="ts">
  import type { PostEmbed } from '$lib/api/coves/types'
  import { t } from '$lib/app/state/i18n'
  import { settings, type View } from '$lib/app/state/settings.svelte'
  import { showImage } from '$lib/ui/generic/ExpandableImage.svelte'
  import { Button, Modal, modal } from '$lib/ui/kit'
  import {
    Icon,
    FileText,
    Image,
    Link,
    TriangleAlert,
    Video,
  } from '$lib/ui/kit/icon'
  import {
    bestImageURL,
    extractEmbedAlt,
    extractEmbedThumbnail,
    getBlueskyPostEmbed,
    type MediaType,
  } from '../helpers'
  import BlueskyButterfly from './BlueskyButterfly.svelte'
  import BlueskyPostCard from './BlueskyPostCard.svelte'

  const thumbnailSize = (view: View) =>
    view == 'compact' ? 'w-22 h-22 sm:w-28' : 'w-24 h-24 sm:w-32'

  interface Props {
    embed?: PostEmbed
    type?: MediaType
    view?: View
    blur?: boolean
    style?: string
    class?: string
  }

  let {
    embed,
    type = 'none',
    view = 'cozy',
    blur = false,
    style = '',
    class: clazz = '',
  }: Props = $props()

  let size = $derived(thumbnailSize(view))
  let blueskyOpen = $state(false)
  let blueskyEmbed = $derived(getBlueskyPostEmbed(embed))
  $effect(() => {
    if (blur) blueskyOpen = false
  })
  let genericThumbnailUrl = $derived(extractEmbedThumbnail(embed))
  let imageSource = $derived(
    bestImageURL(embed, !!genericThumbnailUrl && type !== 'image', 'thumb'),
  )
  let altText = $derived(extractEmbedAlt(embed))
  let imageTile = $derived(type === 'image')
  let hasThumbnail = $derived(!!genericThumbnailUrl || type === 'image')

  function expandImage(): void {
    if (type === 'image' && embed)
      showImage(bestImageURL(embed, false, 'fullsize'))
  }
</script>

<!--
  @component
  Thumbnails for compact and list view posts.
-->
<div class={[size, 'relative group/media', clazz]} {style} role="presentation">
  {#if blueskyEmbed}
    <button
      type="button"
      class="grid h-full w-full cursor-pointer place-items-center rounded-2xl border border-bluesky-border bg-bluesky-surface text-bluesky-brand transition-colors hover:bg-bluesky-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bluesky-link"
      aria-label={$t('post.bluesky.openPost')}
      aria-haspopup="dialog"
      aria-expanded={blueskyOpen}
      disabled={blur}
      onclick={() => (blueskyOpen = true)}
    >
      <BlueskyButterfly width={32} height={29} />
    </button>
    {#if blueskyOpen && !blur}
      <Modal
        bind:open={blueskyOpen}
        title={null}
        label={$t('post.bluesky.previewLabel')}
        closeLabel={$t('post.bluesky.closePost')}
        class="max-w-[480px]! max-h-full border-0! bg-transparent! p-0! pt-10! shadow-none!"
      >
        <div class="shrink-0">
          <BlueskyPostCard embed={blueskyEmbed} />
        </div>
      </Modal>
    {/if}
  {:else}
    <svelte:element
      this={!settings.expandImages || !imageTile ? 'div' : 'button'}
      aria-label={imageTile
        ? $t('aria.postDecor.openImage', { default: altText ?? 'Image' })
        : $t('aria.postDecor.openPost', { default: 'Post' })}
      onclick={expandImage}
      role={imageTile ? 'button' : 'presentation'}
      tabindex={imageTile ? 0 : -1}
      class="cursor-pointer h-full block"
    >
      <div
        class={[
          'relative overflow-hidden rounded-2xl max-h-full h-full',
          'border border-slate-200 dark:border-zinc-800 hover-scale-effect bg-slate-200 dark:bg-zinc-800',
        ]}
      >
        {#if hasThumbnail}
          <img
            src={blur ? '' : imageSource}
            loading="lazy"
            class={[
              'object-cover relative overflow-hidden rounded-xl h-full',
              size,
            ]}
            alt={altText ?? ' '}
            class:blur-xl={blur}
          />
          {#if !imageTile}
            <div
              class={[
                'absolute w-8 h-8 bottom-1 left-1 rounded-xl bg-slate-25 dark:bg-zinc-900 grid place-items-center',
              ]}
            >
              <Icon src={type === 'iframe' ? Video : Link} size="16" />
            </div>
          {/if}
        {:else}
          {@const typeIconMap = new Map([
            ['embed', Link],
            ['iframe', Video],
          ])}
          <div
            class={[
              'bg-slate-100 dark:bg-zinc-900 w-full h-full rounded-xl grid place-items-center',
              'text-slate-600 dark:text-zinc-400',
            ]}
          >
            <Icon src={typeIconMap.get(type) ?? FileText} size="32" />
          </div>
        {/if}
      </div>
      {#if blur}
        <Icon
          src={TriangleAlert}
          size="32"
          class="absolute w-8 h-8 mx-auto my-auto z-30 inset-0 opacity-30"
        />
      {/if}
    </svelte:element>
    {#if altText}
      <Button
        onclick={() => modal({ title: 'Alt text', body: altText })}
        aria-label="Alt text"
        class="absolute bottom-0 left-0 z-20 m-1"
        size="square-md"
        rounding="xl"
      >
        <Icon src={Image} size="16" />
      </Button>
    {/if}
  {/if}
</div>

<style>
  .hover-scale-effect > * {
    transition: transform 200ms var(--ease-cubic);
  }
  .hover-scale-effect:hover > * {
    transform: scale(95%);
  }
  .hover-scale-effect:active > * {
    transform: scale(90%);
  }
</style>
