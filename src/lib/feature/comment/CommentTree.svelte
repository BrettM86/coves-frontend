<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import type { StrongRef } from '$lib/api/coves/types'
  import type { DID } from '$lib/types/atproto'
  import { errorMessage } from '$lib/app/error'
  import { t } from '$lib/app/i18n'
  import { Button, toast } from 'mono-svelte'
  import { ArrowDownCircle } from 'svelte-hero-icons/dist'
  import Comment from './Comment.svelte'
  import {
    type CommentNodeI,
    buildCommentsTree,
    searchCommentTree,
  } from './comments.svelte'
  import CommentTree from './CommentTree.svelte'

  interface Props {
    nodes: CommentNodeI[]
    postRef: StrongRef
    postAuthorDid?: DID
  }

  let { nodes = $bindable(), postRef, postAuthorDid }: Props = $props()

  function adjustDepths(nodes: CommentNodeI[], depth: number): void {
    for (const n of nodes) {
      n.depth = depth
      adjustDepths(n.children, depth + 1)
    }
  }

  async function fetchChildren(parent: CommentNodeI) {
    if (
      !(parent.comment.stats.replyCount > 0 && parent.children.length === 0)
    ) {
      return
    }

    try {
      parent.loading = true

      // TODO: The API does not yet support a `parent` param to scope to a subtree.
      // Once supported, pass `parent: parent.comment.uri` to avoid fetching all comments.
      const response = await coves().getComments({
        post: postRef.uri,
      })

      // TODO: response.cursor is currently ignored — use it for pagination support.

      if (response.comments.length === 0) {
        toast({
          content: $t('toast.noComments'),
          type: 'error',
        })
        return
      }

      // The server returns ThreadViewComment[] for the full post tree.
      // Build with baseDepth=0 since the server returns the complete tree from root.
      const fullTree = buildCommentsTree(response.comments, 0)
      const matchedNode = searchCommentTree(fullTree, parent.comment.uri)
      if (matchedNode) {
        parent.children = matchedNode.children
        adjustDepths(parent.children, parent.depth + 1)
      } else {
        console.warn(
          `[comments] Could not find parent node ${parent.comment.uri as string} in fetched comment tree. Children not loaded.`,
        )
        toast({
          content: $t('toast.failedToLoadComments'),
          type: 'error',
        })
        parent.children = []
      }
    } catch (err) {
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
          {postRef}
          {postAuthorDid}
          bind:nodes={nodes[index].children}
        />
      {/if}
    </Comment>
    {#if node.comment.stats.replyCount > 0 && node.children.length == 0}
      <!-- Deep threads expand in place — there is no Coves comment permalink yet. -->
      <div class="w-full h-10 -mt-2 -ml-2.5">
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
          {$t('comment.more', {
            comments: node.comment.stats.replyCount,
          })}
        </Button>
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
