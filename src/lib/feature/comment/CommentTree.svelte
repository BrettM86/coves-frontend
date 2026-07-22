<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import type { StrongRef } from '$lib/api/coves/types'
  import { parseAtUri } from '$lib/api/coves/types'
  import { XrpcError } from '$lib/api/coves/xrpc'
  import type { DID } from '$lib/types/atproto'
  import { errorMessage } from '$lib/app/error'
  import { t } from '$lib/app/i18n'
  import { commentLink, type PostLinkRef } from '$lib/feature/post'
  import { Button, toast } from 'mono-svelte'
  import { ArrowDownCircle, ArrowRightCircle } from 'svelte-hero-icons/dist'
  import Comment from './Comment.svelte'
  import {
    type CommentNodeI,
    MAX_INLINE_DEPTH,
    buildSubtreeChildren,
    subtreeFetchDepth,
  } from './comments.svelte'
  import CommentTree from './CommentTree.svelte'

  /**
   * Upper bound on cursor pages followed per "N more" click. Each page holds
   * up to 50 of the parent's direct replies (the backend default), so this
   * keeps one click from turning into an unbounded fetch storm; direct
   * replies beyond the cap stay unloaded.
   */
  const MAX_REPLY_PAGES = 4

  interface Props {
    nodes: CommentNodeI[]
    /** Post the comments belong to — needed to build comment permalinks. */
    post: PostLinkRef
    postRef: StrongRef
    postAuthorDid?: DID
  }

  let { nodes = $bindable(), post, postRef, postAuthorDid }: Props = $props()

  async function fetchChildren(parent: CommentNodeI) {
    if (
      !(parent.comment.stats.replyCount > 0 && parent.children.length === 0)
    ) {
      return
    }

    try {
      parent.loading = true

      // `parentRkey` scopes the response to the parent's subtree: exactly one
      // top-level ThreadViewComment (the parent itself) with its descendants
      // nested beneath it — no more fetching the whole tree and searching.
      // `depth` is relative to the parent; stop one level past the inline
      // cutoff so deeper replies stay unloaded and render the permalink
      // anchor instead of indenting forever (see subtreeFetchDepth).
      //
      // `response.cursor` pages the parent's DIRECT replies: follow it up to
      // MAX_REPLY_PAGES so wide threads load fully — most fit in one page.
      const parentRkey = parseAtUri(parent.comment.uri).rkey
      const children: CommentNodeI[] = []
      let cursor: string | undefined

      for (let page = 0; page < MAX_REPLY_PAGES; page++) {
        const response = await coves().getComments({
          post: postRef.uri,
          parentRkey,
          depth: subtreeFetchDepth(parent.depth),
          cursor,
        })

        // Grafted children land at parent.depth + 1.
        const grafted = buildSubtreeChildren(response.comments, parent)
        if (grafted === null) {
          // Empty response. On the first page there is nothing to show; on a
          // later page keep what already loaded (pagination race).
          if (page === 0) {
            toast({
              content: $t('toast.noComments'),
              type: 'error',
            })
            return
          }
          break
        }
        children.push(...grafted)

        cursor = response.cursor
        if (!cursor) break
      }

      parent.children = children
    } catch (err) {
      if (err instanceof XrpcError && err.errorName === 'ParentNotFound') {
        // The comment vanished between render and click (deleted/unindexed).
        toast({
          content: $t('toast.commentNotFound'),
          type: 'error',
        })
        return
      }
      console.error(err)
      toast({
        content: errorMessage(err),
        type: 'error',
      })
    } finally {
      parent.loading = false
    }
  }
</script>

<ul>
  {#each nodes as node, index (node.comment.uri)}
    <Comment
      bind:node={nodes[index]}
      {post}
      {postRef}
      {postAuthorDid}
      contentClass={[
        (node.children.length > 0 || node.comment.stats.replyCount > 0) &&
          'border-l',
        'ml-2.5 pl-3 sm:pl-4 lg:pl-5',
        'comment-border',
      ]}
      bind:open={nodes[index].expanded}
    >
      <button
        class="expand-btn"
        onclick={() => (nodes[index].expanded = !nodes[index].expanded)}
        aria-label={$t('comment.expand')}
      ></button>
      <div class={['comment-corner', node.depth == 0 && 'hidden']}></div>
      {#if node.children?.length > 0}
        <CommentTree
          {post}
          {postRef}
          {postAuthorDid}
          bind:nodes={nodes[index].children}
        />
      {/if}
    </Comment>
    {#if node.comment.stats.replyCount > 0 && node.children.length == 0}
      <div class="w-full h-10 -mt-2 -ml-2.5">
        {#if node.depth > MAX_INLINE_DEPTH}
          <!-- Deep threads continue on the comment's permalink page. A real
               anchor keeps this working without JS and middle-clickable. -->
          <Button
            href={commentLink(post, node.comment.uri)}
            rounding="pill"
            color="tertiary"
            class="font-normal text-slate-600 dark:text-zinc-400"
            shadow="none"
            icon={ArrowRightCircle}
          >
            {$t('comment.thread')}
          </Button>
        {:else}
          <Button
            loading={nodes[index].loading}
            disabled={nodes[index].loading}
            rounding="pill"
            color="tertiary"
            class="font-normal text-slate-600 dark:text-zinc-400"
            shadow="none"
            loaderWidth={16}
            onclick={() => fetchChildren(nodes[index])}
            icon={ArrowDownCircle}
          >
            {$t('comment.more')}
          </Button>
        {/if}
      </div>
    {/if}
  {/each}
</ul>

<style>
  @reference '../../../app.css';

  :global(.comment-border) {
    border-color: var(--color-slate-200);
    @variant dark {
      border-color: var(--color-zinc-800);
    }

    transition: border-color 600ms cubic-bezier(0.075, 0.82, 0.165, 1);

    &:has(:global(> * > .expand-btn:hover:not(:active))) {
      border-color: color-mix(
        in oklab,
        var(--color-primary-900),
        var(--color-slate-500)
      );
      @variant dark {
        border-color: color-mix(
          in oklab,
          var(--color-primary-100),
          var(--color-zinc-500)
        );
      }
    }
  }

  .expand-btn {
    width: calc(var(--spacing) * 4);
    position: absolute;
    top: 0;
    left: calc(var(--spacing) * 0.5);
    height: 100%;
    cursor: pointer;
  }

  .comment-corner {
    position: absolute;
    top: calc(var(--spacing) * 2);
    left: calc(var(--spacing) * -3);
    border-bottom-left-radius: calc(infinity * 1px);
    border-left-width: 1px;
    border-bottom-width: 1px;
    border-color: var(--color-slate-200);
    @variant dark {
      border-color: var(--color-zinc-800);
    }
    width: calc(var(--spacing) * 3);
    height: calc(var(--spacing) * 3);

    @variant sm {
      top: calc(var(--spacing) * 1);
      left: calc(var(--spacing) * -5.5);
      width: calc(var(--spacing) * 5);
      height: calc(var(--spacing) * 5);
    }
  }
</style>
