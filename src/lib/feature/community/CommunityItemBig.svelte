<script lang="ts">
  import type {
    CommunityView,
    CommunityViewDetailed,
  } from '$lib/api/coves/types'
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import Blobs from '$lib/ui/generic/Blobs.svelte'
  import { Button, modal, toast } from 'mono-svelte'
  import type { Snippet } from 'svelte'
  import { Check, Icon, InformationCircle, Plus } from 'svelte-hero-icons/dist'
  import CommunityCard from './CommunityCard.svelte'
  import { communityDisplayName, communityIdentifier } from './helpers'
  import { withPreset } from '$lib/feature/post/image-proxy'

  interface Props {
    community: CommunityView
    children?: Snippet
  }

  let { community = $bindable(), children }: Props = $props()

  function getBanner(c: CommunityView): string | undefined {
    return (c as CommunityViewDetailed).banner
  }

  let banner = $derived(getBanner(community))
  let bannerError = $state(false)
</script>

{#snippet communityInfo()}
  <CommunityCard {community} />
{/snippet}

<div
  class={[
    'flex flex-col items-start gap-2 p-4 h-full cursor-pointer',
    'rounded-[inherit] overflow-hidden hover:bg-slate-50 hover:dark:bg-zinc-925 relative z-0 transition-colors',
  ]}
>
  <a
    href="/c/{communityIdentifier(community)}"
    aria-label={$t('aria.postDecor.openLink')}
    class="absolute inset-0 z-10"
  ></a>
  <div
    class="-m-4 mask-b-from-25% relative h-24"
    style="min-width: calc(100% + calc(var(--spacing) * 8));"
  >
    {#if banner && !bannerError}
      <img
        src={withPreset(banner, 'banner')}
        onerror={() => (bannerError = true)}
        alt=""
        class="object-cover min-h-full min-w-full"
      />
    {:else}
      <div class="scale-200 min-w-full mask-b-from-25%">
        <Blobs seed={community.name} />
      </div>
    {/if}
  </div>
  <div class="flex flex-row justify-between w-full items-start">
    <header class="flex-1 flex flex-col group">
      <h3
        class="font-medium overflow-hidden text-ellipsis leading-5 text-xl font-display"
      >
        {communityDisplayName(community)}
      </h3>
      <p class="text-sm text-slate-600 dark:text-zinc-400">
        {communityIdentifier(community)}
      </p>
    </header>
    <Avatar
      url={community.avatar}
      alt={communityDisplayName(community)}
      width={48}
      circle={null}
      class="rounded-xl"
    />
  </div>
  {#if community.visibility === 'private'}
    <span
      class="text-xs px-1.5 py-0.5 rounded bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-zinc-400"
    >
      {$t('routes.admin.config.listingType.local')}
    </span>
  {/if}
  <div class="flex gap-2 items-center justify-end w-full z-30 mt-auto">
    <Button
      rounding="xl"
      color="ghost"
      onclick={() =>
        modal({ title: $t('form.post.community'), snippet: communityInfo })}
      aria-label={$t('common.info')}
      size="square-md"
    >
      <Icon src={InformationCircle} size="16" mini />
    </Button>
    {#if profile.current?.jwt}
      {@const subscribed = community.viewer?.subscribed === true}
      <Button
        disabled={!profile.current?.jwt}
        onclick={async () => {
          const wasSubscribed = community.viewer?.subscribed === true
          try {
            if (wasSubscribed) {
              await coves().unsubscribe({ community: community.did })
            } else {
              await coves().subscribe({ community: community.did })
            }
            if (community.viewer) {
              community.viewer.subscribed = !wasSubscribed
            } else {
              community.viewer = { subscribed: !wasSubscribed }
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err)
            toast({ content: errorMsg, type: 'error' })
          }
        }}
        title={subscribed
          ? $t('cards.community.subscribed')
          : $t('cards.community.subscribe')}
        color={subscribed ? 'secondary' : 'primary'}
        class={[subscribed && 'text-slate-600 dark:text-zinc-400']}
        icon={subscribed ? Check : Plus}
      >
        <span class={['@md:block']}>
          {#if subscribed}
            {$t('cards.community.subscribed')}
          {:else}
            {$t('cards.community.subscribe')}
          {/if}
        </span>
      </Button>
    {/if}
  </div>
  {#if children}
    <div class="flex flex-row gap-2 items-center">
      {@render children?.()}
    </div>
  {/if}
</div>
