<script lang="ts" module>
  import { Label, Menu, MenuButton } from '$lib/ui/kit'
  import { buttonSize } from '$lib/ui/kit/button/Button.svelte'
  import { type Snippet, setContext, tick } from 'svelte'
  import type { Placement } from 'svelte-floating-ui/dom'
  import { Icon, Check, ChevronDown } from '$lib/ui/kit/icon'
  import type { Attachment } from 'svelte/attachments'
  import type { ClassValue, HTMLSelectAttributes } from 'svelte/elements'
  import {
    SELECT_CONTEXT,
    type SelectContext,
    type SelectOption,
  } from './context'

  import type { IconSource } from '$lib/ui/kit/icon'

  interface Props<T> extends Omit<HTMLSelectAttributes, 'size'> {
    value?: T | string | undefined
    placeholder?: string | undefined
    label?: string | undefined
    /** Leading icon shown inside the closed select, like a Button's icon. */
    icon?: IconSource | undefined
    size?: 'md' | 'sm'
    id?: string
    class?: ClassValue
    baseClass?: ClassValue
    selectClass?: ClassValue
    customLabel?: import('svelte').Snippet
    children?: import('svelte').Snippet
    customOption?: import('svelte').Snippet<
      [{ option: SelectOption; selected: boolean }]
    >
    target?: Snippet<[Attachment]>
    oncontextmenu?: HTMLSelectAttributes['oncontextmenu']
    onchange?: HTMLSelectAttributes['onchange']
    placement?: Placement
  }

  export type { Props as SelectProps }
</script>

<script lang="ts" generics="T">
  let open = $state(false)
  let element: HTMLSelectElement | undefined = $state()

  // `$state` so the open menu re-renders when an Option registers or its
  // label changes (e.g. on a locale switch), not only on the next open.
  const options: SelectOption[] = $state([])
  const context = setContext<SelectContext>(SELECT_CONTEXT, { options })


  let {
    value = $bindable(undefined),
    placeholder = undefined,
    label = undefined,
    icon = undefined,
    size = 'md',
    class: clazz = '',
    baseClass = '',
    selectClass = '',
    customLabel,
    children,
    customOption,
    oncontextmenu,
    onchange,
    placement = 'bottom',
    target: passedTarget,
    ...rest
  }: Props<T> = $props()

  // A native <select> always sizes itself to its *widest* option, leaving
  // dead space after shorter labels. Measure the selected label with a hidden
  // span and size the select to it instead, like a Button hugging its text.
  // Until measured (SSR, first paint) the native width is the fallback.
  let labelWidth: number | undefined = $state(undefined)
  const selectedLabel = $derived(
    options.find((o) => o.value == value)?.label ?? placeholder ?? '',
  )
</script>

{#snippet selectTarget(attachment: Attachment)}
  <Label
    text={label}
    customText={customLabel}
    class={['space-y-1 relative max-w-full w-max min-w-0', baseClass]}
  >
    <div class="relative max-w-full" role="presentation">
      {#if selectedLabel}
        <span
          bind:offsetWidth={labelWidth}
          aria-hidden="true"
          class="invisible absolute whitespace-pre leading-normal"
          >{selectedLabel}</span
        >
      {/if}
      <select
        {@attach attachment}
        {...rest}
        bind:this={element}
        style:width={labelWidth
          ? `calc(${labelWidth}px + ${icon ? '2rem' : '0.75rem'} + 1.5rem + 2px)`
          : undefined}
        class={[
          buttonSize[size],
          'btn btn-secondary select rounded-xl appearance-none pr-6! w-full shadow-xs',
          // match Button: body text color (Label paints zinc-200 on us otherwise)
          // and an explicit line-height (Firefox resets it on <select>)
          'text-slate-900 dark:text-zinc-100 leading-normal',
          icon != undefined && 'pl-8!',
          selectClass,
          clazz,
        ]}
        bind:value
        onmousedown={(e) => {
          e.preventDefault()
        }}
        onkeypress={(e) => {
          e.preventDefault()
          open = !open
        }}
        {onchange}
        {oncontextmenu}
        {placeholder}
      >
        {#if placeholder}
          <option disabled selected value="">{placeholder}</option>
        {/if}
        {@render children?.()}
      </select>
      {#if icon}
        <Icon
          src={icon}
          size="16"
          class="absolute bottom-1/2 translate-y-1/2 left-2.5 box-border pointer-events-none z-10"
        />
      {/if}
      <Icon
        src={ChevronDown}
        size="14"
        class="absolute bottom-1/2 translate-y-1/2 right-1 box-border pointer-events-none z-10 text-slate-600 dark:text-zinc-400"
      />
    </div>
  </Label>
{/snippet}

<Menu bind:open {placement}>
  {#snippet target(attachment)}
    {@const render = passedTarget ?? selectTarget}
    {@render render?.(attachment)}
  {/snippet}
  {#each context.options as option (option)}
    {#if customOption}{@render customOption({
        option,
        selected: option.value == value,
      })}{:else}
      <MenuButton
        onclick={async () => {
          value = option.value
          await tick()
          element?.dispatchEvent(new Event('change', { bubbles: true }))
        }}
        size="custom"
        disabled={option.disabled}
        color="none"
        class={[
          'min-h-0! py-1 hover:bg-slate-100 dark:hover:bg-zinc-800',
          option.value == value &&
            'bg-slate-100 dark:bg-zinc-800 text-primary-900 dark:text-primary-100 font-medium',
          option.disabled &&
            'pointer-events-none text-slate-600 dark:text-zinc-400',
          option.isLabel && 'text-xs mt-2',
        ]}
      >
        {#if option.icon}
          <Icon
            src={option.icon}
            size="16"
            class={option.value == value
              ? 'text-primary-900 dark:text-primary-100'
              : 'text-slate-600 dark:text-zinc-400'}
          />
        {/if}
        {option.label}
        {#if option.value == value}
          <Icon
            src={Check}
            size="16"
            class="ml-auto text-primary-900 dark:text-primary-100"
          />
        {/if}
      </MenuButton>
    {/if}
  {/each}
</Menu>
