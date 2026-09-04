<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import type { ProfileViewDetailed } from '$lib/api/coves/types'
  import { XrpcError } from '$lib/api/coves/xrpc'
  import { profile as authProfile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { errorMessage } from '$lib/app/util/error'
  import {
    isUserBlocked,
    isUserBlockPending,
    reconcileUserBlockState,
    toggleUserBlock,
  } from '$lib/feature/user/blocking.svelte'
  import { Button, Menu, MenuButton, toast } from '$lib/ui/kit'
  import { Icon, Ban, Ellipsis, Mail } from '$lib/ui/kit/icon'
  interface Props {
    profile: ProfileViewDetailed
  }

  let { profile: userProfile }: Props = $props()

  let isBlocked = $derived(isUserBlocked(userProfile))
  let toggling = $derived(isUserBlockPending(userProfile))

  $effect(() => {
    reconcileUserBlockState(userProfile)
  })

  async function toggleBlock(): Promise<void> {
    const outcome = await toggleUserBlock(userProfile, coves())
    if (outcome.kind === 'pending') return
    if (outcome.kind === 'error') {
      if (outcome.error instanceof XrpcError && outcome.error.status === 401) {
        toast({ content: $t('toast.sessionExpired'), type: 'warning' })
      } else {
        toast({ content: errorMessage(outcome.error), type: 'error' })
      }
      return
    }

    toast({
      content: outcome.blocked
        ? $t('toast.blockUser')
        : $t('toast.unblockUser'),
      type: 'success',
    })
  }
</script>

{#if authProfile.current?.jwt && authProfile.current?.did !== userProfile.did}
  <div class="flex items-center gap-2 w-full flex-wrap">
    <!-- TODO: Implement Coves messaging when available -->
    <Button
      size="lg"
      color="primary"
      icon={Mail}
      onclick={() =>
        toast({
          content: 'Messaging is not yet available',
          type: 'warning',
        })}
    >
      {$t('content.message')}
    </Button>
    <Menu placement="bottom-end">
      {#snippet target(attachment)}
        <Button
          {@attach attachment}
          size="square-lg"
          rounding="2xl"
          icon={Ellipsis}
          aria-label={$t('post.actions.more.label')}
        />
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
  </div>
{/if}
