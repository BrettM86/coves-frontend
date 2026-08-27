<script lang="ts">
  import { type Snippet, getContext, onDestroy, untrack } from 'svelte'
  import type { IconSource } from '@xylightdev/svelte-hero-icons'
  import type { HTMLOptionAttributes } from 'svelte/elements'
  import {
    SELECT_CONTEXT,
    type SelectContext,
    type SelectOption,
  } from './context'

  interface Props extends Omit<HTMLOptionAttributes, 'prefix'> {
    children: Snippet
    icon?: IconSource
  }
  let { children, icon, ...rest }: Props = $props()

  const context = getContext<SelectContext | undefined>(SELECT_CONTEXT)
  if (!context) throw new Error('<Option> must be rendered inside a <Select>')

  let optionElement = $state<HTMLOptionElement>()
  // The label is read from the rendered DOM (children may be any snippet). A
  // MutationObserver keeps it current when the children re-render — e.g. on a
  // locale change — without the kit knowing where the text came from. The
  // observer fires on a microtask, so `label` trails the DOM by one tick.
  let label = $state('')

  const readLabel = (element: HTMLElement): string =>
    element.innerText ?? element.textContent ?? ''

  $effect(() => {
    const element = optionElement
    if (!element) return
    label = readLabel(element)
    const observer = new MutationObserver(() => {
      label = readLabel(element)
    })
    observer.observe(element, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    return () => observer.disconnect()
  })

  let option: SelectOption = $derived({
    value: optionElement?.value ?? '',
    label,
    icon: icon,
    disabled: optionElement?.disabled,
    isLabel: optionElement?.getAttribute('data-label') == 'true',
  })

  $effect(() => {
    // Depend on `option` only. `context.options` is `$state` (so Select's open
    // menu re-renders on a label change), which means reading it here would
    // make this effect depend on the very list it writes to — an update loop.
    // `untrack` keeps the write from feeding back in; other readers of the
    // list are still notified.
    const current = option
    untrack(() => {
      const index = context.options.findIndex((i) => i.value == current.value)

      if (index != -1) {
        context.options.splice(index, 1, current)
      } else {
        context.options.push(current)
      }
    })
  })

  onDestroy(() => {
    const index = context.options.findIndex((i) => i.value == option.value)
    if (index != -1) {
      context.options.splice(index, 1)
    }
  })
</script>

<option {...rest} bind:this={optionElement}>
  {@render children()}
</option>
