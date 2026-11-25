<script lang="ts">
  import type { LikedComment } from '$lib/api/coves/types'
  import { t } from '$lib/app/state/i18n'
  import Comment from '$lib/feature/comment/Comment.svelte'
  import CommentTree from '$lib/feature/comment/CommentTree.svelte'
  import type { ClassValue } from 'svelte/elements'
  import { LikedCommentNode } from './likedCommentNode.svelte'
  import { profileCommentHref } from './tabs'

  interface Props {
    item: LikedComment
    class?: ClassValue
  }

  let { item = $bindable(), class: clazz }: Props = $props()

  let node = $state(new LikedCommentNode(() => item))

  // A deleted comment names no author, so it gets no permalink or post (whose
  // share URL would name them).
  const live = $derived(!item.comment.isDeleted)
  const href = $derived(
    live && item.comment.author
      ? profileCommentHref(item.comment, item.post)
      : undefined,
  )
  const postRef = $derived({ uri: item.post.uri, cid: item.post.cid })
</script>

<!-- Comment renders its own <li>, the row itself. -->
<Comment
  bind:node
  {postRef}
  post={live ? item.post : undefined}
  postAuthorDid={item.post.author.did}
  class={clazz}
>
  {#if href}
    <a {href} class="text-xs text-slate-500 dark:text-zinc-400 hover:underline">
      {$t('comment.permalink.context')}
    </a>
  {/if}
  {#if node.children.length > 0}
    <CommentTree
      post={item.post}
      {postRef}
      postAuthorDid={item.post.author.did}
      bind:nodes={node.children}
    />
  {/if}
</Comment>
