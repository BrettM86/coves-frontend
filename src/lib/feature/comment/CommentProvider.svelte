<script lang="ts">
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import type {
    PostView,
    StrongRef,
    ThreadViewComment,
  } from '$lib/api/coves/types'
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import CommentForm from '$lib/feature/comment/CommentForm.svelte'
  import CommentListVirtualizer from '$lib/feature/comment/CommentListVirtualizer.svelte'
  import {
    buildCommentsTree,
    findTopLevelIndexByRkey,
    insertCommentIntoTree,
    createOptimisticCommentView,
  } from '$lib/feature/comment/comments.svelte'
  import CommentTree from '$lib/feature/comment/CommentTree.svelte'
  import { postLink } from '$lib/feature/post'
  import EndPlaceholder from '$lib/ui/layout/EndPlaceholder.svelte'
  import { Button, Option, Select } from '$lib/ui/kit'
  import { onMount, untrack } from 'svelte'
  import {
    Icon,
    CirclePlus,
    Flame,
    MessageSquare,
    RefreshCw,
    Star,
    Trophy,
  } from '$lib/ui/kit/icon'
  interface Props {
    post: PostView
    comments: ThreadViewComment[]
    sort?: string
    onupdate?: () => void
    focus?: string
    virtualize?: boolean
    showContext?: boolean
    singleThread?: boolean
  }

  let {
    post,
    comments,
    sort = $bindable(),
    onupdate,
    focus,
    virtualize = true,
    showContext,
    singleThread,
  }: Props = $props()
  let commenting = $state(false)

  const postRef: StrongRef = $derived({ uri: post.uri, cid: post.cid })

  // `tree` has to stay $state, not $derived: insertCommentIntoTree() mutates it
  // in place for optimistic replies and CommentTree takes it via bind:nodes.
  // The effect rebuilds it whenever the loaded comments change; the untracked
  // seed is what the server-rendered first paint shows, before effects run.
  let tree = $state(untrack(() => buildCommentsTree(comments)))
  $effect(() => {
    tree = buildCommentsTree(comments)
  })

  let virtualizer = $state<CommentListVirtualizer>()

  /**
   * Points the comment list at the top-level row containing the comment with
   * the given rkey, mounting it when the list is virtualized. Returns
   * 'missing' when the rkey isn't anywhere in the loaded tree, 'pending'
   * while the virtualizer hasn't rendered yet (callers should retry), and
   * 'scrolled' once the row is mounted (or the list isn't virtualized, so
   * every row already is).
   */
  export function scrollToComment(
    rkey: string,
  ): 'scrolled' | 'missing' | 'pending' {
    const index = findTopLevelIndexByRkey(tree, rkey)
    if (index === -1) return 'missing'
    if (!virtualize) return 'scrolled'
    return virtualizer?.scrollToRow(index) ? 'scrolled' : 'pending'
  }

  onMount(() => {
    if (browser && !isNaN(Number(page.url.hash.slice(1)) || NaN))
      // hack because virtual list needs to calc heights
      setTimeout(() => {
        document
          .getElementById(page.url.hash.slice(1))
          ?.scrollIntoView({ behavior: 'instant', block: 'center' })
      }, 100)
  })
</script>

{#if profile.current?.jwt}
  {#if !commenting}
    <EndPlaceholder border={false}>
      <Button color="primary" rounding="xl" onclick={() => (commenting = true)}>
        <Icon src={MessageSquare} size="16" />
        {$t('routes.post.addComment')}
      </Button>

      {#snippet action()}
        <div class="gap-2 flex items-center">
          <Select
            size="md"
            bind:value={settings.defaultSort.comments}
            onchange={onupdate}
          >
            <Option icon={Flame} value="hot">{$t('filter.sort.hot')}</Option>
            <Option icon={Trophy} value="top">
              {$t('filter.sort.top.label')}
            </Option>
            <Option icon={Star} value="new">{$t('filter.sort.new')}</Option>
          </Select>
          <Button
            size="custom"
            class="h-8.5 w-8.5"
            rounding="xl"
            onclick={onupdate}
            icon={RefreshCw}
          ></Button>
        </div>
      {/snippet}
    </EndPlaceholder>
  {:else}
    <CommentForm
      {postRef}
      oncomment={(output, content) => {
        const cv = createOptimisticCommentView(
          output,
          content,
          postRef,
          postRef,
          {
            did: profile.current?.did ?? '',
            handle: profile.current?.handle ?? '',
            avatar: undefined,
          },
        )
        insertCommentIntoTree(tree, cv, false)
      }}
      onfocus={() => (commenting = true)}
      tools={commenting}
      preview={commenting}
      placeholder={commenting ? undefined : $t('routes.post.addComment')}
      rows={commenting ? 7 : 1}
      oncancel={() => (commenting = false)}
    />
  {/if}
{/if}

{#if commenting || !profile.current.jwt}
  <div class="gap-2 flex items-center">
    <Select
      size="md"
      bind:value={settings.defaultSort.comments}
      onchange={onupdate}
    >
      <Option icon={Flame} value="hot">{$t('filter.sort.hot')}</Option>
      <Option icon={Trophy} value="top">
        {$t('filter.sort.top.label')}
      </Option>
      <Option icon={Star} value="new">{$t('filter.sort.new')}</Option>
    </Select>
    <Button
      size="custom"
      class="h-8.5 w-8.5"
      rounding="xl"
      onclick={onupdate}
      icon={RefreshCw}
    ></Button>
  </div>
{/if}

{#snippet allCommentsPlaceholder()}
  <EndPlaceholder alignment="center">
    {#snippet action()}
      <Button href={postLink(post)} icon={CirclePlus} rounding="pill">
        {$t('routes.post.thread.allComments')}
      </Button>
    {/snippet}
  </EndPlaceholder>
{/snippet}

{#if singleThread && !showContext}
  {@render allCommentsPlaceholder()}
{/if}

{#if showContext && tree[0]}
  <Button
    color="secondary"
    alignment="left"
    rounding="pill"
    href={postLink(post)}
    class="mt-2 -mb-2 -mx-2.5 w-max"
  >
    <Icon src={CirclePlus} size="16" />
    {$t('routes.post.thread.allComments')}
  </Button>
  <div
    class="border-l h-4 -mb-5 ml-2.5 border-slate-200 dark:border-zinc-800"
  ></div>
{/if}
{#if virtualize}
  <CommentListVirtualizer
    bind:this={virtualizer}
    {post}
    {postRef}
    postAuthorDid={post.author.did}
    nodes={tree}
    scrollTo={focus}
  />
{:else}
  <div class="divide-y divide-slate-200 dark:divide-zinc-800">
    <div class="-mx-3 sm:-mx-6 px-3 sm:px-6">
      <CommentTree
        bind:nodes={tree}
        {post}
        {postRef}
        postAuthorDid={post.author.did}
      />
    </div>
  </div>
{/if}

{#if singleThread && !showContext}
  {@render allCommentsPlaceholder()}
{/if}
