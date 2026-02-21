<script lang="ts">
  import type { PostEmbed } from '$lib/api/coves/types'
  import { settings } from '$lib/app/settings.svelte'
  import { showImage } from '$lib/ui/generic/ExpandableImage.svelte'
  import { Button, modal } from 'mono-svelte'
  import { onMount } from 'svelte'
  import { bestImageURL, extractEmbedAlt } from '../helpers'

  interface Props {
    embed: PostEmbed
    blur?: boolean
  }

  let { embed, blur = false }: Props = $props()

  let imageLoaded: boolean | null = $state(null)
  onMount(() => {
    imageLoaded = false
  })

  let altText = $derived(extractEmbedAlt(embed))
  let fullImageUrl = $derived(bestImageURL(embed, false, 'fullsize'))
</script>

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
  <!-- svelte-ignore a11y_missing_attribute -->
  <div class="inset-0 absolute -z-10 rounded-xl overflow-hidden">
    <img
      loading="lazy"
      fetchpriority="auto"
      src={bestImageURL(embed, false, 'thumb')}
      class=" object-cover w-full h-full opacity-50 blur-lg"
    />
  </div>
  <picture class="max-h-[60vh]">
    <source
      srcset={bestImageURL(embed, false, 'thumb')}
      media="(max-width: 800px)"
    />
    <source
      srcset={bestImageURL(embed, false, 'fullsize')}
      media="(min-width: 801px)"
    />
    <img
      src={blur ? '' : fullImageUrl}
      loading="lazy"
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
