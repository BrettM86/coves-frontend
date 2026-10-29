<script lang="ts">
  import type { PostEmbed } from '$lib/api/coves/types'
  import ExpandableImage from '$lib/ui/generic/ExpandableImage.svelte'
  import RichText from './RichText.svelte'

  let {
    content,
    facets,
    embed,
  }: { content: string; facets: unknown[]; embed: PostEmbed } = $props()
</script>

<!-- A body with placed images and the app-wide lightbox, as the layout mounts them. -->
<div data-testid="body"><RichText {content} {facets} {embed} /></div>
<div data-testid="lightbox"><ExpandableImage /></div>
