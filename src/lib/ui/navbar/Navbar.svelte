<script lang="ts">
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import { Menu, Spinner } from 'mono-svelte'
  import {
    Bars3,
    GlobeAlt,
    Icon,
    MagnifyingGlass,
    PencilSquare,
    ServerStack,
    ShieldCheck,
  } from 'svelte-hero-icons/dist'
  import type { ClassValue } from 'svelte/elements'
  import Avatar from '../generic/Avatar.svelte'
  import CommandsWrapper, { chords } from './commands/CommandsHost.svelte'
  import NavButton from './NavButton.svelte'

  interface Props {
    style?: string
    class?: ClassValue
  }

  let { style = '', class: clazz = '' }: Props = $props()
</script>

<CommandsWrapper />
<nav class={['navbar @container', clazz]} {style} data-sveltekit-preload-data>
  <div class="hidden md:block md:flex-1"></div>
  <div class="sr-only md:not-sr-only md:contents">
    {#if profile.isAdmin}
      <NavButton
        href="/admin"
        label={$t('nav.admin')}
        icon={ServerStack}
        class="relative order-0"
        isSelectedFilter={(path) => path.startsWith('/admin')}
      />
    {/if}
    {#if profile.isMod()}
      <NavButton
        href="/moderation"
        label={$t('nav.moderation')}
        class="relative order-0"
        icon={ShieldCheck}
      />
    {/if}
  </div>
  <NavButton
    href="/explore/communities"
    label={$t('routes.explore.title')}
    icon={GlobeAlt}
    isSelectedFilter={(path) => path.startsWith('/explore')}
    class="order-1"
  />
  <NavButton
    href="/search"
    label={$t('nav.search')}
    icon={MagnifyingGlass}
    class="order-3 md:order-2"
  />
  <NavButton
    label={$t('nav.create.label')}
    href="/create"
    isSelectedFilter={(path) => path.startsWith('/create')}
    icon={PencilSquare}
    class="order-2 md:order-3 nav-btn-sm-primary"
  />
  <Menu placement="bottom">
    {#snippet target(attachment)}
      <button
        {@attach attachment}
        class={[
          'w-10 h-10 rounded-full',
          'transition-all relative grid place-items-center',
          ' group cursor-pointer order-4',
        ]}
        title={$t('profile.profile')}
      >
        {#if profile.current?.jwt}
          <div
            class={[
              'h-full aspect-square object-cover rounded-full grid place-items-center',
              'border-slate-200 dark:border-zinc-700 hover:bg-slate-200 dark:hover:bg-zinc-700 bg-slate-50 dark:bg-zinc-900',
            ]}
          >
            <Avatar
              url={profile.current.avatar}
              width={36}
              alt={profile.current.handle}
              class="group-hover:scale-90 transition-transform group-active:scale-85"
            />
          </div>
        {:else}
          <div class="w-full h-full grid place-items-center">
            <Icon src={Bars3} micro size="18" />
          </div>
        {/if}
      </button>
    {/snippet}
    {#snippet children(open)}
      {#if open}
        {#await import('./Profile.svelte')}
          <div class="p-8 w-full h-full grid place-items-center">
            <Spinner width={20} />
          </div>
        {:then { default: Profile }}
          <Profile />
        {/await}
      {/if}
    {/snippet}
  </Menu>
</nav>

<style>
  @reference '../../../app.css';

  .navbar {
    width: 100%;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-evenly;
    padding: calc(var(--spacing) * 2);
    box-sizing: border-box;

    @variant max-md {
      padding-left: calc(var(--spacing) * 8);
      padding-right: calc(var(--spacing) * 8);

      & > :global(*) {
        flex: 1;
      }
    }

    @variant md {
      gap: calc(var(--spacing) * 1);
    }
  }

  .navbar button:last-of-type {
    @variant md {
      margin-left: calc(var(--spacing) * 2);
    }
  }
</style>
