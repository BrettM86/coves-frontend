<script lang="ts">
  import type { CommentView } from '$lib/api/coves/types'
  import { untrack } from 'svelte'
  import CommentActions from './CommentActions.svelte'

  let { initialComment }: { initialComment: CommentView } = $props()
  let comments = $state(untrack(() => [initialComment]))

  export function currentComment() {
    const comment = comments[0]
    if (!comment) throw new Error('Missing comment fixture')
    return comment
  }

  export function removeComment() {
    comments = []
  }
</script>

{#each comments as comment, index (comment.uri)}
  <CommentActions bind:comment={comments[index]} />
{/each}
