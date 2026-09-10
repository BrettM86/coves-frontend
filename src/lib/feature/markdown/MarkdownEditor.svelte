<script lang="ts">
  import SegmentedControl from '$lib/ui/form/SegmentedControl.svelte'
  import { Button, Label, TextArea } from '$lib/ui/kit'
  import type { TextAreaProps } from '$lib/ui/kit/forms/TextArea.svelte'
  import { tick } from 'svelte'
  import {
    Icon,
    Bold,
    Code,
    Heading1,
    Italic,
    Link,
    Strikethrough,
    TriangleAlert,
  } from '$lib/ui/kit/icon'
  import type { ClassValue } from 'svelte/elements'
  import { t } from '$lib/app/state/i18n'
  import Markdown from './Markdown.svelte'

  let textArea: HTMLTextAreaElement | undefined = $state()

  function replaceTextAtIndices(
    str: string,
    startIndex: number,
    endIndex: number,
    replacement: string,
  ) {
    return str.substring(0, startIndex) + replacement + str.substring(endIndex)
  }

  function wrapSelection(start: string, end: string) {
    if (!textArea) return
    const startPos = textArea.selectionStart
    const endPos = textArea.selectionEnd

    const substring = textArea.value.substring(startPos, endPos)
    let newText = `${start}${substring}${end}`

    textArea.value = replaceTextAtIndices(
      textArea.value,
      startPos,
      endPos,
      newText,
    )

    textArea.focus()
    textArea.selectionStart = startPos + start.length
    textArea.selectionEnd = endPos + start.length

    value = textArea.value
  }

  // Indexed by the raw KeyboardEvent.key, so the lookup is a plain string and
  // may miss. Handlers ignore the event; the parameter is declared so the call
  // site can pass it without the map claiming zero-arity.
  const shortcuts: Record<
    string,
    ((event: KeyboardEvent) => void) | undefined
  > = {
    b: () => wrapSelection('**', '**'),
    i: () => wrapSelection('*', '*'),
    s: () => wrapSelection('~~', '~~'),
    h: () => wrapSelection('\n# ', ''),
    k: () => wrapSelection('[](', ')'),
  }

  async function adjustHeight() {
    await tick()
    if (textArea) {
      textArea.style.height = 'auto' // Reset height to auto to calculate new height
      textArea.style.height = `${textArea.scrollHeight}px` // Set height to the scrollHeight
    }
  }

  function handleKeydown(
    event: KeyboardEvent & {
      currentTarget: EventTarget & HTMLTextAreaElement
    },
  ) {
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault()
      const form = textArea?.closest('form')
      if (form) form.requestSubmit() // Automatically submits the form
    }
  }

  interface Props extends TextAreaProps {
    value?: string
    label?: string | undefined
    previewButton?: boolean
    tools?: boolean
    disabled?: boolean
    rows?: number
    beforePreview?: (input?: string) => string
    previewing?: boolean
    class?: ClassValue
    customLabel?: import('svelte').Snippet
    children?: import('svelte').Snippet
  }

  let {
    value = $bindable(),
    label = undefined,
    previewButton = true,
    tools = true,
    disabled = false,
    required = false,
    rows = 2,
    // should be preprocess instead
    beforePreview = (input) => input ?? '',
    previewing = $bindable(false),
    class: clazz = '',
    customLabel,
    children,
    ...rest
  }: Props = $props()

  $effect(() => {
    if (!previewing && value) adjustHeight()
  })
</script>

<div>
  {#if label || customLabel}
    <Label
      class={required
        ? "after:content-['*'] after:text-red-500 after:ml-1"
        : ''}
    >
      {#if label}
        {label}
      {:else if customLabel}
        {@render customLabel?.()}
      {/if}
    </Label>
  {/if}
  <div
    class={[
      'flex flex-col border border-slate-200 border-b-slate-300 dark:border-zinc-800',
      'focus-within:border-primary-900 dark:focus-within:border-primary-100 focus-within:ring-3 ring-slate-300 dark:ring-zinc-700',
      'bg-white dark:bg-zinc-950',
      'rounded-2xl overflow-hidden transition-colors shadow-xs',
      label && 'mt-1',
      clazz,
    ]}
  >
    {#if previewing}
      <div
        class="p-5 overflow-auto text-sm resize-y bg-white dark:bg-zinc-950 min-h-48"
      >
        <Markdown source={beforePreview(value)} />
      </div>
    {:else}
      {#if tools}
        <!--Toolbar-->
        <div
          class={[
            '*:shrink-0 flex flex-row overflow-auto p-1.5 gap-1.5',
            disabled && 'opacity-60 pointer-events-none',
          ]}
        >
          <Button
            onclick={() => wrapSelection('**', '**')}
            title="Bold"
            size="custom"
            class="w-8 h-8"
            rounding="lg"
          >
            <Icon src={Bold} size="15" />
          </Button>
          <Button
            onclick={() => wrapSelection('*', '*')}
            title="Italic"
            size="custom"
            class="w-8 h-8"
            rounding="lg"
          >
            <Icon src={Italic} size="15" />
          </Button>
          <Button
            onclick={() => wrapSelection('[', '](https://example.com)')}
            title="Link"
            size="custom"
            class="w-8 h-8"
            rounding="lg"
          >
            <Icon src={Link} size="15" />
          </Button>
          <Button
            onclick={() => wrapSelection('\n# ', '')}
            title="Header"
            size="custom"
            class="w-8 h-8"
            rounding="lg"
          >
            <Icon src={Heading1} size="15" />
          </Button>
          <Button
            onclick={() => wrapSelection('~~', '~~')}
            title="Strikethrough"
            size="custom"
            class="w-8 h-8"
            rounding="lg"
          >
            <Icon src={Strikethrough} size="15" />
          </Button>
          <Button
            onclick={() => wrapSelection('\n> ', '')}
            title="Quote"
            size="custom"
            class="w-8 h-8"
            rounding="lg"
          >
            <span class="font-bold font-serif text-lg">"</span>
          </Button>
          <Button
            onclick={() => wrapSelection('`', '`')}
            title="Code"
            size="custom"
            class="w-8 h-8"
            rounding="lg"
          >
            <Icon src={Code} size="15" />
          </Button>
          <Button
            onclick={() =>
              wrapSelection('::: spoiler <spoiler title>\n', '\n:::')}
            title="Spoiler"
            size="custom"
            class="w-8 h-8"
            rounding="lg"
          >
            <Icon src={TriangleAlert} size="15" />
          </Button>
        </div>
      {/if}
      <!--Actual text area-->
      <TextArea
        class="bg-inherit z-0 border-0 rounded-none ring-0! focus:ring-transparent! transition-none! resize-none"
        bind:value
        bind:element={textArea}
        onkeydown={(e) => {
          if (disabled) return
          if (e.ctrlKey || e.metaKey) {
            handleKeydown(e)
            const shortcut = shortcuts[e.key]
            if (shortcut) {
              e.preventDefault()
              shortcut?.(e)
            }
          }
        }}
        oninput={adjustHeight}
        {rows}
        {required}
        {...rest}
      />
    {/if}

    {#if previewButton}
      <div
        class="p-2 flex flex-row items-center w-full bg-slate-50 border-t border-slate-200 dark:border-zinc-900 dark:bg-zinc-925 gap-1"
      >
        {#if previewButton}
          <SegmentedControl
            bind:selected={previewing}
            options={[false, true]}
            optionNames={[$t('form.edit'), $t('form.preview')]}
          />
        {/if}
        {@render children?.()}
      </div>
    {/if}
  </div>
</div>
