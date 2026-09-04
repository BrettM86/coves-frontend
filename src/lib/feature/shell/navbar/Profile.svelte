<script lang="ts">
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { settings } from '$lib/app/state/settings.svelte'
  import { theme } from '$lib/app/state/theme/theme.svelte'
  import CovesSidebar from '$lib/feature/instance/CovesSidebar.svelte'
  import { logout } from '$lib/feature/user/logout'
  import {
    Badge,
    Button,
    MenuButton,
    MenuDivider,
    modal,
    Option,
    Select,
    toast,
  } from '$lib/ui/kit'
  import {
    Icon,
    Bug,
    Ban,
    CircleUser,
    LogIn,
    LogOut,
    Monitor,
    Moon,
    Server,
    Settings,
    Sun,
    SwatchBook,
    Terminal,
  } from '$lib/ui/kit/icon'
  import { chords } from './commands/CommandsHost.svelte'
</script>

{#snippet siteSnippet()}
  <CovesSidebar />
{/snippet}

{#if profile.current.type === 'authenticated'}
  <MenuDivider>{$t('profile.profile')}</MenuDivider>
  <MenuButton
    href={`/profile/${encodeURIComponent(profile.current.handle)}`}
    icon={CircleUser}
  >
    {$t('profile.profile')}
  </MenuButton>
  <MenuButton href="/profile/blocks" icon={Ban}>
    {$t('routes.profile.blocks.title')}
  </MenuButton>
  <MenuButton onclick={() => logout()} icon={LogOut}>
    {$t('account.logout')}
  </MenuButton>
{:else}
  <MenuButton href="/login" icon={LogIn}>
    {$t('account.login')}
  </MenuButton>
{/if}
<MenuDivider>{$t('nav.menu.app')}</MenuDivider>
<MenuButton href="/settings" icon={Settings}>
  {$t('nav.menu.settings')}
</MenuButton>
<Select bind:value={theme.colorScheme} size="sm" placement="bottom">
  {#snippet target(attachment)}
    <MenuButton
      {@attach attachment}
      icon={theme.colorScheme == 'system'
        ? Monitor
        : theme.colorScheme == 'light'
          ? Sun
          : Moon}
      class=" w-full"
      nest
    >
      {$t('nav.menu.colorscheme.label')}
    </MenuButton>
    <Option value="system" class="hidden" icon={Monitor}>
      {$t('nav.menu.colorscheme.system')}
    </Option>
    <Option value="light" class="hidden" icon={Sun}>
      {$t('nav.menu.colorscheme.light')}
    </Option>
    <Option value="dark" class="hidden" icon={Moon}>
      {$t('nav.menu.colorscheme.dark')}
    </Option>
  {/snippet}
</Select>
<MenuButton href="/theme" icon={SwatchBook}>
  {$t('nav.menu.theme')}
</MenuButton>
{#snippet key(label: string)}
  <span
    class="text-[12px] rounded-md border border-slate-300 dark:border-zinc-700 border-b-2 px-2 py-0.5"
  >
    {label}
  </span>
{/snippet}
<MenuButton
  onclick={() => (chords.commands = !chords.commands)}
  icon={Terminal}
>
  {$t('nav.commands.prompt')}
  <div class="text-slate-600 dark:text-zinc-400 text-xs ml-auto max-sm:hidden">
    {@render key('Ctrl')}
    {@render key('K')}
  </div>
</MenuButton>
{#if settings.debugInfo}
  <MenuButton href="/util" icon={Bug}>Debug</MenuButton>
{/if}
<li class="flex flex-col px-2 py-1 mx-auto my-1 text-xs w-full">
  <div class="flex flex-row gap-2 w-full items-center">
    <div class="flex-1">
      <button
        class="hover:brightness-110 transition-all"
        onclick={() => {
          navigator?.clipboard?.writeText(__VERSION__)
          toast({ content: $t('toast.copied') })
        }}
      >
        <Badge color="blue-subtle">{__VERSION__}</Badge>
      </button>
    </div>
    <Button
      onclick={() => {
        modal({
          title: $t('nav.menu.instance'),
          snippet: siteSnippet,
          body: '',
        })
      }}
      color="tertiary"
      title={$t('nav.menu.instance')}
      size="square-md"
    >
      <Icon src={Server} size="16" />
    </Button>
  </div>
</li>
