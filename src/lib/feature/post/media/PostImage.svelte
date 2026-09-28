<script lang="ts">
  import type { PostEmbed } from '$lib/api/coves/types'
  import { settings } from '$lib/app/state/settings.svelte'
  import { showImage } from '$lib/ui/generic/ExpandableImage.svelte'
  import { Button, modal } from '$lib/ui/kit'
  import { onMount } from 'svelte'
  import { bestImageURL, extractEmbedAlt } from '../helpers'

  interface Props {
    embed: PostEmbed
    blur?: boolean
    /** The likely largest paint (first feed row, a post page): fetch now. */
    priority?: boolean
  }

  let { embed, blur = false, priority = false }: Props = $props()

  let img = $state<HTMLImageElement>()
  let imageLoaded: boolean | null = $state(null)
  onMount(() => {
    // A server-rendered image can finish before hydration, and its load event
    // is then already spent: hiding it until one arrives would hide it for
    // good.
    imageLoaded = img?.complete ?? false
  })

  let altText = $derived(extractEmbedAlt(embed))
  let previewUrl = $derived(bestImageURL(embed, false, 'thumb'))
  let fullImageUrl = $derived(bestImageURL(embed, false, 'fullsize'))
</script>

<!--
  The backdrop and the image offer the same candidates under the same
  conditions, so the browser picks one file and uses it twice. The backdrop
  used to always load the preview while wide screens loaded the full size:
  two downloads per image. Above 800px the full size is only chosen when the
  screen's density needs it. The wide source has no media query: the first
  match wins, and `(min-width: 801px)` left a zoomed 800.5px viewport with no
  source at all.
-->
{#snippet sources()}
  <source srcset={previewUrl} media="(max-width: 800px)" />
  <source srcset="{previewUrl} 800w, {fullImageUrl} 1600w" sizes="800px" />
{/snippet}

<!--disabled preloads here since most people will hover over every image while scrolling-->
<svelte:element
  this={settings.expandImages ? 'button' : 'div'}
  class={[
    'container/a z-10 rounded-2xl cursor-pointer relative overflow-hidden',
    'bg-slate-100 dark:bg-zinc-900 transition-colors',
    'border border-slate-200 dark:border-zinc-800 group',
  ]}
  data-sveltekit-preload-data="off"
  aria-label={altText ?? 'Image'}
  onclick={() => showImage(fullImageUrl)}
  role="button"
  tabindex="0"
>
  <picture class="inset-0 absolute -z-10 rounded-xl overflow-hidden">
    {@render sources()}
    <img
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      src={previewUrl}
      alt=""
      class=" object-cover w-full h-full opacity-50 blur-lg"
    />
  </picture>
  <picture class="max-h-[60vh]">
    {@render sources()}
    <img
      bind:this={img}
      src={blur ? '' : fullImageUrl}
      loading={priority ? 'eager' : 'lazy'}
      fetchpriority={priority ? 'high' : 'auto'}
      decoding="async"
      class={[
        'max-w-full rounded-xl z-30 transition-all max-h-[60vh] duration-500 object-contain mx-auto group-hover:scale-98 group-active:scale-95',
        'duration-200 ease-cubic',
        imageLoaded === false ? 'opacity-0' : 'opacity-100',
        blur && 'blur-3xl',
      ]}
      width={512}
      height={300}
      alt={altText ?? ''}
      onload={() => (imageLoaded = true)}
      onerror={() => (imageLoaded = true)}
    />
  </picture>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="absolute bottom-0 left-0 right-0 flex justify-between items-center
        rounded-full ml-auto w-max m-2 p-0 gap-1
        *:bg-white *:border *:border-slate-200 dark:*:border-zinc-800 dark:*:bg-zinc-900"
    onclick={(e) => e.stopPropagation()}
  >
    {#if altText}
      <Button
        onclick={(e) => {
          e.stopPropagation()
          modal({
            title: 'Alt',
            body: altText ?? '',
          })
        }}
        color="tertiary"
        size="md"
        rounding="pill"
      >
        ALT
      </Button>
    {/if}
  </div>
</svelte:element>
