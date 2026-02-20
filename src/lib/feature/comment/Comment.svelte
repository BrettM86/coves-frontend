<script lang="ts">
  import { page } from '$app/state'
  import type { StrongRef } from '$lib/api/coves/types'
  import type { DID } from '$lib/types/atproto'
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import Markdown from '$lib/app/markdown/Markdown.svelte'
  import { settings } from '$lib/app/settings.svelte'
  import { publishedToDate } from '$lib/ui/util/date'
  import { Button, Modal, toast } from 'mono-svelte'
  import RelativeDate from 'mono-svelte/util/RelativeDate.svelte'
  import { Icon, Microphone, Minus, Plus, Trash } from 'svelte-hero-icons/dist'
  import { expoOut } from 'svelte/easing'
  import type { ClassValue } from 'svelte/elements'
  import { slide } from 'svelte/transition'
  import UserLink from '../user/UserLink.svelte'
  import CommentActions from './CommentActions.svelte'
  import CommentForm from './CommentForm.svelte'
  import {
    type CommentNodeI,
    createOptimisticCommentView,
  } from './comments.svelte'

  interface Props {
    node: CommentNodeI
    postRef: StrongRef
    postAuthorDid?: DID
    actions?: boolean
    meta?: boolean
    open?: boolean
    replying?: boolean
    contentClass?: ClassValue
    class?: ClassValue
    metaSuffix?: import('svelte').Snippet
    children?: import('svelte').Snippet
  }

  let {
    node = $bindable(),
    postRef,
    postAuthorDid,
    actions = true,
    meta = true,
    replying = $bindable(false),
    open = $bindable(true),
    contentClass = '',
    class: clazz = '',
    metaSuffix,
    children,
  }: Props = $props()

  let editing = $state(false)
  let newComment = $state(node.comment.record.content)
  let editingLoad = $state(false)

  async function save() {
    if (!profile.current?.jwt || newComment.length <= 0) return

    editingLoad = true

    try {
      // TODO(coves-migration): Implement edit comment when backend API is available
      toast({
        content: 'Editing comments is not yet supported.',
        type: 'warning',
      })
      editing = false
    } catch (err) {
      toast({
        content: err instanceof Error ? err.message : String(err),
        type: 'error',
      })
    }

    editingLoad = false
  }
</script>

