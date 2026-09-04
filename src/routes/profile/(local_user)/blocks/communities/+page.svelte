<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import { t } from '$lib/app/state/i18n'
  import { errorMessage } from '$lib/app/util/error'
  import {
    isCommunityBlockPending,
    toggleCommunityBlock,
    type BlockableCommunity,
  } from '$lib/feature/community/blocking.svelte'
  import {
    communityDisplayName,
    communityIdentifier,
    communityMention,
  } from '$lib/feature/community/helpers'
  import ItemList from '$lib/ui/generic/ItemList.svelte'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import { Button, toast } from '$lib/ui/kit'
  import { Check, Trash2, Undo2 } from '$lib/ui/kit/icon'
  import { isValidDID, type DID } from '$lib/types/atproto'
  import type { PageData } from './$types'
  import type { BlockedCommunityRow } from './+page'

  interface Props {
    data: PageData
  }

  interface BlockedCommunityItem {
    id: DID
    name: string
    avatar?: string
    url?: string
    instance?: string
  }

  let { data }: Props = $props()

  /** The list endpoint itself is authoritative even when hydration failed. */
  function serverBlocked(did: DID): BlockableCommunity {
    return { did, viewer: { blocked: true } }
  }

  function toItem({
    block,
    community,
  }: BlockedCommunityRow): BlockedCommunityItem {
    if (community === undefined) {
      return { id: block.communityDid, name: block.communityDid }
    }

    return {
      id: block.communityDid,
      name: communityDisplayName(community),
      avatar: community.avatar,
      url: `/c/${communityIdentifier(community)}`,
      instance: communityMention(community),
    }
  }

  async function unblock(did: DID): Promise<void> {
    const outcome = await toggleCommunityBlock(serverBlocked(did), coves())
    if (outcome.kind === 'error') {
      toast({ content: errorMessage(outcome.error), type: 'error' })
      return
    }
    if (outcome.kind !== 'ok' || outcome.blocked) return

    // Keep a failed request visible and actionable. A row leaves only after
    // the repository write succeeds.
    data.blockedCommunities.value = data.blockedCommunities.value.filter(
      ({ block }) => block.communityDid !== did,
    )
  }
</script>

{#if data.blockedCommunities.value.length > 0}
  <ItemList items={data.blockedCommunities.value.map(toItem)} link={false}>
    {#snippet action(item)}
      {#if item.url}
        <Button
          title={$t('common.jump')}
          size="square-md"
          href={item.url}
          color="primary"
          icon={Undo2}
        />
      {/if}
      {#if typeof item.id === 'string' && isValidDID(item.id)}
        {@const did = item.id}
        <Button
          title={$t('cards.community.unblock')}
          size="square-md"
          disabled={isCommunityBlockPending(serverBlocked(did))}
          loading={isCommunityBlockPending(serverBlocked(did))}
          onclick={() => unblock(did)}
          icon={Trash2}
        />
      {/if}
    {/snippet}
  </ItemList>
{:else}
  <Placeholder
    title={$t('routes.profile.blocks.empty.community.title')}
    description={$t('routes.profile.blocks.empty.community.description')}
    icon={Check}
    class="my-auto"
  />
{/if}
