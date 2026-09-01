<script lang="ts">
  // @ts-nocheck TODO(coves-migration): Needs Coves community block API
  import { client } from '$lib/api/client.svelte'
  import { t } from '$lib/app/state/i18n'
  import { communityLink } from '$lib/app/util/links'
  import ItemList from '$lib/ui/generic/ItemList.svelte'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import { Button } from '$lib/ui/kit'
  import { Check, Trash2, Undo2 } from '$lib/ui/kit/icon'
  let { data } = $props()

  async function unblock(id: number) {
    if (!data.community_blocks) return
    data.community_blocks.splice(
      data.community_blocks.findIndex((i) => i.community.id == id),
      1,
    )

    await client().blockCommunity({
      block: false,
      community_id: id,
    })
  }
</script>

{#if data.community_blocks && data.community_blocks?.length > 0}
  <ItemList
    items={data.community_blocks.map((i) => ({
      id: i.community.id,
      name: i.community.title,
      avatar: i.community.icon,
      url: communityLink(i.community),
      instance: new URL(i.community.actor_id).hostname,
    }))}
    link={false}
  >
    {#snippet action(block)}
      <Button
        title={$t('common.jump')}
        size="square-md"
        href={block.url}
        color="primary"
        icon={Undo2}
      />
      <Button
        title="Unblock"
        size="square-md"
        onclick={() => unblock(block.id)}
        icon={Trash2}
      />
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
