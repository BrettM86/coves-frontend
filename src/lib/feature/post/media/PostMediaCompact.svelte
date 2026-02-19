<script lang="ts">
  import type { PostEmbed } from '$lib/api/coves/types'
  import { t } from '$lib/app/i18n'
  import { settings, type View } from '$lib/app/settings.svelte'
  import { showImage } from '$lib/ui/generic/ExpandableImage.svelte'
  import { Button, modal } from 'mono-svelte'
  import {
    DocumentText,
    ExclamationTriangle,
    Icon,
    Link,
    Photo,
    VideoCamera,
  } from 'svelte-hero-icons/dist'
  import {
    bestImageURL,
    extractEmbedAlt,
    extractEmbedThumbnail,
    type MediaType,
  } from '../helpers'

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
  let thumbnailUrl = $derived(extractEmbedThumbnail(embed))
  let altText = $derived(extractEmbedAlt(embed))
  let hasThumbnail = $derived(!!thumbnailUrl || type === 'image')
</script>

<!--
  @component
  Thumbnails for compact and list view posts.
-->
<div class={[size, 'relative group/media', clazz]} {style} role="presentation">
  <svelte:element
    this={!settings.expandImages || type !== 'image' ? 'div' : 'button'}
    aria-label={type === 'image'
      ? $t('aria.postDecor.openImage', { default: altText ?? 'Image' })
      : $t('aria.postDecor.openPost', { default: 'Post' })}
    onclick={() => {
      if (type === 'image' && embed) showImage(bestImageURL(embed, false, -1))
    }}
    role={type === 'image' ? 'button' : 'presentation'}
    tabindex={type === 'image' ? 0 : -1}
    class="cursor-pointer h-full block"
  >
    <div
      class={[
        'relative overflow-hidden rounded-2xl max-h-full h-full',
        'border border-slate-200 dark:border-zinc-800 hover-scale-effect bg-slate-200 dark:bg-zinc-800',
      ]}
    >
      {#if hasThumbnail}
        {@const useThumbnail = !!thumbnailUrl && type !== 'image'}
        <picture>
          {#each ['webp'] as format}
            <source
              srcset="{bestImageURL(
                embed,
                useThumbnail,
                128,
                format as 'avif' | 'webp',
              )} 1x, {bestImageURL(
                embed,
                useThumbnail,
                256,
                format as 'avif' | 'webp',
              )} 2x, {bestImageURL(
                embed,
                useThumbnail,
                512,
                format as 'avif' | 'webp',
              )} 3x"
              media="(min-width: 0px)"
              type="image/{format}"
            />
          {/each}
          <img
            src={blur ? '' : bestImageURL(embed, useThumbnail, -1, null)}
            loading="lazy"
            class={[
              'object-cover relative overflow-hidden rounded-xl h-full',
              size,
            ]}
            alt={altText ?? ' '}
            class:blur-xl={blur}
          />
        </picture>
        {#if type !== 'image'}
          <div
            class={[
              'absolute w-8 h-8 bottom-1 left-1 rounded-xl bg-slate-25 dark:bg-zinc-900 grid place-items-center',
            ]}
          >
            <Icon
              src={type === 'iframe' ? VideoCamera : Link}
              micro
              size="16"
            />
          </div>
        {/if}
      {:else}
        {@const typeIconMap = new Map([
          ['embed', Link],
          ['iframe', VideoCamera],
        ])}
        <div
          class={[
            'bg-slate-100 dark:bg-zinc-900 w-full h-full rounded-xl grid place-items-center',
            'text-slate-600 dark:text-zinc-400',
          ]}
        >
          <Icon src={typeIconMap.get(type) ?? DocumentText} solid size="32" />
        </div>
      {/if}
    </div>
    {#if blur}
      <Icon
        src={ExclamationTriangle}
        solid
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
      <Icon src={Photo} size="16" micro />
    </Button>
  {/if}
</div>

<style>
  .hover-scale-effect > *,
  .hover-scale-effect > picture > img {
    transition: transform 200ms var(--ease-cubic);
  }
  .hover-scale-effect:hover > *,
  .hover-scale-effect:hover > picture > img {
    transform: scale(95%);
  }
  .hover-scale-effect:active > *,
  .hover-scale-effect:active > picture > img {
    transform: scale(90%);
  }
</style>
