<script lang="ts">
  import type {
    CommunityView,
    CommunityViewDetailed,
  } from '$lib/api/coves/types'
  import { communityMention } from './helpers'
  import Avatar from '$lib/ui/generic/Avatar.svelte'

  interface Props {
    community: CommunityView | CommunityViewDetailed
  }

  let { community }: Props = $props()
</script>

<div class="flex flex-row gap-3 items-center">
  <Avatar width={48} url={community.avatar} alt={community.name} />
  <div class="flex flex-col gap-0">
    <h1 class="font-bold text-xl">{community.displayName ?? community.name}</h1>
    <span class="dark:text-zinc-400 text-slate-600 text-sm">
      {communityMention(community)}
    </span>
  </div>
</div>
