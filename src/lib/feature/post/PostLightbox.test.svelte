<script lang="ts">
  import type { PostView } from '$lib/api/coves/types'
  import type { View } from '$lib/app/state/settings.svelte'
  import ExpandableImage from '$lib/ui/generic/ExpandableImage.svelte'
  import Post from './Post.svelte'

  let {
    post,
    expandBody,
    view,
  }: { post: PostView; expandBody: boolean; view: View } = $props()
</script>

<!-- A post and the app-wide lightbox, as the layout mounts them. -->
<div data-testid="post">
  <Post {post} {expandBody} {view} actions={false} />
</div>
<div data-testid="lightbox"><ExpandableImage /></div>
