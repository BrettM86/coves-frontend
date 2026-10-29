<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { getDefaultColors } from '$lib/app/state/theme/presets'
  import {
    type Theme,
    inDarkColorScheme,
    theme as themeData,
  } from '$lib/app/state/theme/theme.svelte'
  import { action, Button, Material, modal, TextInput } from '$lib/ui/kit'
  import { Icon, CircleCheck, Copy, Trash2 } from '$lib/ui/kit/icon'

  interface Props {
    theme: Theme
  }

  let { theme }: Props = $props()

  let selected = $derived(theme.id === themeData.data.currentTheme)
  let editable = $derived(theme.id > 0)

  // The preview follows the active colour scheme, using the same tokens as
  // the page body and accent (see app.css).
  let dark = $derived(themeData.colorScheme && inDarkColorScheme())
  let preview = $derived.by(() => {
    const defaults = getDefaultColors()
    const color = (category: string, shade: string) =>
      theme.colors[category]?.[shade] ?? defaults[category]?.[shade]
    return dark
      ? {
          background: color('zinc', '950'),
          text: color('zinc', '100'),
          accent: color('primary', '100'),
        }
      : {
          background: color('slate', '50'),
          text: color('slate', '900'),
          accent: color('primary', '900'),
        }
  })

  // Comma syntax: jsdom's CSSOM, which Svelte's style setter goes through in
  // tests, drops the space-separated rgb() form.
  const cssRgb = (color: string) => `rgb(${color.split(' ').join(', ')})`

  let editingName = $state(false)
  let draftName = $state('')
  let nameInput = $state<HTMLInputElement>()

  $effect(() => {
    if (editingName) nameInput?.focus()
  })

  function startRename() {
    draftName = theme.name
    editingName = true
  }

  /** An empty name is rejected by renameTheme, which keeps the old one. */
  function commitRename() {
    if (!editingName) return
    editingName = false
    themeData.renameTheme(theme.id, draftName)
  }

  function confirmDelete() {
    modal({
      actions: [
        action({
          close: true,
          type: 'secondary',
          content: $t('common.cancel'),
        }),
        action({
          close: true,
          content: $t('routes.theme.preset.delete.confirm'),
          type: 'danger',
          action: () => themeData.deleteTheme(theme.id),
        }),
      ],
      type: 'error',
      body: $t('routes.theme.preset.delete.description', {
        default: theme.name,
      }),
      title: $t('routes.theme.preset.delete.title'),
    })
  }
</script>

<Material
  padding="none"
  rounding="none"
  class={[
    selected && 'ring-2 ring-primary-900 dark:ring-primary-100',
    'rounded-2xl flex relative h-full flex-col p-0.5',
  ]}
>
  <button
    type="button"
    class="rounded-2xl rounded-b-none text-left cursor-pointer"
    aria-pressed={selected}
    aria-label={theme.name}
    onclick={() => (themeData.data.currentTheme = theme.id)}
  >
    <div
      data-testid="theme-preview"
      class="h-20 w-full rounded-2xl rounded-b-none flex flex-row p-3 gap-2"
      style="background-color: {cssRgb(preview.background)}; color: {cssRgb(
        preview.text,
      )};"
    >
      <span class="text-xs">{$t('routes.theme.preset.sample')}</span>
      <span
        class="size-3 rounded-full ml-auto shrink-0"
        style="background-color: {cssRgb(preview.accent)}"
      ></span>
    </div>
  </button>
  {#if selected}
    <Icon
      src={CircleCheck}
      size="20"
      class="absolute top-0 right-0 m-2 pointer-events-none"
      style="color: {cssRgb(preview.accent)}"
    />
  {/if}
  <div class="pl-3 pr-1 py-1 flex items-center gap-1">
    {#if editingName}
      <TextInput
        bind:value={draftName}
        bind:element={nameInput}
        aria-label={$t('routes.theme.preset.rename')}
        class="flex-1 min-w-0"
        size="sm"
        onkeydown={(event: KeyboardEvent) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitRename()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            editingName = false
          }
        }}
        onblur={commitRename}
      />
    {:else if editable}
      <button
        type="button"
        class="flex-1 min-w-0 truncate text-left font-medium text-lg font-display cursor-text"
        title={$t('routes.theme.preset.rename')}
        onclick={startRename}
      >
        {theme.name}
      </button>
    {:else}
      <span class="flex-1 min-w-0 truncate font-medium text-lg font-display">
        {theme.name}
      </span>
    {/if}
    <Button
      color="ghost"
      size="square-md"
      class="shrink-0"
      rounding="xl"
      aria-label={$t('routes.theme.preset.duplicate')}
      title={$t('routes.theme.preset.duplicate')}
      onclick={() =>
        themeData.duplicateTheme(
          theme.id,
          $t('routes.theme.preset.copyName', { default: theme.name }),
        )}
      icon={Copy}
    ></Button>
    {#if editable}
      <Button
        color="ghost"
        size="square-md"
        class="shrink-0"
        rounding="xl"
        aria-label={$t('routes.theme.preset.delete.label')}
        title={$t('routes.theme.preset.delete.label')}
        onclick={confirmDelete}
        icon={Trash2}
      ></Button>
    {/if}
  </div>
</Material>
