<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import type { CommunityView } from '$lib/api/coves/types'
  import { communityAddress } from '$lib/app/util/community'
  import { log } from '$lib/app/util/log'
  import { MenuButton, Search, toast } from '$lib/ui/kit'
  import { Icon, XCircle } from '@xylightdev/svelte-hero-icons'
  import { fly } from 'svelte/transition'
  import Avatar from '../generic/Avatar.svelte'

  interface Props {
    q?: string
    showWhenEmpty?: boolean
    placeholder?: string
    onselect?: (item: CommunityView | undefined) => void
    label?: string
    required?: boolean
  }

  let {
    q = $bindable(''),
    showWhenEmpty = false,
    required,
    onselect,
    ...rest
  }: Props = $props()

  let searchError = $state(false)
</script>

<Search
  onerror={(err) => log.error('[Search] search failed', err)}
  search={async (q) => {
    searchError = false
    try {
      const api = coves()

      if (q.trim()) {
        const results = await api.searchCommunities({
          q,
          limit: 20,
        })
        return results.communities
      } else {
        const results = await api.listCommunities({
          limit: 20,
        })
        return results.communities
      }
    } catch (err) {
      log.error('[ObjectAutocomplete] search failed', err)
      searchError = true
      toast({
        content: 'Failed to search communities',
        type: 'error',
      })
      return []
    }
  }}
  extractName={(c) => c.name}
  bind:query={q}
  {required}
  {...rest}
>
  {#snippet noresults()}
    <div class="w-full h-full">
      {#if q == '' && showWhenEmpty}
        <MenuButton onclick={() => onselect?.(undefined)}>
          <Icon src={XCircle} size="16" mini />
          <div class="flex flex-col text-left">
            <span>None</span>
          </div>
        </MenuButton>
      {:else if searchError}
        <span class="mx-auto my-auto text-red-500 dark:text-red-400">
          Search failed.
        </span>
      {:else}
        <span class="mx-auto my-auto">No results.</span>
      {/if}
    </div>
  {/snippet}
  {#snippet children({ item, select })}
    <div in:fly|global={{ y: -4, opacity: 0 }}>
      <MenuButton
        onclick={() => {
          select(item)
          onselect?.(item)
        }}
      >
        <Avatar url={item.avatar} alt={item.name} width={24} />
        <div class="flex flex-col text-left">
          <span>{item.displayName ?? item.name}</span>
          <span class="text-xs opacity-80">
            {communityAddress(item)}
          </span>
        </div>
      </MenuButton>
    </div>
  {/snippet}
</Search>
