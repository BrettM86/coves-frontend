<script lang="ts">
  import type { PostView } from '$lib/api/coves/types'

  let { post = $bindable() }: { post: PostView } = $props()
</script>

<span data-testid="home-page-post" data-post-uri={post.uri}>{post.uri}</span>
