<script lang="ts" module>
  import { Menu, MenuButton, Spinner, TextInput } from '$lib/ui/kit'
  import type { TextInputProps } from '$lib/ui/kit/forms/TextInput.svelte'
  import { debounce } from '$lib/ui/kit/util/time'
  import { Icon, Search } from '$lib/ui/kit/icon'
  interface Props<T> extends Omit<TextInputProps, 'onselect' | 'children'> {
    query?: string
    selected?: T | undefined
    search: (query: string) => Promise<T[]>
    extractName: (item: T) => string
    select?: (item: T) => void
    input?: import('svelte').Snippet
    noresults?: import('svelte').Snippet
    /** Shown in place of the results when the search callback rejects. */
    errorLabel?: string
    /**
     * Reports a rejected search to the caller. `ui/kit` is a leaf that may not
     * import `$lib/app`, so it cannot reach the logger itself — the caller
     * passes one in. Left unset, a failed search is shown but not recorded.
     */
    onerror?: (err: unknown) => void
    required?: boolean
    children?: import('svelte').Snippet<
      [
        {
          select: (item: T) => void
          item: T
          extractName: (item: T) => string
        },
      ]
    >
    onselect?: (value?: T) => void
    oninput?: TextInputProps['oninput']
  }

  export type { Props as SearchProps }
</script>

<script lang="ts" generics="T">
  let items: T[] = $state([])

  /**
   * This is here so that the menu doesn't open as soon as it's mounted.
   */
  let openMenu = $state(false)
  let searching = $state(false)
  let searchError: string | undefined = $state(undefined)

  let {
    query = $bindable(''),
    selected = $bindable(undefined),
    search,
    extractName,
    select = (item: T) => {
      selected = item
      query = extractName(item)
      onselect?.(item)
    },
    required,
    input,
    noresults,
    errorLabel = 'Search failed.',
    children,
    onselect,
    oninput,
    onerror,
    ...rest
  }: Props<T> = $props()

  const debounceFunc = debounce(async () => {
    searching = true
    openMenu = true
    searchError = undefined
    try {
      items = await search(query)
    } catch (err) {
      // `debounce` drops the returned promise, so an uncaught rejection here
      // is an unhandled rejection *and* leaves `searching` true forever — the
      // menu would spin for the rest of the page's life.
      items = []
      searchError = err instanceof Error ? err.message : String(err)
      onerror?.(err)
    } finally {
      searching = false
    }
  })
</script>

<div class="relative">
  <Menu bind:open={openMenu}>
    {#snippet target(attachment)}
      {#if input}{@render input()}{:else}
        <TextInput
          {@attach attachment}
          bind:value={query}
          oninput={(e) => {
            searching = true
            openMenu = true
            oninput?.(e)
            debounceFunc()
          }}
          onfocus={(e) => {
            searching = true
            openMenu = true
            oninput?.(e)
            debounceFunc()
          }}
          {required}
          {...rest}
          inlineAffixes
        >
          {#snippet prefix()}
            <div class="h-5 flex items-center">
              <Icon src={Search} size="16" />
            </div>
          {/snippet}
        </TextInput>
      {/if}
    {/snippet}
    {#if searching}
      <div class="w-full h-24 grid place-items-center">
        <Spinner width={24} />
      </div>
    {:else if searchError}
      <div
        class="text-center h-24 grid place-items-center px-4 text-slate-600 dark:text-zinc-400"
      >
        <div>
          <p>{errorLabel}</p>
          <p class="text-xs opacity-80 mt-0.5 break-words">{searchError}</p>
        </div>
      </div>
    {:else if items.length == 0}
      <div class="text-center h-24 grid place-items-center">
        {#if noresults}{@render noresults()}{:else}No results found.{/if}
      </div>
    {:else}
      {#each items as item (item)}
        {#if children}{@render children({
            extractName,
            item,
            select,
          })}{:else}
          <MenuButton onclick={() => select(item)}>
            {extractName(item)}
          </MenuButton>
        {/if}
      {/each}
    {/if}
  </Menu>
</div>
