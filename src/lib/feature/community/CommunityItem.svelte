<script lang="ts">
  import type { CommunityView } from '$lib/api/coves/types'
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/auth.svelte'
  import { locale, t } from '$lib/app/i18n'
  import CommonItem from '$lib/ui/layout/CommonItem.svelte'
  import { Button, modal, toast } from 'mono-svelte'
  import type { Snippet } from 'svelte'
  import { Check, Icon, InformationCircle, Plus } from 'svelte-hero-icons/dist'
  import CommunityCard from './CommunityCard.svelte'
  import {
    communityDisplayName,
    communityHandleOrName,
    communityIdentifier,
  } from './helpers'

  interface Props {
    community: CommunityView
    view?: 'cozy' | 'compact'
    showCounts?: boolean
    children?: Snippet
  }

  let {
    community = $bindable(),
    view = 'compact',
    showCounts = true,
    children,
  }: Props = $props()

  // Optimistic subscribe state lives locally instead of mutating the
  // `community` prop, which this component does not own (the list passes it
  // unbound). Server state wins again on the next load.
  let subscribedOverride = $state<boolean | undefined>(undefined)
  let subscribed = $derived(
    subscribedOverride ?? community.viewer?.subscribed === true,
  )

  async function toggleSubscribe(): Promise<void> {
    const wasSubscribed = subscribed
    try {
      if (wasSubscribed) {
        await coves().unsubscribe({ community: community.did })
      } else {
        await coves().subscribe({ community: community.did })
      }
      subscribedOverride = !wasSubscribed
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      toast({ content: errorMsg, type: 'error' })
    }
  }
</script>

{#snippet communityInfo()}
  <CommunityCard {community} />
{/snippet}

<CommonItem
  icon={community.avatar}
  href="/c/{communityIdentifier(community)}"
  title={communityDisplayName(community)}
  detail="{communityHandleOrName(community)}{!showCounts
    ? ` • ${Intl.NumberFormat($locale, { notation: 'compact' }).format(community.subscriberCount)}`
    : ''}"
  orientation={view == 'cozy' ? 'vertical' : 'horizontal'}
>
  {#if !children}
    {#if community.visibility === 'private'}
      <span
        class="text-xs px-1.5 py-0.5 rounded bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-zinc-400"
      >
        {$t('routes.admin.config.listingType.local')}
      </span>
    {/if}
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
      <Button
        disabled={!profile.current?.jwt}
        onclick={toggleSubscribe}
        size="custom"
        title={subscribed
          ? $t('cards.community.subscribed')
          : $t('cards.community.subscribe')}
        color={subscribed ? 'secondary' : 'primary'}
        rounding="xl"
        class={[
          subscribed && 'text-slate-600 dark:text-zinc-400',
          ' h-8.5 rounded-full',
          view == 'compact'
            ? 'aspect-square @md:px-2 @md:min-w-30 @md:aspect-auto'
            : 'px-3',
        ]}
        icon={subscribed ? Check : Plus}
      >
        <span class={[view == 'compact' && 'hidden', '@md:block']}>
          {#if subscribed}
            {$t('cards.community.subscribed')}
          {:else}
            {$t('cards.community.subscribe')}
          {/if}
        </span>
      </Button>
    {/if}
  {:else}
    {@render children?.()}
  {/if}
</CommonItem>
