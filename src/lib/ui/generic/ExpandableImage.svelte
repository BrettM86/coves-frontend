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
  import PageDots from './PageDots.svelte'

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
  /**
   * URLs whose file is taller than 1:2, such as a comic strip. Fitting one to
   * the viewport height would shrink it past reading, so it keeps only the
   * width cap and the overlay scrolls.
   */
  const tall = new SvelteSet<string>()
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
    class="fixed top-0 left-0 w-screen h-svh overflow-auto bg-white/80 dark:bg-black/80
    flex flex-col z-100 backdrop-blur-md pt-8 pb-20"
    transition:fade={{ duration: 150 }}
    onclick={() => history.back()}
    {onkeydown}
    use:trapFocus
    bind:this={overlay}
  >
    <!-- The arrows and dots sit on the image itself, so they follow its size. -->
    <div class="relative mx-auto my-auto w-fit max-w-full">
      {#if url && !failed.has(url)}
        <img
          width={800}
          height={800}
          src={url}
          class={[
            'block max-w-[calc(100vw-2rem)] md:max-w-[min(90vw,calc(100vw-10rem))] w-auto h-auto object-contain rounded-xl shadow-2xl overscroll-contain bg-white dark:bg-zinc-900',
            !tall.has(url) && 'max-h-[min(80svh,calc(100svh-10rem))]',
          ]}
          transition:scale={{ start: 1.04, easing: backOut, duration: 250 }}
          alt={current.alt ?? ''}
          onload={(event) => {
            const { naturalWidth, naturalHeight } =
              event.currentTarget as HTMLImageElement
            if (naturalHeight > naturalWidth * 2) tall.add(url)
          }}
          onerror={() => failed.add(url)}
        />
      {:else}
        <!-- The md width cap matches the img's, so the arrows outside it stay
             on screen. -->
        <div
          class="aspect-[4/3] w-[min(800px,calc(100vw-2rem))] md:max-w-[min(90vw,calc(100vw-10rem))]"
        >
          <ImageUnavailable />
        </div>
      {/if}
      {#if images.length > 1}
        <PageDots
          class="absolute bottom-3 left-1/2 -translate-x-1/2"
          count={images.length}
          {index}
          label={$t('aria.lightbox.position', {
            index: index + 1,
            count: images.length,
          })}
        />
        <Button
          onclick={(e) => {
            e.stopPropagation()
            step(-1)
          }}
          color="tertiary"
          size="square-xl"
          rounding="pill"
          class="absolute left-2 top-1/2 z-10 -translate-y-1/2 md:-left-16 bg-[#262626]/90! text-[#fff8f0]! hover:bg-[#262626]!"
          aria-label={$t('aria.lightbox.previous')}
          icon={ChevronLeft}
        ></Button>
        <Button
          onclick={(e) => {
            e.stopPropagation()
            step(1)
          }}
          color="tertiary"
          size="square-xl"
          rounding="pill"
          class="absolute right-2 top-1/2 z-10 -translate-y-1/2 md:-right-16 bg-[#262626]/90! text-[#fff8f0]! hover:bg-[#262626]!"
          aria-label={$t('aria.lightbox.next')}
          icon={ChevronRight}
        ></Button>
      {/if}
    </div>
    {#if current.alt}
      <p
        class="mx-auto max-w-[800px] px-4 pt-2 text-sm whitespace-pre-wrap text-slate-900 dark:text-zinc-100"
      >
        {current.alt}
      </p>
    {/if}
    <div class="fixed z-10 bottom-4 left-1/2 -translate-x-1/2 w-max">
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
  </div>
{/if}
