<script lang="ts">
  import { browser } from '$app/environment'
  import { onDestroy, onMount } from 'svelte'

  // https://github.com/sveltejs/svelte/issues/3088#issuecomment-505785516

  let slottedElements = $state<HTMLDivElement>(),
    portal: HTMLDivElement

  onMount(() => {
    if (!browser) return
    portal = document?.createElement('div')
    if (portal) portal.className = 'portal-mount'
    document?.body.appendChild(portal)
    if (slottedElements) portal?.appendChild(slottedElements)
  })

  onDestroy(() => {
    portal.remove()
  })

  interface Props {
    class?: string
    children?: import('svelte').Snippet
  }

  let { class: clazz = '', children }: Props = $props()
</script>

<div class="portal-initial-mount-point">
  <div bind:this={slottedElements} class="portal-content {clazz || ''}">
    {@render children?.()}
  </div>
</div>

<style>
  .portal-initial-mount-point {
    display: none;
  }
</style>
