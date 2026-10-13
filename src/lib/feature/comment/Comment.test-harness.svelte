<script lang="ts">
  import type { CommentView, StrongRef } from '$lib/api/coves/types'
  import { untrack } from 'svelte'
  import Comment from './Comment.svelte'
  import { buildCommentsTree } from './comments.svelte'

  let {
    initialComment,
    postRef,
    initiallyReplying = false,
  }: {
    initialComment: CommentView
    postRef: StrongRef
    initiallyReplying?: boolean
  } = $props()

  const [initialNode] = untrack(() =>
    buildCommentsTree([{ comment: initialComment, replies: [] }]),
  )
  if (!initialNode) throw new Error('Missing comment node')
  let node = $state(initialNode)
  let replying = $state(untrack(() => initiallyReplying))

  /** Replace the comment in place, as a refresh or a delete would. */
  export function replaceComment(comment: CommentView) {
    const [next] = buildCommentsTree([{ comment, replies: [] }])
    if (!next) throw new Error('Missing comment node')
    node.comment = next.comment
  }
</script>

<Comment bind:node {postRef} bind:replying />
