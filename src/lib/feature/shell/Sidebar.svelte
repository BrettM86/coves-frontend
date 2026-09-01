<script lang="ts">
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { LINKED_INSTANCE_URL } from '$lib/app/state/instance.svelte'
  import { theme } from '$lib/app/state/theme/theme.svelte'
  import ProfileSelection from '$lib/feature/user/ProfileSelection.svelte'
  import { Option, Select } from '$lib/ui/kit'
  import {
    Icon,
    ChevronsUpDown,
    CircleUser,
    House,
    LogIn,
    Monitor,
    Moon,
    Settings,
    Sun,
    SwatchBook,
    Users,
  } from '$lib/ui/kit/icon'
  import type { ClassValue } from 'svelte/elements'
  import EndPlaceholder from '$lib/ui/layout/EndPlaceholder.svelte'
  import SidebarButton from '$lib/ui/sidebar/SidebarButton.svelte'

  interface Props {
    style?: string
    class?: ClassValue
  }

  let { style = '', class: clazz = '' }: Props = $props()
</script>

<nav
  aria-label={$t('aria.sidebar.title')}
  class={['flex flex-col overflow-auto gap-1', clazz]}
  {style}
>
  <SidebarButton href="/" label={$t('nav.home')} icon={House} exact />
  <ProfileSelection
    selectable={!(
      LINKED_INSTANCE_URL &&
      !profile.current.jwt &&
      profile.meta.profiles.length == 1
    )}
    profiles={profile.meta.profiles}
  />
  <EndPlaceholder margin="sm" size="xs">{$t('profile.profile')}</EndPlaceholder>
  {#if profile.current?.jwt}
    <SidebarButton
      icon={CircleUser}
      href={profile.current.type === 'authenticated'
        ? `/profile/${encodeURIComponent(profile.current.handle)}`
        : '/login'}
      label={$t('profile.profile')}
    />
  {:else}
    <SidebarButton href="/login" label={$t('account.login')} icon={LogIn} />
    <SidebarButton
      href="/accounts"
      label={$t('account.accounts')}
      icon={Users}
    />
  {/if}
  <EndPlaceholder margin="sm" size="xs">{$t('nav.menu.app')}</EndPlaceholder>
  <SidebarButton
    href="/settings"
    label={$t('nav.menu.settings')}
    icon={Settings}
  />
  <Select bind:value={theme.colorScheme} size="sm">
    {#snippet target(attachment)}
      <SidebarButton
        {@attach attachment}
        label={$t('nav.menu.colorscheme.label')}
        icon={theme.colorScheme == 'system'
          ? Monitor
          : theme.colorScheme == 'light'
            ? Sun
            : Moon}
        class="w-full relative"
      >
        <Option value="system" class="hidden" icon={Monitor}>
          {$t('nav.menu.colorscheme.system')}
        </Option>
        <Option value="light" class="hidden" icon={Sun}>
          {$t('nav.menu.colorscheme.light')}
        </Option>
        <Option value="dark" class="hidden" icon={Moon}>
          {$t('nav.menu.colorscheme.dark')}
        </Option>
        <Icon size="16" src={ChevronsUpDown} class="ml-auto" />
      </SidebarButton>
    {/snippet}
  </Select>
  <SidebarButton href="/theme" label={$t('nav.menu.theme')} icon={SwatchBook} />
  <!-- TODO: Re-enable communities/moderates lists when Coves API provides user data -->

  <div class="flex-1 h-full mt-auto"></div>
</nav>
