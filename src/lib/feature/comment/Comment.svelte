<script lang="ts">
  import { page } from '$app/state'
  import { coves } from '$lib/api/client.svelte'
  import type { StrongRef } from '$lib/api/coves/types'
  import { parseAtUri } from '$lib/api/coves/types'
  import type { DID } from '$lib/types/atproto'
  import { profile } from '$lib/app/state/auth.svelte'
  import { errorMessage } from '$lib/app/util/error'
  import { log } from '$lib/app/util/log'
  import { t } from '$lib/app/state/i18n'
  import Markdown from '$lib/feature/markdown/Markdown.svelte'
  import RichText from '$lib/feature/richtext/RichText.svelte'
  import { hasFacets } from '$lib/feature/richtext/facets'
  import { settings } from '$lib/app/state/settings.svelte'
  import type { PostLinkRef } from '$lib/feature/post'
  import { publishedToDate } from '$lib/ui/util/date'
  import { Button, Modal, toast } from '$lib/ui/kit'
  import RelativeDate from '$lib/ui/util/RelativeDate.svelte'
  import { Icon, Mic, Minus, Plus, Trash2 } from '$lib/ui/kit/icon'
  import { expoOut } from 'svelte/easing'
  import type { ClassValue } from 'svelte/elements'
  import { slide } from 'svelte/transition'
  import UserLink from '../user/UserLink.svelte'
  import CommentActions from './CommentActions.svelte'
  import CommentForm from './CommentForm.svelte'
  import { buildCommentUpdate, editorSourceFor } from './comment-submit'
  import {
    type CommentNodeI,
    createOptimisticCommentView,
  } from './comments.svelte'

  interface Props {
    node: CommentNodeI
    postRef: StrongRef
    /** Post link ref for handle-based share permalinks (see CommentActions). */
    post?: PostLinkRef
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
    post,
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
  // The editor works in markup, so an existing comment is serialized back into
  // it: what the author sees is what recompiles to the stored record.
  let newComment = $state(editorSourceFor(node.comment.record))
  let editingLoad = $state(false)

  // Stable anchor id (`comment-<rkey>`) so permalinks can deep-link to this
  // comment via a `#comment-<rkey>` URL fragment.
  const domId = $derived(`comment-${parseAtUri(node.comment.uri).rkey}`)

  // Shared by the RichText and Markdown body branches.
  const bodyClass = $derived([
    'text-[15px] sm:text-base text-slate-700 dark:text-zinc-300 *:leading-[1.6] break-words space-y-3',
    page.url.hash.slice(1) === domId &&
      'material-info px-3 py-1.5 rounded-xl max-w-max',
  ])

  async function save() {
    if (node.comment.isDeleted) return
    if (!profile.current?.jwt) {
      toast({ content: $t('toast.sessionExpired'), type: 'warning' })
      return
    }
    if (newComment.trim() === '') {
      toast({ content: 'Comment cannot be empty.', type: 'warning' })
      return
    }

    editingLoad = true

    try {
      // The edit is recompiled from the editor source rather than reusing the
      // stored facets, which index the old text. The update is a full record
      // replace, so everything the edit does not touch is carried through.
      const input = await buildCommentUpdate({
        source: newComment,
        uri: node.comment.uri,
        record: node.comment.record,
        resolver: coves(),
      })
      const response = await coves().updateComment(input)
      // Mirror exactly what the server now stores, so the re-render can't
      // apply old byte offsets to the new content.
      node.comment.record.content = input.content
      node.comment.record.facets = input.facets
      node.comment.cid = response.cid
      editing = false
    } catch (err) {
      log.error('[Comment] update failed', err)
      toast({
        content: errorMessage(err),
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
    <div class="contents">
      <CommentForm
        bind:value={newComment}
        {postRef}
        actions={false}
        preview={true}
        editing={true}
        onconfirm={save}
      />
      <Button
        onclick={save}
        color="primary"
        size="lg"
        loading={editingLoad}
        disabled={editingLoad}
        class="w-full"
      >
        {$t('form.submit')}
      </Button>
    </div>
  </Modal>
{/if}

<li class={['py-3 relative', clazz]} id={domId}>
  {#if meta}
    {@const creatorIsOp =
      !node.comment.isDeleted &&
      postAuthorDid !== undefined &&
      node.comment.author?.did === postAuthorDid}
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
          <Icon src={open ? Minus : Plus} size="16" />
        </div>
      </div>
      {@render metaSuffix?.()}
      {#if node.comment.isDeleted || !node.comment.author}
        <!-- Deleted-comment tombstones omit `author` entirely (older
             backends sent the real DID with an empty handle); rendering
             UserLink would de-anonymize the deleted comment or crash on
             the missing author, so show the placeholder instead. -->
        <span class="text-slate-500 dark:text-zinc-400 italic">
          {$t('comment.deletedAuthor')}
        </span>
      {:else}
        <span
          class={[
            'flex flex-row gap-1 items-center',
            creatorIsOp && 'text-blue-600 dark:text-blue-400 font-bold',
          ]}
        >
          <UserLink avatarSize={20} avatar user={node.comment.author} />
        </span>
        {#if creatorIsOp}
          <Icon size="16" src={Mic} class="text-blue-500 dark:text-blue-400" />
        {/if}
      {/if}
      <RelativeDate
        class="text-slate-600 dark:text-zinc-400"
        date={publishedToDate(node.comment.createdAt)}
      />
      <span class="text-slate-600 dark:text-zinc-400 flex flex-row gap-2 ml-1">
        {#if node.comment.isDeleted}
          <Icon
            src={Trash2}
            size="12"
            aria-label={$t('post.badges.deleted')}
            class="text-red-600 dark:text-red-500"
          />
        {/if}
        {#if node.comment.deletionReason}
          <Icon
            src={Trash2}
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
        {#if hasFacets(node.comment.record.facets)}
          <RichText
            content={node.comment.record.content}
            facets={node.comment.record.facets}
            noStyle
            class={bodyClass}
          />
        {:else}
          <Markdown
            source={node.comment.record.content}
            noStyle
            class={bodyClass}
          />
        {/if}
        {#if actions}
          <!-- TODO(coves-migration): Re-enable ban/lock checking when API provides banned_from_community and post.locked fields -->
          <CommentActions
            bind:comment={node.comment}
            {post}
            bind:replying
            onedit={() => {
              newComment = editorSourceFor(node.comment.record)
              editing = true
            }}
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
            oncomment={(output, content, facets) => {
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
                facets,
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
