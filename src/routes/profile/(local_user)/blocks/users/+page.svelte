<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import type { DID } from '$lib/types/atproto'
  import { errorMessage } from '$lib/app/util/error'
  import { t } from '$lib/app/state/i18n'
  import ItemList from '$lib/ui/generic/ItemList.svelte'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import { Button, toast } from '$lib/ui/kit'
  import { Check, Trash2, Undo2 } from '$lib/ui/kit/icon'
  import type { PageData } from './$types'

  interface Props {
    data: PageData
  }

  let { data }: Props = $props()

  async function unblock(did: DID): Promise<void> {
    try {
      await coves().unblockUser({ subject: did })
      data.blockedUsers.value = data.blockedUsers.value.filter(
        (row) => row.block.blockedDid !== did,
      )
    } catch (err) {
      toast({ content: errorMessage(err), type: 'error' })
    }
  }
</script>

{#if data.blockedUsers.value.length > 0}
  <ItemList
    items={data.blockedUsers.value.map(({ block, profile }) => ({
      id: block.blockedDid,
      name: profile?.displayName ?? profile?.handle ?? block.blockedDid,
      avatar: profile?.avatar,
      url: `/profile/${encodeURIComponent(profile?.handle ?? block.blockedDid)}`,
      instance: profile?.handle,
      circle: true,
    }))}
    link={false}
  >
    {#snippet action(item)}
      <Button
        title={$t('common.jump')}
        size="square-md"
        href={item.url}
        color="primary"
        icon={Undo2}
      />
      <Button
        title={$t('account.unblock')}
        size="square-md"
        onclick={() => unblock(item.id as DID)}
        icon={Trash2}
      />
    {/snippet}
  </ItemList>
{:else}
  <Placeholder
    title={$t('routes.profile.blocks.empty.user.title')}
    description={$t('routes.profile.blocks.empty.user.description')}
    icon={Check}
    class="my-auto"
  />
{/if}
