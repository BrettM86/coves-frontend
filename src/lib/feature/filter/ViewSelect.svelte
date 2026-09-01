<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import { Option, Select } from '$lib/ui/kit'
  import { type SelectProps } from '$lib/ui/kit/forms/select/Select.svelte'
  import {
    Icon,
    CloudDrizzle,
    Columns3,
    Rows4,
    type IconSource,
  } from '$lib/ui/kit/icon'
  interface Props extends SelectProps<string> {
    showLabel?: boolean
  }

  let { showLabel = true, ...rest }: Props = $props()

  // Resolved in an effect (browser-only) rather than inline: `settings.view`
  // comes from localStorage, so the server always renders the default view.
  // An SSR'd icon for the wrong view would get patched — not replaced — during
  // hydration, leaving a chimera of both icons' SVG nodes in the DOM.
  let viewIcon: IconSource | undefined = $state(undefined)
  $effect(() => {
    viewIcon = settings.view == 'cozy' ? CloudDrizzle : Rows4
  })
</script>

<Select
  {...rest}
  bind:value={settings.view}
  icon={viewIcon}
>
  {#snippet customLabel()}
    {#if showLabel}
      <span class="flex items-center gap-1">
        <Icon src={Columns3} size="14" />
        {$t('filter.view.label')}
      </span>
    {/if}
  {/snippet}
  <Option value="cozy" icon={CloudDrizzle}>
    {$t('filter.view.cozy')}
  </Option>
  <Option value="compact" icon={Rows4}>
    {$t('filter.view.compact')}
  </Option>
</Select>
