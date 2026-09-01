<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import { CommonList } from '$lib/ui/layout'
  import { Option, Select } from '$lib/ui/kit'
  import { MousePointerClick, Video } from '$lib/ui/kit/icon'
  import Setting from '../Setting.svelte'
  import ToggleSetting from '../ToggleSetting.svelte'
</script>

<CommonList>
  <ToggleSetting
    icon={MousePointerClick}
    title={$t('settings.embeds.clickToView.title')}
    description={$t('settings.embeds.clickToView.description')}
    bind:checked={settings.embeds.clickToView}
  />
  <Setting icon={Video}>
    {#snippet title()}
      <span>YouTube</span>
    {/snippet}
    {#snippet description()}
      <span>
        {$t('settings.embeds.youtube.description')}
      </span>
    {/snippet}
    <Select bind:value={settings.embeds.youtube}>
      <Option value="youtube">YouTube</Option>
      <Option value="invidious">Invidious</Option>
      <Option value="piped">Piped</Option>
    </Select>
  </Setting>
</CommonList>
