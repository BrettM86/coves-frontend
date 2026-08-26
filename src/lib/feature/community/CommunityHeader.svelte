<script lang="ts">
  import type { CommunityViewDetailed } from '$lib/api/coves/types'
  import { profile } from '$lib/app/state/auth.svelte'
  import { locale, t } from '$lib/app/state/i18n'
  import EntityHeader from '$lib/feature/shell/EntityHeader.svelte'
  import { action, Button, Menu, MenuButton, modal, toast } from '$lib/ui/kit'
  import { formatRelativeDate } from '$lib/ui/util/RelativeDate.svelte'
  import {
    Cog6Tooth,
    EllipsisHorizontal,
    Fire,
    Icon,
  } from 'svelte-hero-icons/dist'
  import { purgeCommunity } from './CommunityCard.svelte'
  import SubscribeButton from './SubscribeButton.svelte'
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
    community,
    banner = true,
    class: clazz = '',
    compact,
    ...rest
  }: Props = $props()
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
      value: formatRelativeDate(
        new Date(community.createdAt),
        {
          style: 'short',
        },
        $locale,
      ).toString(),
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
    <SubscribeButton {community} variant="header" />

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
