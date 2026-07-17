<script lang="ts">
  import { client } from '$lib/api/client.svelte'
  import { t } from '$lib/app/i18n'
  import ItemList from '$lib/ui/generic/ItemList.svelte'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import { Button } from 'mono-svelte'
  import { Check, Trash } from 'svelte-hero-icons/dist'

  let { data } = $props()

  // TODO(coves-migration): Needs Coves instance block API — my_user is undefined during migration
  // Cast required because my_user is typed as undefined until Coves API provides instance blocks
  type InstanceBlock = {
    instance: { id: number; domain: string }
    site?: { name?: string; icon?: string }
  }
  type MyUser = { instance_blocks?: InstanceBlock[] }
  const myUser = $derived(data.my_user as unknown as MyUser | undefined)
  const instanceBlocks = $derived(myUser?.instance_blocks)

  async function unblock(id: number) {
    if (!instanceBlocks) return
    instanceBlocks.splice(
      instanceBlocks.findIndex((i) => i.instance.id == id),
      1,
    )

    await client().blockInstance({
      block: false,
      instance_id: id,
    })
  }
</script>

{#if instanceBlocks && instanceBlocks.length > 0}
  <ItemList
    items={instanceBlocks.map((i) => ({
      id: i.instance.id,
      name: i.site?.name ?? i.instance.domain,
      avatar: i.site?.icon,
      instance: i.instance.domain,
    }))}
    link={false}
  >
    {#snippet action(block)}
      <Button
        title="Unblock"
        size="square-md"
        onclick={() => unblock(Number(block.id))}
        icon={Trash}
      />
    {/snippet}
  </ItemList>
{:else}
  <Placeholder
    title={$t('routes.profile.blocks.empty.instance.title')}
    description={$t('routes.profile.blocks.empty.instance.description')}
    icon={Check}
    class="my-auto"
  />
{/if}
