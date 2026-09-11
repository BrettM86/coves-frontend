<script lang="ts">
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { mapSort } from '$lib/api/coves/sort'
  import { errorMessage } from '$lib/app/util/error'
  import { log } from '$lib/app/util/log'
  import type {
    AtUri,
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
    retainCreatedComments,
    commentCreatedContext,
    type CommentCreated,
  } from '$lib/feature/comment/comments.svelte'
  import CommentTree from '$lib/feature/comment/CommentTree.svelte'
  import { postLink } from '$lib/feature/post'
  import EndPlaceholder from '$lib/ui/layout/EndPlaceholder.svelte'
  import { Button, Option, Select, toast } from '$lib/ui/kit'
  import { onMount, setContext, untrack } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { EMPTY_POST_STATS } from '$lib/feature/vote/subjects'
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
    post = $bindable(),
    comments,
    sort = $bindable(),
    onupdate,
    focus,
    virtualize = true,
    showContext,
    singleThread,
  }: Props = $props()
  let commenting = $state(false)
  const activeSort = $derived(
    mapSort(
      sort ??
        page.url.searchParams.get('sort') ??
        settings.defaultSort.comments,
    ).sort,
  )
  let selectedSort = $derived(activeSort)

  async function changeSort(): Promise<void> {
    const nextSort = selectedSort
    const url = new URL(page.url)
    url.searchParams.set('sort', nextSort)
    url.searchParams.delete('cursor')
    try {
      // Cursors belong to a sort order. Navigation keeps the URL, loader cache,
      // and Back/Forward history on the same page as the displayed comments.
      await goto(url, { noScroll: true, keepFocus: true })
      settings.defaultSort.comments = nextSort
    } catch (err) {
      selectedSort = activeSort
      log.error('[comments] Failed to change sort', err)
      toast({ content: errorMessage(err), type: 'error' })
    }
  }

  const postRef: StrongRef = $derived({ uri: post.uri, cid: post.cid })

  // `tree` has to stay $state, not $derived: insertCommentIntoTree() mutates it
  // in place for optimistic replies and CommentTree takes it via bind:nodes.
  // The effect rebuilds it whenever the loaded comments change; the untracked
  // seed is what the server-rendered first paint shows, before effects run.
  let tree = $state(untrack(() => buildCommentsTree(comments)))
  const createdComments = new SvelteSet<AtUri>()
  let treePostUri = untrack(() => post.uri)
  const commentCreated: CommentCreated = (comment, parent) => {
    if (comment.post.uri !== post.uri || createdComments.has(comment.uri))
      return
    createdComments.add(comment.uri)
    if (parent) tree = retainCreatedComments(tree, [parent], createdComments)
    post.stats = {
      ...(post.stats ?? EMPTY_POST_STATS),
      commentCount: (post.stats?.commentCount ?? 0) + 1,
    }
  }
  setContext(commentCreatedContext, commentCreated)
  $effect(() => {
    const loaded = comments
    const postUri = post.uri
    untrack(() => {
      if (treePostUri !== postUri) {
        createdComments.clear()
        treePostUri = postUri
        tree = buildCommentsTree(loaded)
      } else {
        tree = retainCreatedComments(
          buildCommentsTree(loaded),
          tree,
          createdComments,
        )
      }
    })
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

<!--
  An expired session keeps the editor mounted: the draft lives in the form's
  local state, and the recovery prompt lets the reader log back in without
  leaving this page. Only a genuine guest loses the composer.
-->
{#if profile.sessionExpired || profile.current?.jwt}
  {#if !commenting}
    <EndPlaceholder border={false}>
      <Button color="primary" rounding="xl" onclick={() => (commenting = true)}>
        <Icon src={MessageSquare} size="16" />
        {$t('routes.post.addComment')}
      </Button>

      {#snippet action()}
        <div class="gap-2 flex items-center">
          <Select size="md" bind:value={selectedSort} onchange={changeSort}>
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
      oncomment={(cv) => {
        if (cv.post.uri !== post.uri) return
        insertCommentIntoTree(tree, cv, false)
        commentCreated(cv)
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

{#if commenting || !(profile.sessionExpired || profile.current.jwt)}
  <div class="gap-2 flex items-center">
    <Select size="md" bind:value={selectedSort} onchange={changeSort}>
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
