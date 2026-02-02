<script lang="ts">
  import { page } from '$app/state'
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import { searchParam } from '$lib/app/util.svelte'
  import { Option, Select } from 'mono-svelte'
  import { type SelectProps } from 'mono-svelte/forms/select/Select.svelte'
  import {
    GlobeAmericas,
    Icon,
    MapPin,
    Newspaper,
    ShieldCheck,
  } from 'svelte-hero-icons/dist'

  interface Props extends SelectProps<string> {
    selected: string
    navigate?: boolean
    changeDefault?: boolean
    showLabel?: boolean
  }

  let {
    selected = $bindable(),
    navigate = true,
    showLabel = true,
    children,
    ...rest
  }: Props = $props()
</script>

<Select
  {...rest}
  bind:value={selected}
  onchange={() => {
    if (navigate) searchParam(page.url, 'type', selected, 'page', 'cursor')
  }}
>
  {#snippet customLabel()}
    {#if showLabel}
      <span class="flex items-center gap-1">
        <Icon src={GlobeAmericas} size="16" micro />
        {$t('filter.location.label')}
      </span>
    {/if}
  {/snippet}
  <Option value="All" icon={GlobeAmericas}>
    {$t('filter.location.all')}
  </Option>
  <!-- TODO: Re-enable Popular option when Coves API supports it -->
  <!--
  <Option value="Popular" icon={ChartBar}>
    {$t('filter.location.popular')}
  </Option>
  -->
  <Option value="Local" icon={MapPin}>{$t('filter.location.local')}</Option>
  <Option
    value="Subscribed"
    disabled={profile.current?.jwt == undefined}
    icon={Newspaper}
  >
    {$t('filter.location.subscribed')}
  </Option>
  <Option value="ModeratorView" disabled={!profile.isMod()} icon={ShieldCheck}>
    {$t('filter.location.moderator')}
  </Option>
  {@render children?.()}
</Select>
