<script lang="ts">
  // @ts-nocheck
  import { localizeLink } from './plugins'

  interface Props {
    href?: string
    title?: string
    children?: import('svelte').Snippet
  }

  let { href = '', title = undefined, children }: Props = $props()

  export const parseURL = (href: string) => {
    try {
      return new URL(href)
    } catch {
      return undefined
    }
  }

  let localized = $derived(localizeLink(href))
</script>

<a
  href={localized ?? href}
  {title}
  class="hover:underline text-blue-600 dark:text-blue-400"
>
  {@render children?.()}
</a>
