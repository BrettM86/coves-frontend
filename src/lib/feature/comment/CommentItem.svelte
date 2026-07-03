<script lang="ts">
  import type { CommentView } from '$lib/api/coves/types'
  import { t } from '$lib/app/i18n'
  import { Button } from 'mono-svelte'
  import { ArrowUturnUp, Icon } from 'svelte-hero-icons/dist'
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
    <div class="flex flex-row justify-between items-center gap-2">
      <div class="flex flex-col gap-2">
        <span class="text-sm text-slate-500 dark:text-zinc-400">
          {$t('comment.reply')}
        </span>
      </div>
      <Button
        color="primary"
        rounding="pill"
        size="sm"
        href="/comment/{encodeURIComponent(comment.uri as string)}"
        class="self-start"
      >
        {$t('common.jump')}
        <Icon src={ArrowUturnUp} size="14" micro />
      </Button>
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