{#if editing}
  <Modal bind:open={editing}>
    {#snippet customTitle()}
      <div>{$t('form.edit')}</div>
    {/snippet}
    <form
      onsubmit={(e) => {
        e.preventDefault()
        save()
      }}
      class="contents"
    >
      <CommentForm
        bind:value={newComment}
        {postRef}
        actions={false}
        preview={true}
      />
      <Button
        submit
        color="primary"
        size="lg"
        loading={editingLoad}
        disabled={editingLoad}
        class="w-full"
      >
        {$t('form.submit')}
      </Button>
    </form>
  </Modal>
{/if}

<li class={['py-3 relative', clazz]} id={node.comment.uri as string}>
  {#if meta}
    {@const creatorIsOp =
      postAuthorDid !== undefined && node.comment.author.did === postAuthorDid}
    <label
      for="comment-expand-{node.comment.uri}"
      class="flex flex-row cursor-pointer gap-2 items-center group text-sm flex-wrap w-full z-0 group relative"
    >
      <div
        class={[
          'absolute -inset-0.5 right-1 group-hover:right-0 group-hover:-inset-1.5 opacity-0 group-hover:opacity-100 transition-all',
          'bg-slate-100 dark:bg-zinc-900 -z-10 rounded-full inline-flex items-center justify-end',
        ]}
      >
        {#if node.comment.stats.replyCount > 0}
          {@const replyCount = node.comment.stats.replyCount}
          <div
            aria-label={$t('aria.comments.children', {
              childCount: replyCount,
            })}
            class="font-medium"
          >
            {replyCount}
          </div>
        {/if}
        <div
          class={[
            !open && 'rotate-90',
            'transition-all duration-500 ease-out my-auto h-full w-8 grid place-items-center',
          ]}
        >
          <Icon src={open ? Minus : Plus} size="16" micro />
        </div>
      </div>
      {@render metaSuffix?.()}
      <span
        class={[
          'flex flex-row gap-1 items-center',
          creatorIsOp && 'text-blue-600 dark:text-blue-400 font-bold',
        ]}
      >
        <UserLink inComment avatarSize={20} avatar user={node.comment.author} />
      </span>
      {#if creatorIsOp}
        <Icon
          mini
          size="16"
          src={Microphone}
          class="text-blue-500 dark:text-blue-400"
        />
      {/if}
      <RelativeDate
        class="text-slate-600 dark:text-zinc-400"
        date={publishedToDate(node.comment.createdAt)}
      />
      <span class="text-slate-600 dark:text-zinc-400 flex flex-row gap-2 ml-1">
        {#if node.comment.isDeleted}
          <Icon
            src={Trash}
            solid
            size="12"
            aria-label={$t('post.badges.deleted')}
            class="text-red-600 dark:text-red-500"
          />
        {/if}
        {#if node.comment.deletionReason}
          <Icon
            src={Trash}
            solid
            size="12"
            aria-label={$t('post.badges.removed')}
            class="text-green-600 dark:text-green-500"
          />
        {/if}
      </span>
      {#if settings.debugInfo}
        <span class="text-slate-600 dark:text-zinc-400 font-mono ml-auto">
          {node.comment.uri}
        </span>
      {/if}
    </label>
  {/if}
  <input
    class="appearance-none absolute top-0 left-0 h-8 w-full pointer-events-none comment-expand"
    type="checkbox"
    id="comment-expand-{node.comment.uri}"
    bind:checked={open}
  />
  <div class={['expand max-w-full', contentClass]} inert={!open}>
    <div id="comment-content">
      <div
        class={[
          'flex flex-col whitespace-pre-wrap max-w-full gap-1 mt-1 relative w-full',
        ]}
      >
        <Markdown
          source={node.comment.record.content}
          noStyle
          class={[
            'text-[15px] sm:text-base text-slate-700 dark:text-zinc-300 *:leading-[1.6] break-words space-y-3',
            page.url.hash.slice(1) === (node.comment.uri as string) &&
              'material-info px-3 py-1.5 rounded-xl max-w-max',
          ]}
        />
        {#if actions}
          <!-- TODO(coves-migration): Re-enable ban/lock checking when API provides banned_from_community and post.locked fields -->
          <CommentActions
            comment={node.comment}
            bind:replying
            onedit={() => (editing = true)}
            disabled={false}
          />
        {/if}
      </div>

      {#if replying}
        <div transition:slide={{ duration: 600, easing: expoOut }}>
          <CommentForm
            label={$t('comment.reply')}
            {postRef}
            parentRef={{ uri: node.comment.uri, cid: node.comment.cid }}
            oncomment={(output, content) => {
              const currentProfile = profile.current
              if (!currentProfile || currentProfile.type !== 'authenticated') {
                replying = false
                return
              }
              const comment = createOptimisticCommentView(
                output,
                content,
                postRef,
                { uri: node.comment.uri, cid: node.comment.cid },
                {
                  did: currentProfile.did,
                  handle: currentProfile.handle,
                  avatar: currentProfile.avatar,
                },
              )
              node.children = [
                {
                  children: [],
                  comment,
                  depth: node.depth + 1,
                  expanded: true,
                },
                ...node.children,
              ]
              replying = false
            }}
            oncancel={() => (replying = false)}
          />
        </div>
      {/if}
      {@render children?.()}
    </div>
  </div>
</li>

<style>
  .expand {
    display: grid;
    grid-template-rows: 0fr;
    grid-template-columns: 100%;
    overflow: hidden;
    transition: grid-template-rows 0.5s cubic-bezier(0.19, 1, 0.22, 1);
  }

  .comment-expand:checked + .expand {
    grid-template-rows: 1fr;
  }

  .expand > * {
    min-height: 0;
  }
</style>
