<script lang="ts">
  import type { PostView } from '$lib/api/coves/types'
  import type { ClassValue } from 'svelte/elements'

  let {
    post = $bindable(),
    class: clazz = '',
  }: { post: PostView; class?: ClassValue } = $props()
</script>

<span data-post-uri={post.uri} class={clazz}>{post.uri}</span>
