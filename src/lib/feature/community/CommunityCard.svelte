<script lang="ts" module>
  import type { DID } from '$lib/types/atproto'
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/auth.svelte'
  import { errorMessage } from '$lib/app/error'
  import { t } from '$lib/app/i18n'
  import Markdown from '$lib/app/markdown/Markdown.svelte'
  import { settings } from '$lib/app/settings.svelte'
  import LabelStat from '$lib/ui/info/LabelStat.svelte'
  import EndPlaceholder from '$lib/ui/layout/EndPlaceholder.svelte'
  import SidebarButton from '$lib/ui/sidebar/SidebarButton.svelte'
  import {
    action,
    Button,
    Expandable,
    Menu,
    MenuButton,
    modal,
    removeToast,
    Spinner,
    toast,
  } from 'mono-svelte'
  import {
    Check,
    Cog6Tooth,
    EllipsisHorizontal,
    Fire,
    Icon,
    Newspaper,
    Plus,
    ShieldCheck,
  } from 'svelte-hero-icons/dist'

  /**
   * Block or unblock a community by DID.
   */
  export async function block(
    did: DID,
    shouldBlock: boolean,
  ): Promise<boolean> {
    try {
      const loading = toast({
        content: ``,
        loading: true,
      })

      if (shouldBlock) {
        await coves().blockCommunity({ community: did })
      } else {
        await coves().unblockCommunity({ community: did })
      }

      removeToast(loading)

      toast({
        content: !shouldBlock
          ? t.get('toast.unblockedCommunity')
          : t.get('toast.blockedCommunity'),
        type: 'success',
      })

      return shouldBlock
    } catch (err) {
      toast({ content: errorMessage(err), type: 'error' })
      return !shouldBlock
    }
  }

  /**
   * Purge a community by DID.
   * Not yet available in the Coves API.
   */
  export async function purgeCommunity(_did: DID): Promise<void> {
    toast({
      content: 'Purging communities is not yet available',
      type: 'warning',
    })
  }
</script>

<script lang="ts">
  import type {
    CommunityView as CovesCommunityView,
    CommunityViewDetailed,
  } from '$lib/api/coves/types'
  import EntityHeader from '$lib/ui/generic/EntityHeader.svelte'
  import { communityDisplayName, communityIdentifier } from './helpers'

  type CommunityType = CovesCommunityView | CommunityViewDetailed

  let loading = $state({
    subscribing: false,
  })

  async function subscribe(community: CommunityType): Promise<void> {
    if (!profile.current?.jwt) return
    loading.subscribing = true
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
      toast({ content: errorMessage(err), type: 'error' })
    }

    loading.subscribing = false
  }

  interface Props {
    community: CommunityType | Promise<CommunityType>
    class?: string
  }

  let { community = $bindable(), class: clazz = '' }: Props = $props()

  function hasDescription(c: CommunityType): c is CommunityViewDetailed {
    return 'description' in c && c.description !== undefined
  }

  function hasBanner(c: CommunityType): c is CommunityViewDetailed {
    return 'banner' in c && c.banner !== undefined
  }
</script>

{#await community}
  <div
    class="w-full h-full grid place-items-center"
    role="status"
    aria-label={$t('aria.loading')}
  >
    <Spinner width={24} />
  </div>
{:then community}
  <aside
    class={[
      'min-w-full pt-0 text-slate-600 dark:text-zinc-400 flex flex-col gap-1',
      clazz,
    ]}
  >
    <EntityHeader
      name={communityDisplayName(community)}
      avatar={community.avatar}
      banner={hasBanner(community) ? community.banner : undefined}
      avatarCircle={false}
    >
      {#snippet nameDetail()}
        !{communityIdentifier(community)}
      {/snippet}
    </EntityHeader>

    <EndPlaceholder size="xs" margin="sm">
      {$t('form.post.community')}
    </EndPlaceholder>
    {#if profile.current?.jwt}
      {@const subscribed = community.viewer?.subscribed === true}
      <Button
        disabled={loading.subscribing}
        loading={loading.subscribing}
        size="md"
        color={subscribed ? 'secondary' : 'primary'}
        onclick={() => subscribe(community)}
        class="px-4 relative z-[inherit]"
        alignment="left"
        icon={subscribed ? Check : Plus}
      >
        {subscribed
          ? $t('cards.community.subscribed')
          : $t('cards.community.subscribe')}
      </Button>
    {/if}
    {#if profile.isMod(community)}
      <SidebarButton
        href="/c/{communityIdentifier(community)}/settings"
        icon={Cog6Tooth}
        label={$t('routes.profile.edit')}
      />
    {/if}
    <Menu placement="bottom-start">
      {#snippet target(attachment)}
        <SidebarButton
          {@attach attachment}
          label={$t('post.actions.more.label')}
          icon={EllipsisHorizontal}
        />
      {/snippet}
      <MenuButton href="/modlog?community={community.did}">
        <Icon src={Newspaper} size="16" mini />
        {$t('cards.community.modlog')}
      </MenuButton>
      {#if profile.current?.jwt}
        {#if profile.isMod(community)}
          <MenuButton
            color="success-subtle"
            href="/moderation?community={community.did}"
          >
            <Icon src={ShieldCheck} size="16" micro />
            {$t('routes.moderation.feed')}
          </MenuButton>
        {/if}
        {#if profile.isAdmin}
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
        {/if}
      {/if}
    </Menu>
    <EndPlaceholder size="xs" margin="sm">
      {$t('cards.site.stats')}
    </EndPlaceholder>

    <div class="flex flex-row gap-4 flex-wrap px-3">
      <LabelStat
        label={$t('cards.community.members')}
        content={community.subscriberCount.toString()}
        formatted
      />
      <LabelStat
        label={$t('content.posts')}
        content={community.postCount.toString()}
        formatted
      />
    </div>

    <EndPlaceholder size="xs" margin="sm">
      {$t('common.info')}
    </EndPlaceholder>
    <div class="space-y-3 px-1.5 text-sm">
      {#if hasDescription(community)}
        <Expandable bind:open={settings.expand.about}>
          {#snippet title()}
            <span class="px-2 py-1 w-full">
              {$t('cards.site.about')}
            </span>
          {/snippet}
          <Markdown source={community.description} />
        </Expandable>
      {/if}
    </div>
  </aside>
{/await}
