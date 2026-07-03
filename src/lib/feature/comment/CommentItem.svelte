<script lang="ts">
  import type { CommentView } from '$lib/api/coves/types'
  import { t } from '$lib/app/i18n'
  import type { ClassValue } from 'svelte/elements'
  import Comment from './Comment.svelte'
  import {
    deletedContentPlaceholder,
    type NormalizedCommentView,
  } from './comments.svelte'

  interface Props {
    comment: CommentView
    meta?: boolean
    class?: string
    commentClass?: ClassValue
    actions?: boolean
  }

  let {
    comment,
    meta = true,
    class: clazz = '',
    commentClass = '',
    actions = true,
    ...rest
  }: Props = $props()

  // Deleted-comment tombstones arrive with a null record; synthesize a
  // placeholder record so Comment can read record.* unconditionally.
  let normalized = $derived<NormalizedCommentView>({
    ...comment,
    record: comment.record ?? {
      $type: 'social.coves.community.comment',
      content: deletedContentPlaceholder(),
      reply: { root: comment.post, parent: comment.parent ?? comment.post },
      createdAt: comment.createdAt,
    },
  })
</script>

<div class={['flex flex-col flex-1 rounded-none list-none', clazz]}>
  {#if meta}
    <!-- No jump-to-comment button — there is no Coves comment permalink yet. -->
    <div class="flex flex-row items-center gap-2">
      <span class="text-sm text-slate-500 dark:text-zinc-400">
        {$t('comment.reply')}
      </span>
    </div>
  {/if}
  <Comment
    node={{ children: [], comment: normalized, depth: 1, expanded: true }}
    postRef={comment.post}
    replying={false}
    {meta}
    {actions}
    {...rest}
    class={commentClass}
  />
</div>
