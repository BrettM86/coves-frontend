<script lang="ts">
  import { page } from '$app/state'
  import { loginUrl } from '$lib/app/util/login-url'
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { LINKED_INSTANCE_URL } from '$lib/app/state/instance.svelte'
  import { theme } from '$lib/app/state/theme/theme.svelte'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import { Button, Option, Select } from '$lib/ui/kit'
  import {
    Icon,
    ChevronsUpDown,
    CircleUser,
    House,
    LogIn,
    Info,
    Monitor,
    Moon,
    Settings,
    Sun,
    SwatchBook,
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
  <Button
    href={profile.current.type === 'authenticated'
      ? `/profile/${encodeURIComponent(profile.current.handle)}`
      : loginUrl(page.url)}
    color="tertiary"
    alignment="left"
    size="md"
    rounding="xl"
    class="flex flex-row gap-2! items-center"
  >
    {#snippet prefix()}
      <Avatar
        url={profile.current.avatar}
        alt={profile.current.handle}
        width={24}
      />
    {/snippet}
    <div class="flex-1">
      <div class="font-medium">
        {profile.current.handle ?? $t('account.guest')}
      </div>
      {#if !LINKED_INSTANCE_URL}
        <div class="text-xs text-slate-500 dark:text-zinc-500">
          {profile.current.instance}
        </div>
      {/if}
    </div>
  </Button>
  <EndPlaceholder margin="sm" size="xs">{$t('profile.profile')}</EndPlaceholder>
  {#if profile.current.type === 'authenticated'}
    <SidebarButton
      icon={CircleUser}
      href={`/profile/${encodeURIComponent(profile.current.handle)}`}
      label={$t('profile.profile')}
    />
  {:else}
    <SidebarButton
      href={loginUrl(page.url)}
      label={$t('account.login')}
      icon={LogIn}
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
  <SidebarButton href="/legal" label="Legal &amp; source" icon={Info} />
  <!-- TODO: Re-enable communities/moderates lists when Coves API provides user data -->

  <div class="flex-1 h-full mt-auto"></div>
</nav>
