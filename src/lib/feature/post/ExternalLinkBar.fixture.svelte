<script lang="ts">
  import ExternalLinkBar from './ExternalLinkBar.svelte'

  let { initialUri }: { initialUri: string } = $props()

  // Seeded once; the test then drives it through setUri.
  // svelte-ignore state_referenced_locally
  let uri = $state(initialUri)

  /** Change the bar's `uri` prop on the same mounted instance. */
  export function setUri(next: string): void {
    uri = next
  }
</script>

<ExternalLinkBar {uri} />
