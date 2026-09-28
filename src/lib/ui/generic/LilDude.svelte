<script lang="ts">
  // A URL, not `?raw`: inlining put 32 kB of SVG markup into the root layout's
  // JS and into every server-rendered page. As a file it is content-hashed,
  // cached for a year, and skipped entirely where the sidebar is hidden.
  import mascotUrl from '$lib/assets/lil_dude.svg'
  import type { ClassValue } from 'svelte/elements'

  interface Props {
    width?: number
    class?: ClassValue
  }

  let { width = 48, class: clazz = '' }: Props = $props()

  // Natural SVG dimensions: 689w x 638h
  const height = $derived(Math.round(width * (638 / 689)))
</script>

<img
  src={mascotUrl}
  class={clazz}
  {width}
  {height}
  alt="Coves mascot"
  loading="lazy"
  decoding="async"
/>
