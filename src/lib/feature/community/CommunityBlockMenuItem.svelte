<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { errorMessage } from '$lib/app/util/error'
  import { isExpiredSessionError } from '$lib/app/util/session-expired-error'
  import { MenuButton, toast } from '$lib/ui/kit'
  import { Ban } from '$lib/ui/kit/icon'
  import {
    isCommunityBlocked,
    isCommunityBlockPending,
    reconcileCommunityBlockState,
    toggleCommunityBlock,
    type BlockableCommunity,
  } from './blocking.svelte'

  interface Props {
    community: BlockableCommunity
  }

  let { community }: Props = $props()

  let blocked = $derived(isCommunityBlocked(community))
  let pending = $derived(isCommunityBlockPending(community))
  let label = $derived(
    blocked ? $t('cards.community.unblock') : $t('cards.community.block'),
  )

  $effect(() => {
    reconcileCommunityBlockState(community)
  })

  async function onPress(): Promise<void> {
    const outcome = await toggleCommunityBlock(community, coves())
    if (outcome.kind === 'error') {
      if (isExpiredSessionError(outcome.error) && profile.sessionExpired) return
      toast({ content: errorMessage(outcome.error), type: 'error' })
    } else if (outcome.kind === 'ok') {
      toast({
        content: outcome.blocked
          ? $t('toast.blockedCommunity')
          : $t('toast.unblockedCommunity'),
        type: 'success',
      })
    }
  }
</script>

<MenuButton
  color="danger-subtle"
  disabled={pending}
  loading={pending}
  onclick={onPress}
  icon={Ban}
>
  {label}
</MenuButton>
