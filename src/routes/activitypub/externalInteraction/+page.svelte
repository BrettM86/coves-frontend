<script lang="ts">
  // @ts-nocheck TODO(coves-migration): remove when file is migrated to Coves XRPC
  import type { ResolveObjectResponse } from '$lib/api/types'
  import { t } from '$lib/app/i18n'
  import CommentItem from '$lib/feature/comment/CommentItem.svelte'
  import CommunityItem from '$lib/feature/community/CommunityItem.svelte'
  import { PostItem } from '$lib/feature/post'
  import UserItem from '$lib/feature/user/UserItem.svelte'
  import { Spinner } from 'mono-svelte'

  interface Props {
    data: {
      resolved: Promise<ResolveObjectResponse>
    }
  }

  let { data }: Props = $props()
</script>

<div class="flex flex-col items-center justify-center h-full gap-3">
  {#await data.resolved}
    <Spinner width={32} />
    <span class="font-medium text-lg">{$t('routes.search.federating')}...</span>
  {:then object}
    <div class="w-full max-w-md">
      {#if object.community}
        <CommunityItem bind:community={object.community} />
      {:else if object.person}
        <UserItem user={object.person} />
      {:else if object.post}
        <PostItem post={object.post} />
      {:else if object.comment}
        <CommentItem comment={object.comment} />
      {/if}
    </div>
  {:catch error}
    <p class="text-red-500 dark:text-red-400 font-medium">
      {$t('toast.error')}:
      {error instanceof Error ? error.message : String(error)}
    </p>
  {/await}
</div>
