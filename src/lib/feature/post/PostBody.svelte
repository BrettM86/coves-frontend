<script lang="ts">
  import Markdown from '$lib/app/markdown/Markdown.svelte'
  import RichText from '$lib/app/richtext/RichText.svelte'
  import { hasFacets } from '$lib/app/richtext/facets'
  import { Button } from 'mono-svelte'
  import { ChevronDoubleDown, Icon } from 'svelte-hero-icons/dist'
  import type { ClassValue } from 'svelte/elements'

  const MAX_HEIGHT = 192

  let element = $state<Element>()

  function isOverflown(element: Element) {
    if (!element) return false

    return element.scrollHeight > MAX_HEIGHT
  }

  interface Props {
    body: string
    /** Rich text facets from the record; when present the body is rendered
     * as canonical plaintext with facet annotations instead of markdown. */
    facets?: unknown[]
    clickThrough?: boolean
    element?: string
    style?: string
    class?: ClassValue
  }

  let {
    body,
    facets = undefined,
    clickThrough = false,
    element: htmlElement = 'div',
    style = '',
    class: clazz = '',
  }: Props = $props()

  let overflows = $derived(element ? isOverflown(element) : false)

  let expanded = $state(false)
  $effect(() => {
    expanded = !overflows
  })
</script>

<svelte:element
  this={htmlElement}
  {style}
  class={[
    expanded
      ? 'text-slate-600 dark:text-zinc-400 max-h-full'
      : [
          'overflow-hidden bg-linear-to-b text-transparent from-slate-600 via-slate-600',
          'dark:from-zinc-400 dark:via-zinc-400 bg-clip-text z-0 max-h-36',
        ],
    clickThrough && 'pointer-events-none',
    clazz,
  ]}
  bind:this={element}
>
  {#if hasFacets(facets)}
    <!-- Facets are byte offsets into the exact content, so slicing when
         collapsed would misalign annotations (and could split multi-byte
         chars). The full body always renders; the collapsed max-height
         clamps it visually. -->
    <RichText content={body} {facets} />
  {:else}
    <Markdown source={expanded ? body : body.slice(0, 1000)} />
  {/if}
  {#if overflows}
    <Button
      onclick={() => (expanded = !expanded)}
      size="square-md"
      color="ghost"
      class={[
        'text-black dark:text-white absolute z-10 isolate pointer-events-auto left-0 bottom-0 transition-colors',
        'left-1/2 -translate-x-1/2 mb-4 hover:backdrop-blur-lg bg-slate-100 dark:bg-zinc-900/70',
        expanded && 'shadow-md rotate-180 sticky bottom-16',
      ]}
      title="Expand"
    >
      <Icon src={ChevronDoubleDown} size="20" mini />
    </Button>
  {/if}
</svelte:element>
