<script lang="ts">
  import type { EmbedImage } from '$lib/api/coves/types'
  import ExpandableImage from '$lib/ui/generic/ExpandableImage.svelte'
  import PostGallery from './PostGallery.svelte'

  let { images }: { images: EmbedImage[] } = $props()
</script>

<!-- A post's gallery and the app-wide lightbox, as the layout mounts them. -->
<div data-testid="gallery"><PostGallery {images} /></div>
<div data-testid="lightbox"><ExpandableImage /></div>
