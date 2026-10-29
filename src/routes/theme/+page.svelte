<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import {
    KNOWN_CATEGORIES,
    themeContrastWarnings,
    type ContrastPairId,
  } from '$lib/app/state/theme/colors'
  import { getDefaultColors } from '$lib/app/state/theme/presets'
  import {
    theme as themeData,
    type ThemeColors,
  } from '$lib/app/state/theme/theme.svelte'
  import { tintNeutrals, type TintStrength } from '$lib/app/state/theme/tint'
  import { log } from '$lib/app/util/log'
  import { Header } from '$lib/ui/layout'
  import {
    action,
    Button,
    Material,
    Modal,
    modal,
    Note,
    TextArea,
    toast,
  } from '$lib/ui/kit'
  import {
    Icon,
    Copy,
    Download,
    Monitor,
    Moon,
    Plus,
    RefreshCw,
    Sun,
    Upload,
  } from '$lib/ui/kit/icon'
  import ColorSwatch from './ColorSwatch.svelte'
  import ThemePreset from './ThemePreset.svelte'

  let importing = $state(false)
  /**
   * The tint picked on this page: the colours from before the first tint, so
   * switching strengths doesn't tint an already tinted theme, and the colours
   * it produced.
   */
  let tintSession = $state.raw<{
    themeId: number
    baseColors: ThemeColors
    strength: TintStrength
    tintedColors: ThemeColors
  } | null>(null)
  /**
   * The session while it still describes the current colours. Switching
   * theme or editing any colour ends it, so the next tint starts from there.
   */
  let activeTint = $derived(
    tintSession &&
      tintSession.themeId === themeData.current.id &&
      sameColors(tintSession.tintedColors, themeData.current.colors)
      ? tintSession
      : null,
  )
  // Drop an ended session so returning to its theme doesn't revive it.
  $effect(() => {
    if (tintSession && !activeTint) tintSession = null
  })

  const tintStrengths: TintStrength[] = ['subtle', 'medium', 'strong']
  let importText = $state('')

  let defaultColors = $derived(getDefaultColors())
  let neutralsAreDefault = $derived(
    (['slate', 'zinc'] as const).every((category) =>
      sameShades(themeData.current.colors[category], defaultColors[category]),
    ),
  )
  let isPreset = $derived(themeData.current.id <= 0)
  let contrastWarnings = $derived(
    isPreset ? [] : themeContrastWarnings(themeData.current.colors),
  )

  const pairNameKeys: Record<ContrastPairId, string> = {
    'light-body': 'routes.theme.contrast.pairs.lightBody',
    'dark-body': 'routes.theme.contrast.pairs.darkBody',
    'light-primary-button': 'routes.theme.contrast.pairs.lightPrimaryButton',
    'dark-primary-button': 'routes.theme.contrast.pairs.darkPrimaryButton',
    'light-accent': 'routes.theme.contrast.pairs.lightAccent',
    'dark-accent': 'routes.theme.contrast.pairs.darkAccent',
  }

  const importErrorKeys = {
    'invalid-json': 'routes.theme.import.invalidJson',
    'invalid-theme': 'routes.theme.import.invalidTheme',
    'preset-not-editable': 'routes.theme.import.presetNotEditable',
  } as const

  const colorSchemes = [
    { value: 'light', icon: Sun },
    { value: 'dark', icon: Moon },
    { value: 'system', icon: Monitor },
  ] as const

  /** The current value of a shade, or its default when the theme lacks it. */
  function colorOf(category: string, shade: string): string {
    return (
      themeData.current.colors[category]?.[shade] ??
      defaultColors[category]?.[shade] ??
      '0 0 0'
    )
  }

  function resetColor(category: string, shade: string) {
    const fallback = defaultColors[category]?.[shade]
    if (fallback) themeData.setColor(category, shade, fallback)
  }

  function categoryName(category: string): string {
    return $t(`routes.theme.category.${category}`)
  }

  /** What the app uses a shade for, so the numbers mean something. */
  function shadeRole(category: string, shade: string): string {
    return $t(`routes.theme.role.${category}.${shade}`)
  }

  function swatchLabel(category: string, shade: string): string {
    return `${categoryName(category)} ${shade}, ${shadeRole(category, shade)}`
  }

  function applyTint(strength: TintStrength) {
    const baseColors =
      activeTint?.baseColors ?? $state.snapshot(themeData.current.colors)
    themeData.replaceColors(tintNeutrals(baseColors, strength))
    tintSession = {
      themeId: themeData.current.id,
      baseColors,
      strength,
      tintedColors: $state.snapshot(themeData.current.colors),
    }
  }

  /** Puts the default slate and zinc back, keeping primary and other. */
  function resetNeutrals() {
    themeData.replaceColors({
      ...$state.snapshot(themeData.current.colors),
      slate: defaultColors.slate,
      zinc: defaultColors.zinc,
    })
    tintSession = null
  }

  function sameShades(
    first: Record<string, string> | undefined,
    second: Record<string, string> | undefined,
  ): boolean {
    const firstShades = first ?? {}
    const secondShades = second ?? {}
    const shades = new Set([
      ...Object.keys(firstShades),
      ...Object.keys(secondShades),
    ])
    return [...shades].every(
      (shade) => firstShades[shade] === secondShades[shade],
    )
  }

  function sameColors(first: ThemeColors, second: ThemeColors): boolean {
    return KNOWN_CATEGORIES.every((category) =>
      sameShades(first[category], second[category]),
    )
  }

  function duplicateCurrent() {
    themeData.duplicateTheme(
      themeData.current.id,
      $t('routes.theme.preset.copyName', { default: themeData.current.name }),
    )
  }

  function importTheme() {
    const error = themeData.importIntoCurrent(importText)
    if (error) {
      // The dialog stays open so the text can be fixed.
      toast({ content: $t(importErrorKeys[error]), type: 'error' })
      return
    }
    toast({ content: $t('message.success'), type: 'success' })
    importText = ''
    importing = false
  }

  async function exportTheme() {
    const payload = JSON.stringify({
      name: themeData.current.name,
      colors: themeData.current.colors,
    })
    try {
      await navigator.clipboard.writeText(payload)
      toast({ content: $t('routes.theme.export.copied'), type: 'success' })
    } catch (err) {
      log.error('[theme] Failed to copy the theme export to the clipboard', err)
      toast({ content: $t('routes.theme.export.failed'), type: 'error' })
    }
  }

  function confirmReset() {
    modal({
      actions: [
        action({
          content: $t('common.cancel'),
          close: true,
        }),
        action({
          action: () => themeData.resetCurrentColors(),
          content: $t('settings.reset'),
          close: true,
          type: 'danger',
        }),
      ],
      title: $t('routes.theme.resetWarning.title'),
      body: $t('routes.theme.resetWarning.description'),
    })
  }
