<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import { CommonList } from '$lib/ui/layout'
  import { Bug, Menu } from '$lib/ui/kit/icon'
  import ToggleSetting from '../ToggleSetting.svelte'
</script>

<CommonList>
  <ToggleSetting
    icon={Bug}
    bind:checked={settings.debugInfo}
    title={$t('settings.other.debug.title')}
    description={$t('settings.other.debug.description')}
  />
  <ToggleSetting
    icon={Menu}
    bind:checked={settings.posts.noVirtualize}
    title={$t('settings.other.virtualizeFeeds.title')}
    description={$t('settings.other.virtualizeFeeds.description')}
  />
</CommonList>
