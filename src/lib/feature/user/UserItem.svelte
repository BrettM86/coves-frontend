<script lang="ts">
  import type { ProfileViewDetailed } from '$lib/api/coves/types'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import LabelStat from '$lib/ui/info/LabelStat.svelte'

  interface Props {
    user: ProfileViewDetailed
    view?: 'cozy' | 'compact'
    showCounts?: boolean
    class?: string
    icon?: import('svelte').Snippet
  }

  let {
    user,
    view = 'compact',
    showCounts = true,
    class: clazz = 'flex flex-col gap-4 text-sm max-w-full relative',
    icon,
  }: Props = $props()
</script>

<div class={clazz}>
  <div
    class="flex
     {view == 'cozy'
      ? 'flex-col gap-2'
      : 'flex-row'} items-center max-w-full w-full"
  >
    <a href="/u/{user.handle ?? user.did}" class="flex-1">
      <div
        class="flex {view == 'cozy'
          ? 'flex-col gap-2'
          : 'flex-row'} gap-2 items-center"
      >
        {#if icon}{@render icon()}{:else}
          <Avatar url={user.avatar} width={32} alt={user.handle ?? user.did} />
        {/if}
        <div class="flex flex-col">
          <div class="font-medium text-base">
            {user.displayName ?? user.handle ?? user.did}
          </div>
          <div class="text-sm text-slate-600 dark:text-zinc-400">
            {user.handle ?? user.did}
          </div>
        </div>
      </div>
    </a>
  </div>
  {#if showCounts && user.stats}
    <div class="flex flex-row gap-3 items-center justify-center">
      {#if user.stats.postCount}
        <LabelStat
          content={user.stats.postCount.toString()}
          formatted
          label="Posts"
        />
      {/if}
      {#if user.stats.commentCount}
        <LabelStat
          content={user.stats.commentCount.toString()}
          formatted
          label="Comments"
        />
      {/if}
    </div>
  {/if}
</div>
