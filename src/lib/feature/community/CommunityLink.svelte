<script lang="ts">
  import type { CommunityRef, CommunityView } from '$lib/api/coves/types'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import type { HTMLAnchorAttributes } from 'svelte/elements'
  import { communityHandleOrName, communityIdentifier } from './helpers'

  interface Props extends HTMLAnchorAttributes {
    community: CommunityRef | CommunityView
    avatar?: boolean
    name?: boolean
    avatarSize?: number
    class?: string
  }

  let {
    community,
    avatar = false,
    name = true,
    avatarSize = 24,
    class: clazz = '',
    ...rest
  }: Props = $props()
</script>

<!--
  @component
  Links to a community, labelled by its handle. The handle is the community's
  identity in atproto — it is what the URL resolves and what a user types to
  find the community — so it is always the label. Display names are freeform
  and usually just restate the handle ("nba" vs `!nba.coves.social`).
-->
<a
  {...rest}
  class={[
    'items-center inline-flex flex-row gap-2 hover:underline max-w-full min-w-0',
    clazz,
  ]}
  href="/c/{communityIdentifier(community)}"
  data-sveltekit-preload-data="tap"
>
  {#if avatar}
    <Avatar url={community.avatar} alt={community.name} width={avatarSize} />
  {/if}

  {#if name}
    <span class="font-medium handle-text shrink min-w-0">
      !{communityHandleOrName(community)}
    </span>
  {/if}
</a>

<style>
  .handle-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
</style>
