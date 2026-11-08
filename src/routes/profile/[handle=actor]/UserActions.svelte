<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import type { ProfileViewDetailed } from '$lib/api/coves/types'
  import { profile as authProfile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { errorMessage } from '$lib/app/util/error'
  import { isExpiredSessionError } from '$lib/app/util/session-expired-error'
  import {
    isUserBlocked,
    isUserBlockPending,
    reconcileUserBlockState,
    toggleUserBlock,
  } from '$lib/feature/user/blocking.svelte'
  import { Menu, MenuButton, Modal, toast } from '$lib/ui/kit'
  import { Icon, Ban, Ellipsis, Forward, Pencil } from '$lib/ui/kit/icon'
  import { userLink } from '$lib/app/util/links'
  import ProfileEditor from '../ProfileEditor.svelte'
  interface Props {
    profile: ProfileViewDetailed
  }

  let { profile: userProfile }: Props = $props()

  let isBlocked = $derived(isUserBlocked(userProfile))
  let toggling = $derived(isUserBlockPending(userProfile))
  let editing = $state(false)

  $effect(() => {
    reconcileUserBlockState(userProfile)
  })

  async function toggleBlock(): Promise<void> {
    const outcome = await toggleUserBlock(userProfile, coves())
    if (outcome.kind === 'pending') return
    if (outcome.kind === 'error') {
      // The recovery banner already covers a 401 from the live session; a
      // stale one leaves the session live, so the toast is the feedback.
      if (isExpiredSessionError(outcome.error) && authProfile.sessionExpired)
        return
      toast({ content: errorMessage(outcome.error), type: 'error' })
      return
    }

    toast({
      content: outcome.blocked
        ? $t('toast.blockUser')
        : $t('toast.unblockUser'),
      type: 'success',
    })
  }

  const bannerButton =
    'inline-flex items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer'

  async function share(): Promise<void> {
    try {
      const url = new URL(userLink(userProfile), location.origin).toString()
      if (navigator.share) {
        await navigator.share({ url })
      } else {
        await navigator.clipboard.writeText(url)
        toast({ content: $t('toast.copied'), type: 'success' })
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      toast({
        content: err instanceof Error ? err.message : String(err),
        type: 'error',
      })
    }
  }
</script>

<!-- Sits on the banner, so the controls carry their own dark backing to stay
     legible over any image. -->
<div class="flex items-center gap-2">
  {#if authProfile.current?.did === userProfile.did}
    <button
      type="button"
      class={[bannerButton, 'h-9 px-3.5 gap-1.5 text-sm font-medium']}
      aria-haspopup="dialog"
      aria-expanded={editing}
      onclick={() => (editing = true)}
    >
      <Icon src={Pencil} size="16" />
      {$t('routes.profile.edit')}
    </button>
  {/if}
  <button
    type="button"
    class={[bannerButton, 'size-9']}
    aria-label={$t('post.actions.more.share')}
    title={$t('post.actions.more.share')}
    onclick={share}
  >
    <Icon src={Forward} size="18" />
  </button>
  {#if authProfile.current?.did !== userProfile.did && authProfile.current?.jwt}
    <Menu placement="bottom-end">
      {#snippet target(attachment)}
        <button
          {@attach attachment}
          type="button"
          class={[bannerButton, 'size-9']}
          aria-label={$t('post.actions.more.label')}
        >
          <Icon src={Ellipsis} size="18" />
        </button>
      {/snippet}
      <MenuButton
        color="danger-subtle"
        onclick={toggleBlock}
        disabled={toggling}
        loading={toggling}
      >
        {#snippet prefix()}
          <Icon size="16" src={Ban} />
        {/snippet}
        {isBlocked ? $t('account.unblock') : $t('account.block')}
      </MenuButton>
    </Menu>
  {/if}
</div>
{#if authProfile.current?.did === userProfile.did}
  <Modal bind:open={editing} title={$t('routes.profile.edit')}>
    <ProfileEditor
      profile={userProfile}
      oncancel={() => (editing = false)}
      onsaved={() => (editing = false)}
    />
  </Modal>
{/if}
