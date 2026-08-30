<script lang="ts">
  // @ts-nocheck TODO(coves-migration): Needs Coves user search API
  import { getClient } from '$lib/api/client.svelte'
  import type { ListingType, Person } from '$lib/api/types'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import { log } from '$lib/app/util/log'
  import { MenuButton, Search } from '$lib/ui/kit'
  import { Icon, XCircle } from '@xylightdev/svelte-hero-icons'
  import { fly } from 'svelte/transition'

  interface Props {
    q?: string
    instance?: string | undefined
    listing_type?: ListingType
    showWhenEmpty?: boolean
    /** @deprecated No longer functional - will filter users when Coves API provides DID */
    hideOwnUser?: boolean
    placeholder?: string
    onselect?: (person?: Person) => void
  }

  let {
    q = $bindable(''),
    instance = undefined,
    listing_type = 'Subscribed',
    showWhenEmpty = false,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    hideOwnUser = false,
    onselect,
    ...rest
  }: Props = $props()
</script>

<Search
  onerror={(err) => log.error('[Search] search failed', err)}
  search={async (q) => {
    const users = (
      await getClient(instance).search({
        q: q || ' ',
        type_: 'Users',
        limit: 20,
        listing_type: listing_type,
        sort: 'TopAll',
      })
    ).users.map((c) => c.person)

    // TODO: Filter out own user when DID comparison is available
    return users
  }}
  extractName={(c) => `${c.name}@${new URL(c.actor_id).hostname}`}
  bind:query={q}
  {onselect}
  {...rest}
>
  {#snippet noresults()}
    <div class="w-full h-full">
      {#if showWhenEmpty}
        <MenuButton onclick={() => onselect?.(undefined)}>
          <Icon src={XCircle} size="16" mini />
          <div class="flex flex-col text-left">
            <span>None</span>
          </div>
        </MenuButton>
      {:else}
        <span class="mx-auto my-auto">No results.</span>
      {/if}
    </div>
  {/snippet}
  {#snippet children({ item, select })}
    <div in:fly|global={{ y: -4, opacity: 0 }}>
      <MenuButton onclick={() => select(item)}>
        <Avatar url={item.avatar} alt={item.name} width={24} />
        <div class="flex flex-col text-left">
          <span>{item.name}</span>
          <span class="text-xs opacity-80">
            {new URL(item.actor_id).hostname}
          </span>
        </div>
      </MenuButton>
    </div>
  {/snippet}
</Search>
