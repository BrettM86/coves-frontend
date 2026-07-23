<script lang="ts">
  import { isSafeHref, localizeLink } from './plugins'

  interface Props {
    href?: string
    title?: string
    children?: import('svelte').Snippet
  }

  let { href = '', title = undefined, children }: Props = $props()

  let safe = $derived(isSafeHref(href))
  let localized = $derived(localizeLink(href))
</script>

{#if safe}
  <a
    href={localized ?? href}
    {title}
    class="hover:underline text-blue-600 dark:text-blue-400"
  >
    {@render children?.()}
  </a>
{:else}
  {@render children?.()}
{/if}
