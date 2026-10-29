<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { normalizeColor, rgbToHex } from '$lib/app/state/theme/colors'
  import { Icon, RefreshCw } from '$lib/ui/kit/icon'

  interface Props {
    /** The stored 'r g b' triple. */
    value: string
    /** Accessible name of the colour, e.g. "Dark mode 900, Cards, panels". */
    label: string
    /** Receives the new colour as an 'r g b' triple, never hex. */
    onchange: (value: string) => void
    onreset?: () => void
    /** Shows the colour and its copyable hex without allowing changes. */
    readonly?: boolean
    class?: string
  }

  let {
    value,
    label,
    onchange,
    onreset,
    readonly = false,
    class: clazz = '',
  }: Props = $props()

  let hex = $derived(rgbToHex(value))

  function commit(text: string): boolean {
    const color = normalizeColor(text)
    if (!color) return false
    onchange(color)
    return true
  }
</script>

<div class="flex items-center gap-1 {clazz}">
  <div
    class="size-8 shrink-0 relative rounded-md border border-slate-300 dark:border-zinc-600
    dark:hover:border-zinc-400 transition-colors focus-within:ring-2 ring-primary-900 dark:ring-primary-100"
    style="background-color: rgb({value});"
  >
    <input
      class="cursor-pointer disabled:cursor-default absolute inset-0 size-full opacity-0"
      type="color"
      aria-label={label}
      value={hex}
      disabled={readonly}
      oninput={(event) => commit(event.currentTarget.value)}
      oncontextmenu={(event) => {
        // Right-click reset is a shortcut for the visible reset button.
        if (!onreset || readonly) return
        event.preventDefault()
        onreset()
      }}
    />
  </div>
  <input
    type="text"
    class="w-20 min-w-0 px-1.5 py-1 rounded-md text-xs font-mono bg-white dark:bg-zinc-900
    border border-slate-200 dark:border-zinc-800 focus:outline-hidden
    focus:border-primary-900 dark:focus:border-primary-100"
    aria-label="{label} {$t('routes.theme.swatch.hex')}"
    spellcheck="false"
    autocomplete="off"
    {readonly}
    value={hex}
    onchange={(event) => {
      // Invalid text snaps back to the current colour.
      if (!commit(event.currentTarget.value)) event.currentTarget.value = hex
    }}
  />
  {#if onreset && !readonly}
    <button
      type="button"
      class="size-7 shrink-0 grid place-items-center rounded-md text-slate-500 dark:text-zinc-400
      hover:bg-slate-200 dark:hover:bg-zinc-800 hover:text-slate-900 dark:hover:text-zinc-100 transition-colors"
      aria-label="{$t('settings.reset')} {label}"
      title="{$t('settings.reset')} {label}"
      onclick={onreset}
    >
      <Icon src={RefreshCw} size="14" />
    </button>
  {/if}
</div>
