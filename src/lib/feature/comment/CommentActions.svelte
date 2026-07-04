<script lang="ts">
  import type { CommentView } from '$lib/api/coves/types'
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/auth.svelte'
  import { errorMessage } from '$lib/app/error'
  import { t } from '$lib/app/i18n'
  import { settings } from '$lib/app/settings.svelte'
  import { report } from '$lib/feature/moderation/moderation.svelte'
  import {
    commentLink,
    postLinkRefFromUri,
    type PostLinkRef,
  } from '$lib/feature/post'
  import { Button, Menu, MenuButton, toast } from 'mono-svelte'
  import {
    ChatBubbleOvalLeft,
    EllipsisHorizontal,
    Flag,
    PencilSquare,
    Share,
    Trash,
  } from 'svelte-hero-icons/dist'
  import { deletedContentPlaceholder } from './comments.svelte'
  import CommentVote from './CommentVote.svelte'

  interface Props {
    comment: CommentView
    /**
     * Post the comment belongs to — yields a handle-based permalink slug.
     * When absent, the share link falls back to a DID slug derived from the
     * comment's post ref (see {@link postLinkRefFromUri}).
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
    commentLink(post ?? postLinkRefFromUri(comment.post.uri), comment.uri),
  )
</script>

<div
  class={[
    'flex flex-row items-center gap-0.5 w-full',
    settings.posts.reverseActions && 'flex-row-reverse',
  ]}
>
  <CommentVote
    uri={comment.uri}
    cid={comment.cid}
    bind:stats={comment.stats}
    bind:viewer={comment.viewer}
  />
  <Button
    color="tertiary"
    rounding="pill"
    size="sm"
    class="text-slate-500 dark:text-zinc-400 gap-1!"
    onclick={() => (replying = !replying)}
    disabled={disabled || !profile.current?.jwt}
    icon={ChatBubbleOvalLeft}
  >
    {$t('comment.reply')}
  </Button>
  <Menu placement="bottom">
    {#snippet target(attachment)}
      <Button
        {@attach attachment}
        title={$t('comment.actions.label')}
        color="tertiary"
        rounding="pill"
        size="square-md"
        class="text-slate-600 dark:text-zinc-400"
        icon={EllipsisHorizontal}
      ></Button>
    {/snippet}
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
      icon={Share}
    >
      {$t('post.actions.more.share')}
    </MenuButton>
    {#if profile.current?.jwt}
      {#if profile.current?.did && profile.current.did === comment.author.did}
        <MenuButton
          disabled={comment.isDeleted}
          onclick={() => onedit?.(comment)}
          icon={PencilSquare}
        >
          {$t('post.actions.more.edit')}
        </MenuButton>
      {/if}
      {#if profile.current?.did && profile.current.did === comment.author.did}
        <MenuButton
          disabled={comment.isDeleted}
          color="danger-subtle"
          onclick={async () => {
            if (!profile.current?.jwt) {
              toast({ content: $t('toast.sessionExpired'), type: 'warning' })
              return
            }
            try {
              await coves().deleteComment({ uri: comment.uri })
              comment.isDeleted = true
              if (comment.record) {
                comment.record.content = deletedContentPlaceholder()
              }
            } catch (err) {
              toast({
                content: errorMessage(err),
                type: 'error',
              })
            }
          }}
          icon={Trash}
        >
          {$t('post.actions.more.delete')}
        </MenuButton>
      {/if}
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
