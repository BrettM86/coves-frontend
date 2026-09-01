<script lang="ts">
  import type { IconProps, LucideIcon } from '@lucide/svelte'

  interface Props extends IconProps {
    /** The Lucide icon component to render. */
    src: LucideIcon
  }

  let { src: Src, ...rest }: Props = $props()

  // Icons are decorative unless the caller labels them for assistive tech.
  const decorative = $derived(!rest['aria-label'] && !rest.title)
</script>

<Src aria-hidden={decorative ? true : undefined} {...rest} />
