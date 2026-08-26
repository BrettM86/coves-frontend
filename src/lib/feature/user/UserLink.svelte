<script lang="ts" module>
  import { env } from '$env/dynamic/public'
  import type { AuthorView, ProfileViewDetailed } from '$lib/api/coves/types'
  import { userLink } from '$lib/app/util/links'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import Logo from '$lib/ui/generic/Logo.svelte'
  import { Icon, type IconSource, Language } from 'svelte-hero-icons/dist'
  import { userLabel } from './helpers'

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
    /**
     * Any user-shaped view. `ProfileViewDetailed` omits `handle`, so the
     * label and link both fall back to the DID rather than rendering
     * `@undefined`.
     */
    user: AuthorView | ProfileViewDetailed
    avatar?: boolean
    avatarSize?: number
    badges?: boolean
    class?: string
    children?: import('svelte').Snippet
    extraBadges?: import('svelte').Snippet
  }

  let {
    user,
    avatar = false,
    avatarSize = 24,
    badges = true,
    class: clazz = '',
    children,
    extraBadges,
  }: Props = $props()

  let envBadge = $derived(getEnvBadge(user.did))
  let label = $derived(userLabel(user))
</script>

<!--
  @component
  Links to a user, labelled by their handle. The handle is the account's
  identity in atproto and the only part of it that can't be spoofed, so it is
  always the label — display names are freeform and, on bridged accounts,
  usually just restate the handle's username ("Alice" vs `@alice.example.io`).
  Display names still appear on the profile page, where there is room for both.
-->
<a
  class="items-center inline-flex flex-row gap-1 hover:underline max-w-full min-w-0 {clazz}"
  href={userLink(user)}
  data-sveltekit-preload-data="tap"
>
  {@render children?.()}
  {#if avatar}
    <Avatar url={user.avatar} alt={label} width={avatarSize} class="shrink-0" />
  {/if}
  <span
    class="font-medium handle-text shrink min-w-0 {envBadge &&
      envBadge.classes}"
    class:ml-0.5={avatar}
  >
    {label}
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
  .handle-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
</style>
