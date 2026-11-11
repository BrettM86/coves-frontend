<script lang="ts" module>
  import lemmyUrl from '$lib/assets/lemmy.svg'
  import piefedUrl from '$lib/assets/piefed.svg'
  import { settings } from '$lib/app/state/settings.svelte'

  const logos = new Map([
    ['lemmy', { src: lemmyUrl, alt: 'Lemmy' }],
    ['piefed', { src: piefedUrl, alt: 'PieFed' }],
  ])

  /**
   * The logo to show for `software`, or `undefined` when there is no bundled
   * logo or the user has turned off `showSoftwareLogos`. Reactive to settings.
   */
  export function softwareLogo(
    software: string | undefined,
  ): { src: string; alt: string } | undefined {
    if (!settings.showSoftwareLogos) return undefined
    return logos.get(software?.toLowerCase() ?? '')
  }
</script>

<script lang="ts">
  import type { ClassValue } from 'svelte/elements'

  interface Props {
    /** Nodeinfo software name of the community's home instance. */
    software?: string
    class?: ClassValue
  }

  let { software, class: clazz = '' }: Props = $props()

  const logo = $derived(softwareLogo(software))
</script>

<!--
  @component
  Small inline logo for a community's home software. Renders nothing for
  software without a bundled logo, or when the user has turned off
  `showSoftwareLogos`.
-->
{#if logo}
  <img
    src={logo.src}
    alt={logo.alt}
    width="19"
    height="19"
    class={['inline-block size-[1.33em] shrink-0', clazz]}
    decoding="async"
  />
{/if}
