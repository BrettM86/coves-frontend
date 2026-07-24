<script lang="ts">
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import { settings } from '$lib/app/settings.svelte'
  import { theme } from '$lib/app/theme/theme.svelte'
  import CovesSidebar from '$lib/feature/instance/CovesSidebar.svelte'
  import {
    Badge,
    Button,
    MenuButton,
    MenuDivider,
    modal,
    Option,
    Select,
    toast,
  } from 'mono-svelte'
  import {
    ArrowLeftOnRectangle,
    BugAnt,
    Cog6Tooth,
    CommandLine,
    ComputerDesktop,
    Icon,
    Moon,
    ServerStack,
    Sun,
    Swatch,
    UserCircle,
    UserGroup,
  } from 'svelte-hero-icons/dist'
  import { chords } from './commands/CommandsHost.svelte'
</script>

{#snippet siteSnippet()}
  <CovesSidebar />
{/snippet}

{#if profile.current?.jwt}
  <MenuDivider>{$t('profile.profile')}</MenuDivider>
  <MenuButton
    href={profile.current.type === 'authenticated'
      ? `/profile/${encodeURIComponent(profile.current.handle)}`
      : '/login'}
    icon={UserCircle}
  >
    {$t('profile.profile')}
  </MenuButton>
{:else}
  <MenuButton href="/accounts/login" icon={ArrowLeftOnRectangle}>
    {$t('account.login')}
  </MenuButton>
{/if}
<MenuButton href="/accounts" icon={UserGroup}>
  {$t('account.accounts')}
</MenuButton>
<MenuDivider>{$t('nav.menu.app')}</MenuDivider>
<MenuButton href="/settings" icon={Cog6Tooth}>
  {$t('nav.menu.settings')}
</MenuButton>
<Select bind:value={theme.colorScheme} size="sm" placement="bottom">
  {#snippet target(attachment)}
    <MenuButton
      {@attach attachment}
      icon={theme.colorScheme == 'system'
        ? ComputerDesktop
        : theme.colorScheme == 'light'
          ? Sun
          : Moon}
      class=" w-full"
      nest
    >
      {$t('nav.menu.colorscheme.label')}
    </MenuButton>
    <Option value="system" class="hidden" icon={ComputerDesktop}>
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
<MenuButton href="/theme" icon={Swatch}>
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
  icon={CommandLine}
>
  {$t('nav.commands.prompt')}
  <div class="text-slate-600 dark:text-zinc-400 text-xs ml-auto max-sm:hidden">
    {@render key('Ctrl')}
    {@render key('K')}
  </div>
</MenuButton>
{#if settings.debugInfo}
  <MenuButton href="/util" icon={BugAnt}>Debug</MenuButton>
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
      <Icon src={ServerStack} size="16" micro />
    </Button>
  </div>
</li>
