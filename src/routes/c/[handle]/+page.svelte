<script lang="ts">
  import { browser } from '$app/environment'
  import { navigating, page } from '$app/state'
  import { setSessionStorage } from '$lib/app/session'
  import { communityDisplayName } from '$lib/feature/community/helpers'
  import CommunityHeader from '$lib/feature/community/CommunityHeader.svelte'
  import { resumables } from '$lib/feature/legacy/item'
  import { PostListShell } from '$lib/ui/layout'
  import { onDestroy, onMount } from 'svelte'

  let { data } = $props()

  onMount(() => {
    if (browser && data.community) {
      setSessionStorage('lastSeenCommunity', data.community)
    }

    if (data.community) {
      resumables.add({
        name: communityDisplayName(data.community),
        type: 'community',
        url: page.url.toString(),
        avatar: data.community.avatar,
      })
    }
  })

  onDestroy(() => {
    if (browser) {
      if (navigating?.to?.route?.id == '/create/post') return

      setSessionStorage('lastSeenCommunity', undefined)
    }
  })
</script>

<svelte:head>
  {#if data.community}
    <title>{communityDisplayName(data.community)}</title>

    <meta name="og:title" content={communityDisplayName(data.community)} />
    {#if data.community.description}
      <meta name="og:description" content={data.community.description} />
    {/if}
  {/if}
</svelte:head>

{#if data.feed && data.params}
  <PostListShell
    bind:posts={data.feed}
    bind:cursor={data.cursor}
    getParams={data.params}
    params={{
      sort: data.params.sort,
    }}
  >
    {#snippet extended()}
      {#if data.community}
        <CommunityHeader
          bind:community={data.community}
          class="w-full relative"
          compact="lg"
          avatarCircle={false}
        />
      {/if}
    {/snippet}
  </PostListShell>
{/if}
