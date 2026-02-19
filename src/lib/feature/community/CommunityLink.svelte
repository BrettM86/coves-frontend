<script lang="ts">
  import type { CommunityRef, CommunityView } from '$lib/api/coves/types'
  import { settings } from '$lib/app/settings.svelte'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import type { HTMLAnchorAttributes } from 'svelte/elements'
  import { communityDisplayName, communityIdentifier } from './helpers'

  interface Props extends HTMLAnchorAttributes {
    community: CommunityRef | CommunityView
    avatar?: boolean
    name?: boolean
    avatarSize?: number
    showInstance?: boolean
    displayName?: boolean
    class?: string
    instanceClass?: string
  }

  let {
    community,
    avatar = false,
    name = true,
    avatarSize = 24,
    showInstance = settings.showInstances.community,
    displayName = true,
    class: clazz = '',
    instanceClass = '',
    ...rest
  }: Props = $props()
</script>

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
    <span class="flex gap-0 items-center max-w-full min-w-0 shrink">
      <span class="font-medium username-text">
        {displayName ? communityDisplayName(community) : community.name}
      </span>
      {#if showInstance && community.handle}
        <span
          class="text-slate-500 dark:text-zinc-500 font-normal
          instance-text shrink {instanceClass || ''}"
        >
          @{community.handle}
        </span>
      {/if}
    </span>
  {/if}
</a>

<style>
  .instance-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    flex: 1;
  }

  .username-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
