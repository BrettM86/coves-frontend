<script lang="ts">
  import { page } from '$app/state'
  import type { AuthorView } from '$lib/api/coves/types'
  import { t } from '$lib/app/i18n'
  import { deletedContentPlaceholder } from '$lib/feature/comment/comments.svelte'
  import PostFeed from '$lib/feature/post/feed/PostFeed.svelte'
  import UserLink from '$lib/feature/user/UserLink.svelte'
  import EntityHeader from '$lib/ui/generic/EntityHeader.svelte'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import { Header } from '$lib/ui/layout'
  import { publishedToDate } from '$lib/ui/util/date'
  import { Option, Select } from 'mono-svelte'
  import { formatRelativeDate } from 'mono-svelte/util/RelativeDate.svelte'
  import {
    AdjustmentsHorizontal,
    ChatBubbleOvalLeft,
    Icon,
    PencilSquare,
  } from 'svelte-hero-icons/dist'
  import { type PageData } from './$types'
  import UserActions from './UserActions.svelte'

  interface Props {
    data: PageData
    inline?: boolean
  }

  let { data, inline = false }: Props = $props()

  let filterType = $state<'all' | 'posts' | 'comments'>('all')
  let sortForm = $state<HTMLFormElement>()
</script>

<svelte:head>
  <title>
    {data.data.value?.profile.displayName ??
      data.data.value?.profile.handle ??
      'User'}
  </title>
</svelte:head>

<div class="flex flex-col gap-4 max-w-full w-full">
  {#if !inline && data.data.value}
    {@const profile = data.data.value.profile}
    <Header pageHeader class="tracking-normal!">
      <div class="w-full">
        <EntityHeader
          avatarCircle
          avatar={profile.avatar}
          name={profile.displayName ?? profile.handle ?? 'Unknown'}
          banner={profile.banner}
          bio={profile.description}
          stats={[
            {
              name: $t('content.posts'),
              value: (profile.stats?.postCount ?? 0).toString(),
            },
            {
              name: $t('content.comments'),
              value: (profile.stats?.commentCount ?? 0).toString(),
            },
            {
              name: $t('stats.joined'),
              value: formatRelativeDate(publishedToDate(profile.createdAt), {
                style: 'short',
              }).toString(),
              format: false,
            },
          ]}
        >
          {#snippet nameDetail()}
            <span class="text-sm flex gap-0 items-center w-max">
              @
              <UserLink
                showInstance
                user={profile as unknown as AuthorView}
                displayName={false}
                class="font-normal"
              />
            </span>
          {/snippet}
          {#snippet actions()}
            <UserActions {profile} />
          {/snippet}
        </EntityHeader>
      </div>
      {#snippet extended()}
        <div class="flex flex-col gap-4 max-w-full w-full min-w-0">
          <form
            action={page.url.origin + page.url.pathname}
            method="GET"
            class="flex flex-row gap-4 flex-wrap"
            bind:this={sortForm}
          >
            <Select
              bind:value={filterType}
              name="type"
              onchange={() => sortForm?.requestSubmit()}
            >
              {#snippet customLabel()}
                <span class="flex items-center gap-1">
                  <Icon src={AdjustmentsHorizontal} size="15" mini />
                  {$t('filter.type')}
                </span>
              {/snippet}
              <Option value="all">{$t('content.all')}</Option>
              <Option value="posts">{$t('content.posts')}</Option>
              <Option value="comments">{$t('content.comments')}</Option>
            </Select>
          </form>
        </div>
      {/snippet}
    </Header>
  {/if}

  {#if data.data.value}
    {@const posts = data.data.value.posts.feed}
    {@const comments = data.data.value.comments.comments}

    {#if filterType === 'all' || filterType === 'posts'}
      {#if posts.length > 0}
        <PostFeed {posts} />
      {:else if filterType === 'posts'}
        <Placeholder
          icon={PencilSquare}
          title="No posts"
          description="This user has no posts."
        />
      {/if}
    {/if}

    {#if filterType === 'all' || filterType === 'comments'}
      {#if comments.length > 0}
        <ul
          class="flex flex-col list-none divide-y divide-slate-200 dark:divide-zinc-800"
        >
          {#each comments as comment (comment.uri)}
            <li class="py-3 px-4">
              <div
                class="flex items-center gap-2 text-sm text-slate-500 dark:text-zinc-400 mb-1"
              >
                <Icon src={ChatBubbleOvalLeft} size="14" mini />
                {#if comment.author}
                  <UserLink user={comment.author} avatarSize={16} />
                {:else}
                  <!-- Deleted-comment tombstones omit `author` entirely. -->
                  <span class="italic">{$t('comment.deletedAuthor')}</span>
                {/if}
                <span class="text-xs">
                  {formatRelativeDate(publishedToDate(comment.createdAt), {
                    style: 'short',
                  })}
                </span>
              </div>
              <p class="text-sm text-slate-700 dark:text-zinc-300">
                {comment.record?.content ?? deletedContentPlaceholder()}
              </p>
            </li>
          {/each}
        </ul>
      {:else if filterType === 'comments'}
        <Placeholder
          icon={PencilSquare}
          title="No comments"
          description="This user has no comments."
        />
      {/if}
    {/if}

    {#if filterType === 'all' && posts.length === 0 && comments.length === 0}
      <Placeholder
        icon={PencilSquare}
        title="No submissions"
        description="This user has no submissions."
      />
    {/if}
  {:else}
    <Placeholder
      icon={PencilSquare}
      title="Failed to load profile"
      description="This profile could not be loaded. It may not exist or there was an error."
    />
  {/if}
</div>
