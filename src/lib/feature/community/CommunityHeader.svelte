<script lang="ts">
  import type { CommunityViewDetailed } from '$lib/api/coves/types'
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import EntityHeader from '$lib/ui/generic/EntityHeader.svelte'
  import { action, Button, Menu, MenuButton, modal, toast } from 'mono-svelte'
  import { formatRelativeDate } from 'mono-svelte/util/RelativeDate.svelte'
  import {
    Check,
    Cog6Tooth,
    EllipsisHorizontal,
    Fire,
    Icon,
    Plus,
  } from 'svelte-hero-icons/dist'
  import { purgeCommunity } from './CommunityCard.svelte'
  import {
    communityDisplayName,
    communityHandleOrName,
    communityIdentifier,
  } from './helpers'

  interface Props {
    community: CommunityViewDetailed
    banner?: boolean
    class?: string
    compact?: 'always' | 'lg'
    avatarCircle?: boolean
  }

  let {
    community = $bindable(),
    banner = true,
    class: clazz = '',
    compact,
    ...rest
  }: Props = $props()

  let subscribing = $state(false)

  async function handleSubscribe(): Promise<void> {
    if (!profile.current?.jwt) return
    subscribing = true

    const wasSubscribed = community.viewer?.subscribed === true

    try {
      if (wasSubscribed) {
        await coves().unsubscribe({ community: community.did })
      } else {
        await coves().subscribe({ community: community.did })
      }

      // Toggle state only on success
      if (community.viewer) {
        community.viewer.subscribed = !wasSubscribed
      } else {
        community.viewer = { subscribed: !wasSubscribed }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      toast({ content: errorMsg, type: 'error' })
    }

    subscribing = false
  }
</script>

<EntityHeader
  {...rest}
  {compact}
  banner={banner ? community.banner : undefined}
  avatar={community.avatar}
  name={communityDisplayName(community)}
  url="/c/{communityIdentifier(community)}"
  stats={[
    {
      name: $t('cards.community.members'),
      value: community.subscriberCount.toString(),
    },
    {
      name: $t('content.posts'),
      value: community.postCount.toString(),
    },
    {
      name: $t('stats.created'),
      format: false,
      value: formatRelativeDate(new Date(community.createdAt), {
        style: 'short',
      }).toString(),
    },
  ]}
  bio={community.description}
  class={['tracking-normal', clazz]}
>
  {#snippet nameDetail()}
    <button
      onclick={() => {
        navigator?.clipboard?.writeText?.(
          `!${communityHandleOrName(community)}`,
        )
        toast({ content: $t('toast.copied') })
      }}
      class="text-sm flex gap-0 items-center"
    >
      !{communityHandleOrName(community)}
    </button>
  {/snippet}
  <div
    class={[
      'flex items-center gap-2 h-max w-max',
      compact == 'lg' && 'lg:hidden',
    ]}
  >
    {#if profile.current?.jwt}
      {@const subscribed = community.viewer?.subscribed === true}
      <Button
        disabled={subscribing}
        loading={subscribing}
        color={!subscribed ? 'primary' : 'secondary'}
        onclick={handleSubscribe}
        class="relative z-[inherit]"
        size="lg"
        icon={subscribed ? Check : Plus}
      >
        {subscribed
          ? $t('cards.community.subscribed')
          : $t('cards.community.subscribe')}
      </Button>
    {/if}

    {#if profile.isMod(community)}
      <Button
        color="secondary"
        size="square-lg"
        href="/c/{communityIdentifier(community)}/settings"
      >
        <Icon src={Cog6Tooth} size="16" mini />
      </Button>
    {/if}
    {#if profile.current?.jwt && profile.isAdmin}
      <Menu placement="top-end">
        {#snippet target(attachment)}
          <Button
            {@attach attachment}
            size="square-lg"
            icon={EllipsisHorizontal}
          ></Button>
        {/snippet}
        <MenuButton
          color="danger-subtle"
          onclick={() =>
            modal({
              title: $t('admin.purgeCommunity.title'),
              body: `${communityDisplayName(community)}: ${$t('admin.purgeCommunity.warning')}`,
              actions: [
                action({
                  close: true,
                  content: $t('common.cancel'),
                }),
                action({
                  action: () => purgeCommunity(community.did),
                  close: true,
                  content: $t('admin.purge'),
                  type: 'danger',
                  icon: Fire,
                }),
              ],
              dismissable: true,
              type: 'error',
            })}
          icon={Fire}
        >
          {$t('admin.purge')}
        </MenuButton>
      </Menu>
    {/if}
  </div>
</EntityHeader>
