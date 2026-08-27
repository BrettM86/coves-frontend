<script lang="ts" generics="T">
  import TabButton from './TabButton.svelte'

  interface Props {
    options: T[]
    disabled?: boolean[]
    optionNames?: string[]
    selected: T
    children?: import('svelte').Snippet<[{ selected: T }]>
    onselect?: (item: T) => void
  }

  let {
    options,
    disabled = [],
    optionNames = [],
    selected = $bindable(),
    children,
    onselect,
  }: Props = $props()

  let selectedIndex = $state(0)
  // Unique per instance, so each fieldset's radios form their own group even
  // when several segmented controls are on the same page.
  let id = $props.id()

  $effect(() => {
    const newIndex = options.findIndex((i) => i === selected)
    if (newIndex !== -1) {
      selectedIndex = newIndex
    }
  })

  $effect(() => {
    const newSelected = options[selectedIndex]
    if (newSelected !== undefined && newSelected !== selected) {
      selected = newSelected
      onselect?.(newSelected)
    }
  })
</script>

<fieldset
  class="flex items-center gap-1 w-max max-w-full z-0 relative overflow-auto"
>
  {#each options as option, index}
    <label>
      <input
        type="radio"
        bind:group={selectedIndex}
        value={index}
        name={id}
        id="{id}-{option?.toString()}"
        class="hidden"
      />
      <TabButton
        selected={selectedIndex == index}
        disabled={disabled[index]}
        element="div"
      >
        {optionNames[index] || option}
      </TabButton>
    </label>
  {/each}
</fieldset>
{@render children?.({ selected })}
