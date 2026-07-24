<script lang="ts">
  import svgContent from '$lib/assets/lil_dude.svg?raw'
  import type { ClassValue } from 'svelte/elements'

  interface Props {
    width?: number
    class?: ClassValue
  }

  let { width = 48, class: clazz = '' }: Props = $props()

  // Natural SVG dimensions: 689w x 638h
  const height = $derived(Math.round(width * (638 / 689)))
</script>

<div
  class={clazz}
  style="width: {width}px; height: {height}px;"
  role="img"
  aria-label="Coves mascot"
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- static bundled SVG asset, no user input -->
  {@html svgContent}
</div>

<style>
  div :global(svg) {
    width: 100%;
    height: 100%;
  }
</style>
