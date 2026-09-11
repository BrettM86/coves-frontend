<script lang="ts">
  import type { CommentView } from '$lib/api/coves/types'
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import { report } from '$lib/feature/moderation/moderation.svelte'
  import { commentLink, type PostLinkRef } from '$lib/feature/post'
  import {
    action,
    Button,
    Menu,
    MenuButton,
    MenuDivider,
    modal,
    toast,
  } from '$lib/ui/kit'
  import {
    Ellipsis,
    Flag,
    MessageSquare,
    Forward,
    SquarePen,
    Trash2,
  } from '$lib/ui/kit/icon'
  import { deletedContentPlaceholder } from './comments.svelte'
  import {
    EMPTY_COMMENT_STATS,
    EMPTY_COMMENT_VIEWER,
    VoteButton,
  } from '$lib/feature/vote'

  interface Props {
    comment: CommentView
    /**
     * Post the comment belongs to, supplying the community and owner segments
     * of the permalink. When absent there is no addressable comment URL, so
     * the share action is hidden.
     */
    post?: PostLinkRef
    replying?: boolean
    disabled?: boolean
    onedit?: (comment: CommentView) => void
  }

  let {
    comment = $bindable(),
    post,
    replying = $bindable(false),
    disabled = false,
    onedit,
  }: Props = $props()

  let shareUrl = $derived(
    post ? commentLink(post, comment.uri, comment.author) : undefined,
  )

  async function deleteComment(): Promise<void> {
    if (!profile.current?.jwt) {
      throw new Error($t('toast.sessionExpired'))
    }
    // Refresh can remove this bound tree slot while the request is pending.
    const target = comment
    await coves().deleteComment({ uri: target.uri })
    target.isDeleted = true
    if (target.record) {
      target.record.content = deletedContentPlaceholder()
    }
  }

  function confirmDelete(): void {
    modal({
      title: $t('post.actions.more.delete'),
      body: $t('post.actions.more.deleteCommentConfirm'),
      actions: [
        action({
          content: $t('post.actions.more.delete'),
          action: deleteComment,
          type: 'danger',
          close: true,
        }),
        action({
          content: $t('common.cancel'),
          close: true,
        }),
      ],
    })
  }
</script>

<div
  class={[
    'flex flex-row items-center gap-0.5 w-full',
    settings.posts.reverseActions && 'flex-row-reverse',
  ]}
>
  <VoteButton
    uri={comment.uri}
    cid={comment.cid}
    bind:stats={comment.stats}
    bind:viewer={comment.viewer}
    emptyStats={EMPTY_COMMENT_STATS}
    emptyViewer={EMPTY_COMMENT_VIEWER}
    variant="comment"
  >
    <Button
      color="tertiary"
      rounding="pill"
      size="sm"
      class="text-slate-500 dark:text-zinc-400 gap-1!"
      onclick={() => (replying = !replying)}
      disabled={disabled || !profile.current?.jwt}
      icon={MessageSquare}
    >
      {$t('comment.reply')}
    </Button>
  </VoteButton>
  <Menu placement="bottom">
    {#snippet target(attachment)}
      <Button
        {@attach attachment}
        title={$t('comment.actions.label')}
        color="tertiary"
        rounding="pill"
        size="square-md"
        class="text-slate-600 dark:text-zinc-400"
        icon={Ellipsis}
      ></Button>
    {/snippet}
    {#if shareUrl}
      <MenuButton
        onclick={async () => {
          try {
            const url = new URL(shareUrl, location.origin).toString()
            if (navigator.share) {
              await navigator.share({ url })
            } else {
              await navigator.clipboard.writeText(url)
              toast({ content: $t('toast.copied'), type: 'success' })
            }
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return
            toast({
              content: err instanceof Error ? err.message : String(err),
              type: 'error',
            })
          }
        }}
        icon={Forward}
      >
        {$t('post.actions.more.share')}
      </MenuButton>
    {/if}
    {#if profile.current?.jwt}
      <!-- `author` is absent on deleted-comment tombstones, so `?.` keeps
           the identity check from throwing (and correctly hides edit/delete
           for tombstones — there is no author to match). -->
      {#if profile.current?.did && profile.current.did === comment.author?.did}
        <MenuButton
          disabled={comment.isDeleted}
          onclick={() => onedit?.(comment)}
          icon={SquarePen}
        >
          {$t('post.actions.more.edit')}
        </MenuButton>
      {/if}
      {#if profile.current?.did && profile.current.did === comment.author?.did}
        <MenuButton
          disabled={comment.isDeleted}
          color="danger-subtle"
          onclick={confirmDelete}
          icon={Trash2}
        >
          {$t('post.actions.more.delete')}
        </MenuButton>
      {/if}
      <MenuDivider>{$t('settings.moderation.title')}</MenuDivider>
      <MenuButton
        onclick={() => report(comment)}
        color="danger-subtle"
        icon={Flag}
      >
        {$t('moderation.report')}
      </MenuButton>
    {/if}
  </Menu>
  <div class="flex-1 w-full"></div>
</div>
