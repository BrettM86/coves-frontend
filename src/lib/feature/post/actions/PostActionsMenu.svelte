<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import type { PostView } from '$lib/api/coves/types'
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { errorMessage } from '$lib/app/util/error'
  import { log } from '$lib/app/util/log'
  import { settings } from '$lib/app/state/settings.svelte'
  import {
    isCommunityBlocked,
    isCommunityBlockPending,
    setCommunityBlocked,
  } from '$lib/feature/community/blocking.svelte'
  import { report } from '$lib/feature/moderation/moderation.svelte'
  import { encodeCrosspostDraft } from '$lib/feature/post/helpers'
  import {
    isUserBlocked,
    isUserBlockPending,
    setUserBlocked,
  } from '$lib/feature/user/blocking.svelte'
  import { action, MenuButton, MenuDivider, modal, toast } from '$lib/ui/kit'
  import { Ban, ExternalLink, Flag, Trash2, UserRoundX } from '$lib/ui/kit/icon'
  interface Props {
    post: PostView
  }

  let { post = $bindable() }: Props = $props()

  let communityBlocked = $derived(isCommunityBlocked(post.community))
  let communityBlockPending = $derived(isCommunityBlockPending(post.community))
  let authorBlocked = $derived(isUserBlocked(post.author))
  let authorBlockPending = $derived(isUserBlockPending(post.author))

  // UTF-8-safe: plain btoa() throws on characters above U+00FF (curly
  // quotes, emoji, CJK, ...) which would crash the whole actions menu.
  const crosspostParam = $derived(
    encodeCrosspostDraft({
      body: `${
        settings.crosspostOriginalLink ? `cross-posted from: ${post.uri}` : ``
      }\n${
        post.record?.content
          ? '>' + post.record.content.split('\n').join('\n> ')
          : ''
      }`,
      name: post.record?.title,
    }),
  )

  let deleting = $state(false)

  async function handleDelete(): Promise<void> {
    if (deleting) return
    deleting = true
    try {
      await coves().deletePost({ uri: post.uri })
      toast({ content: $t('post.actions.more.delete'), type: 'success' })
      // Navigate away after deletion
      window.history.back()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      toast({ content: errorMsg, type: 'error' })
    } finally {
      deleting = false
    }
  }

  function confirmDelete(): void {
    modal({
      title: $t('post.actions.more.delete'),
      body: $t('post.actions.more.deletePostConfirm'),
      actions: [
        action({
          content: $t('post.actions.more.delete'),
          action: handleDelete,
          type: 'danger',
          close: true,
        }),
        action({
          content: $t('common.cancel'),
          close: true,
        }),
      ],
    })
  }

  async function refreshVisibleFeed(): Promise<void> {
    try {
      await invalidateAll()
    } catch (error) {
      // The block is already durable. A failed refresh should not report the
      // moderation action itself as failed; the next navigation will reload it.
      log.warn('[PostActionsMenu] blocked content refresh failed', error)
    }
  }

  async function blockCommunity(): Promise<void> {
    const outcome = await setCommunityBlocked(post.community, true, coves())
    if (outcome.kind === 'pending') return
    if (outcome.kind === 'error') {
      toast({ content: errorMessage(outcome.error), type: 'error' })
      return
    }

    toast({ content: $t('toast.blockedCommunity'), type: 'success' })
    await refreshVisibleFeed()
  }

  async function blockAuthor(): Promise<void> {
    const outcome = await setUserBlocked(post.author, true, coves())
    if (outcome.kind === 'pending') return
    if (outcome.kind === 'error') {
      toast({ content: errorMessage(outcome.error), type: 'error' })
      return
    }

    toast({ content: $t('toast.blockUser'), type: 'success' })
    await refreshVisibleFeed()
  }
</script>

{#if profile.isAuthenticated}
  <MenuButton
    href="/create/post?crosspost={crosspostParam}"
    icon={ExternalLink}
  >
    {$t('post.actions.more.crosspost')}
  </MenuButton>
  {#if profile.current?.did && profile.current.did === post.author.did}
    <MenuButton onclick={confirmDelete} color="danger-subtle" icon={Trash2}>
      {$t('post.actions.more.delete')}
    </MenuButton>
  {/if}
  <MenuDivider>{$t('settings.moderation.title')}</MenuDivider>
  {#if profile.current.did !== post.author.did && !authorBlocked}
    <MenuButton
      onclick={blockAuthor}
      color="danger-subtle"
      icon={UserRoundX}
      disabled={authorBlockPending}
      loading={authorBlockPending}
    >
      {$t('post.actions.more.blockAccount')}
    </MenuButton>
  {/if}
  {#if !communityBlocked}
    <MenuButton
      onclick={blockCommunity}
      color="danger-subtle"
      icon={Ban}
      disabled={communityBlockPending}
      loading={communityBlockPending}
    >
      {$t('post.actions.more.blockCommunity')}
    </MenuButton>
  {/if}
  <MenuButton onclick={() => report(post)} color="danger-subtle" icon={Flag}>
    {$t('post.actions.more.reportPost')}
  </MenuButton>
{/if}
