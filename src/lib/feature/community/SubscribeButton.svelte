<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/state/auth.svelte'
  import { errorMessage } from '$lib/app/util/error'
  import { t } from '$lib/app/state/i18n'
  import { Button, toast } from '$lib/ui/kit'
  import { Check, Plus } from '$lib/ui/kit/icon'
  import {
    isSubscribed,
    isSubscriptionPending,
    toggleSubscription,
    type SubscribableCommunity,
  } from './subscription.svelte'

  interface Props {
    community: SubscribableCommunity
    /**
     * Where the button sits; picks size and shape.
     * - `header`: community page header (large)
     * - `card`: sidebar/info card (medium, left-aligned)
     * - `row`: list row; collapses to an icon in `compact` view on narrow containers
     * - `tile`: explore-page tile
     */
    variant: 'header' | 'card' | 'row' | 'tile'
    /** Row layout only. */
    view?: 'cozy' | 'compact'
  }

  let { community, variant, view = 'compact' }: Props = $props()

  let subscribed = $derived(isSubscribed(community))
  let pending = $derived(isSubscriptionPending(community))
  let label = $derived(
    subscribed
      ? $t('cards.community.subscribed')
      : $t('cards.community.subscribe'),
  )

  async function onPress(): Promise<void> {
    const outcome = await toggleSubscription(community, coves())
    if (outcome.kind === 'error') {
      toast({ content: errorMessage(outcome.error), type: 'error' })
    }
  }
</script>

{#if profile.current?.jwt}
  {#if variant === 'header'}
    <Button
      disabled={pending}
      loading={pending}
      color={subscribed ? 'secondary' : 'primary'}
      onclick={onPress}
      class="relative z-[inherit]"
      size="lg"
      icon={subscribed ? Check : Plus}
    >
      {label}
    </Button>
  {:else if variant === 'card'}
    <Button
      disabled={pending}
      loading={pending}
      size="md"
      color={subscribed ? 'secondary' : 'primary'}
      onclick={onPress}
      class="px-4 relative z-[inherit]"
      alignment="left"
      icon={subscribed ? Check : Plus}
    >
      {label}
    </Button>
  {:else if variant === 'row'}
    <Button
      disabled={pending}
      onclick={onPress}
      size="custom"
      title={label}
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
        {label}
      </span>
    </Button>
  {:else}
    <Button
      disabled={pending}
      onclick={onPress}
      title={label}
      color={subscribed ? 'secondary' : 'primary'}
      class={[subscribed && 'text-slate-600 dark:text-zinc-400']}
      icon={subscribed ? Check : Plus}
    >
      <span class={['@md:block']}>
        {label}
      </span>
    </Button>
  {/if}
{/if}
