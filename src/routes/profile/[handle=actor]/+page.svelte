<script lang="ts">
  import { profile as authProfile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { didAtUri } from '$lib/app/util/at-uri'
  import { userLink } from '$lib/app/util/links'
  import PostFeed from '$lib/feature/post/feed/PostFeed.svelte'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import { Pageination } from '$lib/ui/layout'
  import { Button, ButtonGroup } from '$lib/ui/kit'
  import {
    Heart,
    Icon,
    LayoutGrid,
    MessageSquare,
    SquarePen,
  } from '$lib/ui/kit/icon'
  import { type PageData } from './$types'
  import LikedFeed from './LikedFeed.svelte'
  import ProfileComment from './ProfileComment.svelte'
  import ProfileHeader from './ProfileHeader.svelte'
  import type { LikesFilter, ProfileTab } from './tabs'

  interface Props {
    data: PageData
    inline?: boolean
  }

  let { data, inline = false }: Props = $props()

  const publicTabs = [
    { tab: 'posts', label: 'content.posts', icon: LayoutGrid },
    { tab: 'comments', label: 'content.comments', icon: MessageSquare },
  ] as const satisfies { tab: ProfileTab; label: string; icon: unknown }[]
  const likesTab = {
    tab: 'likes',
    label: 'content.likes',
    icon: Heart,
  } as const satisfies { tab: ProfileTab; label: string; icon: unknown }

  const likesFilters = [
    { filter: 'all', label: 'content.all' },
    { filter: 'posts', label: 'content.posts' },
    { filter: 'comments', label: 'content.comments' },
  ] as const satisfies { filter: LikesFilter; label: string }[]
  const likesEmptyStates: Record<
    LikesFilter,
    { title: string; description: string }
  > = {
    all: {
      title: 'No likes',
      description: "You haven't liked any posts or comments yet.",
    },
    posts: {
      title: 'No liked posts',
      description: "You haven't liked any posts yet.",
    },
    comments: {
      title: 'No liked comments',
      description: "You haven't liked any comments yet.",
    },
  }

  // Likes are private, so only the owner gets the tab. authProfile.current
  // resolves from locals.auth during an authenticated server render and from
  // stored state in the browser, so the owner sees the tab in both.
  let tabs = $derived(
    data.data.value && authProfile.current?.did === data.data.value.profile.did
      ? [...publicTabs, likesTab]
      : publicTabs,
  )
</script>

<svelte:head>
  <title>
    {data.data.value?.profile.displayName ??
      data.data.value?.profile.handle ??
      'User'}
  </title>
  {#if data.data.value}
    {@const profile = data.data.value.profile}
    {@const name = profile.displayName || profile.handle || profile.did}
    <link
      rel="alternate"
      type="application/rss+xml"
      title="{name} · {$t('content.posts')}"
      href="{userLink(profile)}/rss"
    />
    <link
      rel="alternate"
      type="application/rss+xml"
      title="{name} · {$t('content.comments')}"
      href="{userLink(profile)}/rss?type=comments"
    />
    {#if !profile.accountStatus}
      <meta name="at:author" content={didAtUri(profile.did)} />
    {/if}
  {/if}
</svelte:head>

<div class="flex flex-col max-w-full w-full">
  {#if data.data.value}
    {@const value = data.data.value}
    {@const profile = value.profile}
    {#if !inline}
      <ProfileHeader {profile} />
      <!-- Sticks under the navbar like the mobile tab bar under its app bar;
           from md the navbar is sticky at the top, so sit below it. -->
      <nav
        class="page-band sticky top-0 md:top-14 z-20 -mx-3 sm:-mx-6 mb-2 flex border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950"
        aria-label={$t('aria.profileTabs')}
      >
        {#each tabs as item (item.tab)}
          {@const selected = value.tab === item.tab}
          <a
            href="{userLink(profile)}?type={item.tab}"
            aria-current={selected ? 'page' : undefined}
            data-sveltekit-noscroll
            data-sveltekit-keepfocus
            class={[
              'flex-1 flex flex-col items-center gap-2 pt-3 pb-1 text-[13px]',
              selected
                ? 'font-bold text-slate-900 dark:text-zinc-100'
                : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100',
            ]}
          >
            <span class="flex items-center gap-1.5">
              <Icon src={item.icon} size="16" />
              {$t(item.label)}
            </span>
            <span
              class={['h-[3px] w-12 rounded-full', selected && 'bg-brand']}
            ></span>
          </a>
        {/each}
      </nav>
    {/if}

    {#if value.tab === 'posts'}
      {#if value.posts.feed.length > 0}
        <PostFeed posts={value.posts.feed} />
      {:else}
        <Placeholder
          icon={SquarePen}
          title="No posts"
          description="This user has no posts."
        />
      {/if}
      {#if value.posts.cursor}
        <Pageination
          cursor={{ next: value.posts.cursor }}
          hasMore={!!value.posts.cursor}
          href={(cursor) => `?postsCursor=${encodeURIComponent(cursor)}`}
          back={false}
        >
          {$t('content.posts')}
        </Pageination>
      {/if}
    {:else if value.tab === 'likes'}
      <nav class="mb-2 flex" aria-label={$t('aria.likesFilter')}>
        <ButtonGroup orientation="horizontal" class="flex">
          {#each likesFilters as item (item.filter)}
            {@const selected = value.likesFilter === item.filter}
            <Button
              href="{userLink(profile)}?type=likes{item.filter === 'all'
                ? ''
                : `&likes=${item.filter}`}"
              aria-current={selected ? 'page' : undefined}
              data-sveltekit-noscroll
              data-sveltekit-keepfocus
              color={selected ? 'primary' : 'secondary'}
              size="sm"
            >
              {$t(item.label)}
            </Button>
          {/each}
        </ButtonGroup>
      </nav>
      {#if value.likes.feed.length > 0}
        <LikedFeed items={value.likes.feed} />
      {:else}
        {@const empty = likesEmptyStates[value.likesFilter]}
        <!-- With a cursor left, this page was emptied (e.g. by dropped
             unknown items), not the list, so it makes no "none yet" claim. -->
        <Placeholder
          icon={Heart}
          title={empty.title}
          description={value.likes.cursor ? undefined : empty.description}
        />
      {/if}
      {#if value.likes.cursor}
        <Pageination
          cursor={{ next: value.likes.cursor }}
          hasMore={!!value.likes.cursor}
          href={(cursor) => `?likesCursor=${encodeURIComponent(cursor)}`}
          back={false}
        >
          {$t('content.likes')}
        </Pageination>
      {/if}
    {:else}
      {#if value.comments.comments.length > 0}
        {@const parents = new Map(
          value.commentPosts.map((post) => [post.uri, post]),
        )}
        <ul
          class="flex flex-col list-none divide-y divide-slate-200 dark:divide-zinc-800"
        >
          {#each value.comments.comments as comment (comment.uri)}
            <li>
              <ProfileComment
                {comment}
                parent={parents.get(comment.post.uri)}
              />
            </li>
          {/each}
        </ul>
      {:else}
        <Placeholder
          icon={SquarePen}
          title="No comments"
          description="This user has no comments."
        />
      {/if}
      {#if value.comments.cursor}
        <Pageination
          cursor={{ next: value.comments.cursor }}
          hasMore={!!value.comments.cursor}
          href={(cursor) => `?commentsCursor=${encodeURIComponent(cursor)}`}
          back={false}
        >
          {$t('content.comments')}
        </Pageination>
      {/if}
    {/if}
  {:else}
    <Placeholder
      icon={SquarePen}
      title="Failed to load profile"
      description="This profile could not be loaded. It may not exist or there was an error."
    />
  {/if}
</div>
