<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import { Option, Select } from '$lib/ui/kit'
  import { type SelectProps } from '$lib/ui/kit/forms/select/Select.svelte'
  import {
    Bars3,
    Icon,
    RectangleGroup,
    ViewColumns,
  } from '@xylightdev/svelte-hero-icons'

  interface Props extends SelectProps<string> {
    showLabel?: boolean
  }

  let { showLabel = true, ...rest }: Props = $props()
</script>

<Select {...rest} bind:value={settings.view}>
  {#snippet customLabel()}
    {#if showLabel}
      <span class="flex items-center gap-1">
        <Icon src={ViewColumns} size="14" micro />
        {$t('filter.view.label')}
      </span>
    {/if}
  {/snippet}
  <Option value="cozy" icon={RectangleGroup}>
    {$t('filter.view.cozy')}
  </Option>
  <Option value="compact" icon={Bars3}>
    {$t('filter.view.compact')}
  </Option>
</Select>
