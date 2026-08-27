<script lang="ts">
  import type { CommunityView } from '$lib/api/coves/types'
  import { locale, t } from '$lib/app/state/i18n'
  import CommonItem from '$lib/ui/layout/CommonItem.svelte'
  import { Button, modal } from '$lib/ui/kit'
  import type { Snippet } from 'svelte'
  import { Icon, InformationCircle } from '@xylightdev/svelte-hero-icons'
  import CommunityCard from './CommunityCard.svelte'
  import SubscribeButton from './SubscribeButton.svelte'
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
    community,
    view = 'compact',
    showCounts = true,
    children,
  }: Props = $props()
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
    <SubscribeButton {community} variant="row" {view} />
  {:else}
    {@render children?.()}
  {/if}
</CommonItem>