</script>

<svelte:head>
  <title>{$t('routes.theme.title')}</title>
</svelte:head>

{#if importing}
  <Modal
    bind:open={importing}
    title={$t('settings.import')}
    action={$t('settings.import')}
  >
    <p class="text-sm text-slate-600 dark:text-zinc-400">
      {$t('routes.theme.import.description')}
    </p>
    <TextArea
      bind:value={importText}
      placeholder={$t('routes.theme.import.placeholder')}
      style="font-family: monospace;"
    />
    {#snippet actions({ action })}
      <Button
        class="w-full"
        onclick={importTheme}
        color="primary"
        size="lg"
        rounding="xl"
      >
        {action}
      </Button>
    {/snippet}
  </Modal>
{/if}

<Header pageHeader>
  {$t('routes.theme.title')}

  {#snippet extended()}
    <div class="flex flex-wrap items-center gap-2">
      <Button
        onclick={() => {
          importing = !importing
        }}
        size="lg"
        disabled={isPreset}
      >
        <Icon src={Upload} size="16" />
        {$t('settings.import')}
      </Button>
      <Button onclick={exportTheme} size="lg">
        <Icon src={Download} size="16" />
        {$t('settings.export')}
      </Button>
      <Button disabled={isPreset} onclick={confirmReset} size="lg">
        <Icon src={RefreshCw} size="16" />
        {$t('settings.reset')}
      </Button>
    </div>
  {/snippet}
</Header>
<div class="flex flex-col gap-4 h-full">
  <div class="flex flex-wrap items-center gap-2">
    <span class="font-medium text-sm" id="theme-color-scheme-label">
      {$t('nav.menu.colorscheme.label')}
    </span>
    <div
      role="group"
      aria-labelledby="theme-color-scheme-label"
      class="flex gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-zinc-900"
    >
      {#each colorSchemes as scheme (scheme.value)}
        <Button
          color={themeData.colorScheme === scheme.value ? 'primary' : 'ghost'}
          aria-pressed={themeData.colorScheme === scheme.value}
          onclick={() => (themeData.colorScheme = scheme.value)}
        >
          <Icon src={scheme.icon} size="16" />
          {$t(`nav.menu.colorscheme.${scheme.value}`)}
        </Button>
      {/each}
    </div>
  </div>
  <h3
    class="relative -mb-7 z-10 left-6 font-medium text-sm bg-slate-25 dark:bg-zinc-925 w-max px-1"
  >
    {$t('routes.theme.preset.presets')}
  </h3>
  <Material
    color="uniform"
    rounding="2xl"
    class="overflow-auto max-h-96 relative @container"
  >
    <div
      class="grid grid-cols-1 @md:grid-cols-2 @xl:grid-cols-3 @3xl:grid-cols-4
    gap-2"
    >
      {#each themeData.data.themes as theme (theme.id)}
        <ThemePreset {theme} />
      {/each}
      <button
        type="button"
        aria-label={$t('routes.theme.preset.new')}
        title={$t('routes.theme.preset.new')}
        onclick={() =>
          themeData.duplicateTheme(
            themeData.current.id,
            $t('routes.theme.preset.new'),
          )}
      >
        <Material
          color="none"
          padding="sm"
          class="border-dashed border-2 border-slate-400 dark:border-zinc-600
        text-slate-400 dark:text-zinc-600 hover:border-slate-600 dark:hover:border-zinc-400
        grid place-items-center w-14 h-14"
          rounding="xl"
        >
          <Icon src={Plus} size="28" />
        </Material>
      </button>
    </div>
  </Material>
  {#if isPreset}
    <Note>
      <div class="flex flex-col sm:flex-row sm:items-center gap-2 w-full">
        <p class="flex-1">{$t('routes.theme.preset.description')}</p>
        <Button color="primary" onclick={duplicateCurrent}>
          <Icon src={Copy} size="16" />
          {$t('routes.theme.preset.duplicate')}
        </Button>
      </div>
    </Note>
  {/if}
  {#if contrastWarnings.length > 0}
    <Note>
      <div class="flex flex-col gap-1 text-sm w-full">
        <p class="font-medium">{$t('routes.theme.contrast.warning')}</p>
        <ul class="list-disc pl-4">
          {#each contrastWarnings as warning (warning.id)}
            <li>
              {$t(pairNameKeys[warning.id])}: {warning.ratio.toFixed(2)}:1
            </li>
          {/each}
        </ul>
      </div>
    </Note>
  {/if}
  <div class="relative">
    <Material color="uniform" class="flex flex-col gap-2" rounding="2xl">
      <Header size="sm">
        {$t('routes.theme.accent')}
      </Header>
      <div class="flex flex-wrap gap-x-6 gap-y-2">
        {#each [{ shade: '900', key: 'routes.theme.accentLight' }, { shade: '100', key: 'routes.theme.accentDark' }] as accent (accent.shade)}
          <div class="flex flex-col gap-1">
            <span class="font-medium text-sm">{$t(accent.key)}</span>
            <ColorSwatch
              value={colorOf('primary', accent.shade)}
              label={$t(accent.key)}
              onchange={(value) =>
                themeData.setColor('primary', accent.shade, value)}
              onreset={() => resetColor('primary', accent.shade)}
              readonly={isPreset}
            />
          </div>
        {/each}
      </div>
      <div class="flex flex-col gap-1 mt-2">
        <span class="font-medium text-sm" id="theme-tint-label">
          {$t('routes.theme.tint.label')}
        </span>
        <p class="text-xs text-slate-600 dark:text-zinc-400">
          {$t('routes.theme.tint.hint')}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-labelledby="theme-tint-label"
            class="flex gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-zinc-900"
          >
            {#each tintStrengths as strength (strength)}
              <Button
                color={activeTint?.strength === strength ? 'primary' : 'ghost'}
                aria-pressed={activeTint?.strength === strength}
                disabled={isPreset}
                onclick={() => applyTint(strength)}
              >
                {$t(`routes.theme.tint.${strength}`)}
              </Button>
            {/each}
          </div>
          <button
            type="button"
            class="size-7 shrink-0 grid place-items-center rounded-md text-slate-500 dark:text-zinc-400
            hover:bg-slate-200 dark:hover:bg-zinc-800 hover:text-slate-900 dark:hover:text-zinc-100 transition-colors
            disabled:opacity-40 disabled:pointer-events-none"
            aria-label={$t('routes.theme.tint.reset')}
            title={$t('routes.theme.tint.reset')}
            onclick={resetNeutrals}
            disabled={isPreset || neutralsAreDefault}
          >
            <Icon src={RefreshCw} size="14" />
          </button>
        </div>
      </div>
    </Material>
    <div class="@container mt-4">
      <div class="grid grid-cols-1 @xl:grid-cols-2 gap-4">
        <!-- Primary is edited in the Accent section above. -->
        {#each Object.entries(defaultColors).filter(([category]) => category !== 'primary') as [category, shades] (category)}
          <Material rounding="2xl" color="uniform" class="flex flex-col gap-2">
            <Header size="sm">
              {categoryName(category)}
            </Header>
            <div class="flex flex-col gap-1">
              {#each Object.keys(shades) as shade (shade)}
                <div class="flex items-center gap-2">
                  <div class="w-32 shrink-0 flex flex-col leading-tight">
                    <span class="font-medium text-sm capitalize">{shade}</span>
                    <span class="text-xs text-slate-600 dark:text-zinc-400">
                      {shadeRole(category, shade)}
                    </span>
                  </div>
                  <ColorSwatch
                    value={colorOf(category, shade)}
                    label={swatchLabel(category, shade)}
                    onchange={(value) =>
                      themeData.setColor(category, shade, value)}
                    onreset={() => resetColor(category, shade)}
                    readonly={isPreset}
                  />
                </div>
              {/each}
            </div>
          </Material>
        {/each}
      </div>
    </div>
  </div>
</div>
