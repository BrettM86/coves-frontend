<script lang="ts">
  import { page } from '$app/state'
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import type { CovesListingType } from '$lib/app/sort'
  import { searchParam } from '$lib/app/util.svelte'

  interface Props {
    selected: CovesListingType
    class?: string
  }

  let { selected = $bindable(), class: className = '' }: Props = $props()

  let authenticated = $derived(profile.isAuthenticated)

  function select(value: CovesListingType): void {
    selected = value
    searchParam(page.url, 'type', value, 'page', 'cursor')
  }
</script>

<nav role="tablist" aria-label="Feed" class={['flex gap-0', className]}>
  <button
    role="tab"
    aria-selected={selected === 'discover'}
    class="relative pl-0 pr-4 pt-3 pb-1 text-lg font-semibold cursor-pointer bg-transparent border-none transition-colors duration-150"
    class:text-slate-900={selected === 'discover'}
    class:dark:text-zinc-100={selected === 'discover'}
    class:text-slate-500={selected !== 'discover'}
    class:dark:text-zinc-500={selected !== 'discover'}
    class:hover:text-slate-700={selected !== 'discover'}
    class:dark:hover:text-zinc-300={selected !== 'discover'}
    onclick={() => select('discover')}
  >
    {$t('filter.feed.discover')}
    <span
      class="absolute bottom-0 left-0 right-4 h-[3px] rounded-full transition-colors duration-150"
      class:bg-slate-900={selected === 'discover'}
      class:dark:bg-white={selected === 'discover'}
      class:bg-transparent={selected !== 'discover'}
    ></span>
  </button>

  {#if authenticated}
    <button
      role="tab"
      aria-selected={selected === 'timeline'}
      class="relative px-4 pt-3 pb-1 text-lg font-semibold cursor-pointer bg-transparent border-none transition-colors duration-150"
      class:text-slate-900={selected === 'timeline'}
      class:dark:text-zinc-100={selected === 'timeline'}
      class:text-slate-500={selected !== 'timeline'}
      class:dark:text-zinc-500={selected !== 'timeline'}
      class:hover:text-slate-700={selected !== 'timeline'}
      class:dark:hover:text-zinc-300={selected !== 'timeline'}
      onclick={() => select('timeline')}
    >
      {$t('filter.feed.forYou')}
      <span
        class="absolute bottom-0 left-4 right-4 h-[3px] rounded-full transition-colors duration-150"
        class:bg-slate-900={selected === 'timeline'}
        class:dark:bg-white={selected === 'timeline'}
        class:bg-transparent={selected !== 'timeline'}
      ></span>
    </button>
  {/if}
</nav>
