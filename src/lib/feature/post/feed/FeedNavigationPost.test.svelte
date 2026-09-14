<script lang="ts">
  import type { PostView } from '$lib/api/coves/types'
  import { postLink } from '$lib/feature/post/helpers'

  interface Props {
    post: PostView
  }

  let { post = $bindable() }: Props = $props()
</script>

<a data-link="post" href={postLink(post)}>Post permalink</a>
<a data-link="comments" href="{postLink(post)}#comments">Comments permalink</a>
<a data-link="download" href={postLink(post)} download>Download permalink</a>
<a data-link="rel-external" href={postLink(post)} rel="external">
  External-relation permalink
</a>
<span data-sveltekit-reload>
  <a data-link="reload" href={postLink(post)}>Reload permalink</a>
</span>
<a data-link="external" href="https://outside.test/post" target="_blank">
  External link
</a>
<a data-link="non-post" href="#profile">Profile link</a>
