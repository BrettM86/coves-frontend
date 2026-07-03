<script lang="ts">
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import { LINKED_INSTANCE_URL } from '$lib/app/instance.svelte'
  import { theme } from '$lib/app/theme/theme.svelte'
  import ProfileSelection from '$lib/feature/user/ProfileSelection.svelte'
  import { Option, Select } from 'mono-svelte'
  import {
    ArrowLeftOnRectangle,
    ChevronUpDown,
    Cog6Tooth,
    ComputerDesktop,
    Home,
    Icon,
    Moon,
    Sun,
    Swatch,
    UserCircle,
    UserGroup,
  } from 'svelte-hero-icons/dist'
  import type { ClassValue } from 'svelte/elements'
  import EndPlaceholder from '../layout/EndPlaceholder.svelte'
  import SidebarButton from './SidebarButton.svelte'

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
  <SidebarButton href="/" label={$t('nav.home')} icon={Home} exact />
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
      icon={UserCircle}
      href={profile.current.type === 'authenticated'
        ? `/profile/${encodeURIComponent(profile.current.handle)}`
        : '/login'}
      label={$t('profile.profile')}
    />
  {:else}
    <SidebarButton
      href="/login"
      label={$t('account.login')}
      icon={ArrowLeftOnRectangle}
    />
    <SidebarButton
      href="/accounts"
      label={$t('account.accounts')}
      icon={UserGroup}
    />
  {/if}
  <EndPlaceholder margin="sm" size="xs">{$t('nav.menu.app')}</EndPlaceholder>
  <SidebarButton
    href="/settings"
    label={$t('nav.menu.settings')}
    icon={Cog6Tooth}
  />
  <Select bind:value={theme.colorScheme} size="sm">
    {#snippet target(attachment)}
      <SidebarButton
        {@attach attachment}
        label={$t('nav.menu.colorscheme.label')}
        icon={theme.colorScheme == 'system'
          ? ComputerDesktop
          : theme.colorScheme == 'light'
            ? Sun
            : Moon}
        class="w-full relative"
      >
        <Option value="system" class="hidden" icon={ComputerDesktop}>
          {$t('nav.menu.colorscheme.system')}
        </Option>
        <Option value="light" class="hidden" icon={Sun}>
          {$t('nav.menu.colorscheme.light')}
        </Option>
        <Option value="dark" class="hidden" icon={Moon}>
          {$t('nav.menu.colorscheme.dark')}
        </Option>
        <Icon micro size="16" src={ChevronUpDown} class="ml-auto" />
      </SidebarButton>
    {/snippet}
  </Select>
  <SidebarButton href="/theme" label={$t('nav.menu.theme')} icon={Swatch} />
  <!-- TODO: Re-enable communities/moderates lists when Coves API provides user data -->

  <div class="flex-1 h-full mt-auto"></div>
</nav>
