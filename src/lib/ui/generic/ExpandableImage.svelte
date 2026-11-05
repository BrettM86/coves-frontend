<script lang="ts" module>
  import { pushState, replaceState } from '$app/navigation'
  import { page } from '$app/state'
  import { isImageSourceUrl } from '$lib/api/coves/image-proxy'
  import { t } from '$lib/app/state/i18n'
  import { Button, Material, toast } from '$lib/ui/kit'
  import { ChevronLeft, ChevronRight, Forward, X } from '$lib/ui/kit/icon'
  import { backOut } from 'svelte/easing'
  import { SvelteSet } from 'svelte/reactivity'
  import { fade, scale } from 'svelte/transition'
  import { trapFocus } from 'trap-focus-svelte'
  import ImageUnavailable from './ImageUnavailable.svelte'

  export interface LightboxImage {
    url: string
    alt?: string
  }

  /** Opens the lightbox on `images`, showing the one at `index`. */
  export function showImage(images: LightboxImage[], index: number) {
    pushState('', {
      openImages: images,
      openImageIndex: index,
    })
  }
</script>

<script lang="ts">
  let images = $derived(page.state.openImages ?? [])
  let index = $derived(
    Math.min(Math.max(page.state.openImageIndex ?? 0, 0), images.length - 1),
  )
  let current = $derived(images[index])
  let url = $derived(
    current && isImageSourceUrl(current.url) ? current.url : undefined,
  )
  /** URLs that failed to load: each shows the placeholder, not a broken image. */
  const failed = new SvelteSet<string>()
  let overlay = $state<HTMLDivElement>()

  // Stepping onto an image with no usable URL removes the focused share
  // button, which drops focus to <body> where the overlay's keys go unheard.
  $effect(() => {
    if (url || !overlay || overlay.contains(document.activeElement)) return
    overlay.querySelector<HTMLElement>('[data-lightbox-close]')?.focus()
  })

  /**
   * Steps through the images, wrapping at either end. It replaces the history
   * entry instead of pushing one, so a single Back still closes the lightbox.
   */
  function step(by: number) {
    replaceState('', {
      ...page.state,
      openImageIndex: (index + by + images.length) % images.length,
    })
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key == 'Escape') history.back()
    else if (event.key == 'ArrowLeft' && images.length > 1) step(-1)
    else if (event.key == 'ArrowRight' && images.length > 1) step(1)
  }
</script>

{#if current}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed top-0 left-0 w-screen h-svh overflow-auto bg-white/50 dark:bg-black/50
    flex flex-col z-100 backdrop-blur-xs"
    transition:fade={{ duration: 150 }}
    onclick={() => history.back()}
    {onkeydown}
    use:trapFocus
    bind:this={overlay}
  >
    {#if url && !failed.has(url)}
      <img
        width={800}
        height={800}
        src={url}
        class="max-w-full max-h-svh w-auto h-auto object-contain mx-auto my-auto overscroll-contain bg-white dark:bg-zinc-900"
        transition:scale={{ start: 1.04, easing: backOut, duration: 250 }}
        alt={current.alt ?? ''}
        onerror={() => failed.add(url)}
      />
    {:else}
      <div class="mx-auto my-auto aspect-[4/3] w-full max-w-[800px]">
        <ImageUnavailable />
      </div>
    {/if}
    {#if current.alt}
      <p
        class="mx-auto max-w-[800px] px-4 pb-16 pt-2 text-sm whitespace-pre-wrap text-slate-900 dark:text-zinc-100"
      >
        {current.alt}
      </p>
    {/if}
    <div class="sticky z-10 bottom-4 left-1/2 -translate-x-1/2 w-max">
      <Material
        class="gap-1 p-0.5 px-1 flex flex-row items-center"
        rounding="full"
        padding="none"
        color="uniform"
        onclick={(e) => e.stopPropagation()}
      >
        {#if url}
          <Button
            onclick={() => {
              navigator.clipboard.writeText(url ?? '')
              toast({ content: $t('toast.copied') })
            }}
            color="tertiary"
            size="square-lg"
            rounding="pill"
            aria-label={$t('post.actions.more.share')}
            icon={Forward}
          ></Button>
        {/if}
        <Button
          onclick={() => history.back()}
          color="tertiary"
          size="square-lg"
          rounding="pill"
          aria-label={$t('common.back')}
          icon={X}
          data-lightbox-close
        ></Button>
      </Material>
    </div>
    {#if images.length > 1}
      <Button
        onclick={(e) => {
          e.stopPropagation()
          step(-1)
        }}
        color="tertiary"
        size="square-lg"
        rounding="pill"
        class="fixed left-4 top-1/2 z-10 -translate-y-1/2"
        aria-label={$t('aria.lightbox.previous')}
        icon={ChevronLeft}
      ></Button>
      <Button
        onclick={(e) => {
          e.stopPropagation()
          step(1)
        }}
        color="tertiary"
        size="square-lg"
        rounding="pill"
        class="fixed right-4 top-1/2 z-10 -translate-y-1/2"
        aria-label={$t('aria.lightbox.next')}
        icon={ChevronRight}
      ></Button>
    {/if}
  </div>
{/if}
