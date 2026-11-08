<script lang="ts">
  import type { ProfileViewDetailed } from '$lib/api/coves/types'
  import { locale, t } from '$lib/app/state/i18n'
  import { userLink } from '$lib/app/util/links'
  import { PostBody } from '$lib/feature/post'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import Blobs from '$lib/ui/generic/Blobs.svelte'
  import { Popover, toast } from '$lib/ui/kit'
  import { Calendar, CircleHelp, Icon, QrCode } from '$lib/ui/kit/icon'
  import { publishedToDate } from '$lib/ui/util/date'
  import FormattedNumber from '$lib/ui/util/FormattedNumber.svelte'
  import type { ProfileTab } from './tabs'
  import UserActions from './UserActions.svelte'

  interface Props {
    profile: ProfileViewDetailed
  }

  let { profile }: Props = $props()

  let stats = $derived([
    {
      label: $t('content.posts'),
      value: profile.stats?.postCount ?? 0,
      tab: 'posts',
    },
    {
      label: $t('content.comments'),
      value: profile.stats?.commentCount ?? 0,
      tab: 'comments',
    },
    {
      label: $t('stats.memberships'),
      value: profile.stats?.membershipCount ?? 0,
      tab: undefined,
    },
  ] satisfies { label: string; value: number; tab?: ProfileTab }[])

  let joined = $derived(
    new Intl.DateTimeFormat($locale, {
      month: 'long',
      year: 'numeric',
    }).format(publishedToDate(profile.createdAt)),
  )

  async function copyDid(): Promise<void> {
    try {
      await navigator.clipboard.writeText(profile.did)
      toast({ content: $t('toast.copied'), type: 'success' })
    } catch (err) {
      toast({
        content: err instanceof Error ? err.message : String(err),
        type: 'error',
      })
    }
  }
</script>

<!-- Mirrors the mobile profile: an edge-to-edge banner with the avatar
     straddling its bottom edge and the identity beside it, then the stats,
     join date and bio. The negative margins cancel <main>'s padding. -->
<section class="-mx-3 -mt-3 sm:-mx-6 sm:-mt-6">
  <div data-profile-banner class="relative h-36 sm:h-52 overflow-hidden">
    {#if profile.banner}
      <img
        src={profile.banner}
        class="size-full object-cover"
        height="192"
        alt="User banner"
      />
    {:else}
      <div class="scale-150 size-full">
        <Blobs seed={profile.handle ?? profile.did} />
      </div>
    {/if}
    <div
      class="absolute inset-x-0 top-0 h-16 bg-linear-to-b from-black/45 to-transparent pointer-events-none"
    ></div>
    <div data-profile-banner-actions class="absolute right-3 top-3 sm:right-4">
      <UserActions {profile} />
    </div>
  </div>

  <div class="flex items-start gap-3 px-4 sm:px-6">
    <div
      class="relative z-10 -mt-7 sm:-mt-8 shrink-0 rounded-full border-3 border-slate-50 dark:border-zinc-950 shadow-md"
    >
      {#snippet avatar(width: number)}
        <Avatar
          {width}
          url={profile.avatar}
          did={profile.did}
          alt={profile.displayName || profile.handle || profile.did}
          circle
        />
      {/snippet}
      <div class="sm:hidden">{@render avatar(74)}</div>
      <div class="hidden sm:block">{@render avatar(98)}</div>
    </div>
    <div class="min-w-0 flex-1 pt-1.5 sm:pt-2.5 space-y-0.5">
      {#snippet didRow()}
        <div
          class="flex max-w-full items-center gap-1.5 text-xs text-slate-500 dark:text-zinc-400"
        >
          <button
            type="button"
            class="flex min-w-0 items-center gap-1 font-mono hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer"
            title={profile.did}
            onclick={copyDid}
          >
            <Icon src={QrCode} size="14" class="shrink-0" />
            <span class="truncate">{profile.did}</span>
          </button>
          <Popover placement="bottom-start">
            {#snippet target(attachment)}
              <button
                {@attach attachment}
                type="button"
                class="shrink-0 rounded-full hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer"
                aria-label={$t('routes.profile.didHint')}
              >
                <Icon src={CircleHelp} size="14" />
              </button>
            {/snippet}
            <p class="max-w-64 p-1 text-xs leading-relaxed">
              {$t('routes.profile.didHint')}
            </p>
          </Popover>
        </div>
      {/snippet}
      <h1 class="text-xl font-bold tracking-tight truncate">
        {profile.displayName || `@${profile.handle ?? profile.did}`}
      </h1>
      {#if profile.displayName && profile.handle}
        <p class="text-sm text-slate-600 dark:text-zinc-400 truncate">
          @{profile.handle}
        </p>
      {/if}
      {@render didRow()}
    </div>
  </div>

  <div class="px-4 sm:px-6 pt-3 pb-1 space-y-3 text-sm">
    <p class="flex flex-wrap gap-x-4 gap-y-2">
      {#each stats as stat (stat.label)}
        <svelte:element
          this={stat.tab ? 'a' : 'span'}
          href={stat.tab && `${userLink(profile)}?type=${stat.tab}`}
          class={stat.tab && 'hover:underline'}
        >
          <FormattedNumber number={stat.value} class="font-bold" />
          <span class="text-slate-600 dark:text-zinc-400">{stat.label}</span>
        </svelte:element>
      {/each}
    </p>
    <p
      class="flex items-center gap-1.5 text-[13px] text-slate-600 dark:text-zinc-400"
    >
      <Icon src={Calendar} size="14" />
      {$t('stats.joined')}
      {joined}
    </p>
    {#if profile.description}
      <!-- Bios are short, so the collapse fade is never needed, and full
           contrast reads as the person's own words like on Bluesky. -->
      <PostBody
        body={profile.description}
        clickThrough={false}
        collapsible={false}
        class="text-slate-900! dark:text-zinc-100!"
      />
    {/if}
  </div>
</section>
