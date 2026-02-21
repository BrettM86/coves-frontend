<script lang="ts" module>
  import { env } from '$env/dynamic/public'
  import type { AuthorView } from '$lib/api/coves/types'
  import { settings } from '$lib/app/settings.svelte'
  import { userLink } from '$lib/app/util.svelte'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import Logo from '$lib/ui/generic/Logo.svelte'
  import { Icon, type IconSource, Language } from 'svelte-hero-icons/dist'

  function parseBadge(): Record<string, string[]> {
    try {
      if (env.PUBLIC_BADGES) {
        return JSON.parse(env.PUBLIC_BADGES) as Record<string, string[]>
      } else {
        return {}
      }
    } catch {
      return {}
    }
  }

  const badges = parseBadge()

  const getEnvBadge = (
    did: string,
  ):
    | {
        classes: string
        icon: 'kelp' | IconSource
        iconClass?: string
      }
    | false => {
    if (badges.kelp && badges.kelp?.includes?.(did)) {
      return {
        classes:
          'bg-linear-to-r bg-clip-text text-transparent from-pink-500 to-fuchsia-500 dark:from-pink-400 dark:to-purple-400',
        icon: 'kelp',
      }
    }

    if (badges.translator && badges.translator?.includes?.(did)) {
      return {
        classes:
          'bg-linear-to-r bg-clip-text text-transparent from-sky-500 to-blue-700 dark:from-blue-300 dark:to-indigo-500',
        icon: Language,
        iconClass: 'text-blue-500 dark:text-blue-400',
      }
    }

    return false
  }
</script>

<script lang="ts">
  interface Props {
    user: AuthorView
    avatar?: boolean
    avatarSize?: number
    badges?: boolean
    inComment?: boolean
    showInstance?: boolean
    displayName?: boolean
    instanceClass?: string
    class?: string
    children?: import('svelte').Snippet
    extraBadges?: import('svelte').Snippet
  }

  let {
    user,
    avatar = false,
    avatarSize = 24,
    badges = true,
    inComment = false,
    showInstance = settings.showInstances.user ||
      (settings.showInstances.comments && inComment),
    displayName = settings.displayNames,
    instanceClass = '',
    class: clazz = '',
    children,
    extraBadges,
  }: Props = $props()

  let envBadge = $derived(getEnvBadge(user.did))
</script>

<a
  class="items-center inline-flex flex-row gap-1 hover:underline max-w-full min-w-0 {clazz}"
  href={userLink(user)}
  data-sveltekit-preload-data="tap"
>
  {@render children?.()}
  {#if avatar}
    <Avatar
      url={user.avatar}
      alt={user.handle}
      width={avatarSize}
      class="shrink-0"
    />
  {/if}
  <span
    class="flex gap-0 items-center shrink max-w-full min-w-0"
    class:ml-0.5={avatar}
  >
    <span
      class:font-medium={showInstance}
      class="username-text {envBadge && envBadge.classes}"
    >
      {displayName ? user.displayName || user.handle : user.handle}
    </span>
    {#if showInstance}
      <span
        class="text-slate-500 dark:text-zinc-500 font-normal instance-text shrink {instanceClass ??
          ''}"
      >
        @{user.handle}
      </span>
    {/if}
  </span>
  {#if badges}
    {#if envBadge}
      {#if envBadge.icon == 'kelp'}
        <Logo width={16} />
      {:else}
        <Icon
          src={envBadge.icon}
          micro
          size="16"
          class={envBadge.iconClass ?? envBadge.classes}
        />
      {/if}
    {/if}
    {@render extraBadges?.()}
  {/if}
</a>

<style>
  .instance-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    max-width: 100%;
    flex: 1;
  }

  .username-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
