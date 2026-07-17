<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import type { ProfileViewDetailed } from '$lib/api/coves/types'
  import { profile as authProfile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import { Button, Menu, MenuButton, toast } from 'mono-svelte'
  import {
    EllipsisHorizontal,
    Envelope,
    Icon,
    NoSymbol,
  } from 'svelte-hero-icons/dist'

  interface Props {
    profile: ProfileViewDetailed
  }

  let { profile: userProfile }: Props = $props()

  let isBlocked = $state<boolean>(userProfile.viewer?.blocking !== undefined)

  async function toggleBlock(): Promise<void> {
    const newBlockedState = !isBlocked
    try {
      if (newBlockedState) {
        await coves().blockUser({ subject: userProfile.did })
      } else {
        await coves().unblockUser({ subject: userProfile.did })
      }
      isBlocked = newBlockedState
      toast({
        content: newBlockedState
          ? $t('toast.blockUser')
          : $t('toast.unblockUser'),
        type: 'success',
      })
    } catch (err) {
      toast({
        content: err instanceof Error ? err.message : String(err),
        type: 'error',
      })
    }
  }
</script>

{#if authProfile.current?.jwt && authProfile.current?.did !== userProfile.did}
  <div class="flex items-center gap-2 w-full flex-wrap">
    <!-- TODO: Implement Coves messaging when available -->
    <Button
      size="lg"
      color="primary"
      icon={Envelope}
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
          icon={EllipsisHorizontal}
          aria-label={$t('post.actions.more.label')}
        />
      {/snippet}
      <MenuButton color="danger-subtle" onclick={toggleBlock}>
        {#snippet prefix()}
          <Icon mini size="16" src={NoSymbol} />
        {/snippet}
        {isBlocked ? $t('account.unblock') : $t('account.block')}
      </MenuButton>
    </Menu>
  </div>
{/if}
