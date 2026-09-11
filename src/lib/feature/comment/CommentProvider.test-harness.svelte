<script lang="ts">
  import type { PostView, ThreadViewComment } from '$lib/api/coves/types'
  import { untrack } from 'svelte'
  import CommentProvider from './CommentProvider.svelte'

  let {
    initialPost,
    initialComments,
  }: {
    initialPost: PostView
    initialComments: ThreadViewComment[]
  } = $props()
  let post = $state(untrack(() => initialPost))
  let comments = $state(untrack(() => initialComments))

  export function refresh(nextComments: ThreadViewComment[]) {
    comments = nextComments
  }

  export function navigate(nextPost: PostView) {
    post = nextPost
    comments = []
  }
</script>

<output aria-label="Comment count">{post.stats?.commentCount ?? 0}</output>
<CommentProvider bind:post {comments} virtualize={false} />
