<script lang="ts">
  import { browser } from '$app/environment'
  import { navigating, page } from '$app/state'
  import { setSessionStorage } from '$lib/app/session'
  import CommunityHeader from '$lib/feature/community/CommunityHeader.svelte'
  import { resumables } from '$lib/feature/legacy/item'
  import { PostListShell } from '$lib/ui/layout'
  import { Note } from 'mono-svelte'
  import { onDestroy, onMount } from 'svelte'

  let { data } = $props()

  onMount(() => {
    if (browser)
      setSessionStorage('lastSeenCommunity', data.community.community_view)

    resumables.add({
      name: data.community.community_view.community.title,
      type: 'community',
      url: page.url.toString(),
      avatar: data.community.community_view.community.icon,
    })
  })

  onDestroy(() => {
    if (browser) {
      if (navigating?.to?.route?.id == '/create/post') return

      setSessionStorage('lastSeenCommunity', undefined)
    }
  })
</script>

<svelte:head>
  <title>{data.community.community_view.community.title}</title>

  <meta
    name="og:title"
    content={data.community.community_view.community.title}
  />
  {#if data.community.community_view.community.description}
    <meta
      name="og:description"
      content={data.community.community_view.community.description}
    />
  {/if}
</svelte:head>

<PostListShell
  bind:posts={data.posts}
  bind:cursor={data.next_page}
  bind:client={data.client}
  getParams={data.params}
  params={{
    sort: data.params.sort!,
  }}
>
  {#snippet extended()}
    <CommunityHeader
      bind:community={data.community.community_view.community}
      bind:subscribed={data.community.community_view.subscribed}
      blocked={data.community.community_view.blocked}
      moderators={data.community.moderators}
      counts={data.community.community_view.counts}
      class="w-full relative"
      compact="lg"
      avatarCircle={false}
    />
    {#if data.community.community_view.blocked}
      <Note>You've blocked this community.</Note>
    {/if}
    <!-- TODO: Re-enable language warning when Coves API provides user language preferences -->
  {/snippet}
</PostListShell>
