<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import type { ProfileViewDetailed } from '$lib/api/coves/types'
  import { XrpcError } from '$lib/api/coves/xrpc'
  import { profile as authProfile } from '$lib/app/state/auth.svelte'
  import { errorMessage } from '$lib/app/util/error'
  import { log } from '$lib/app/util/log'
  import { t } from '$lib/app/state/i18n'
  import { Button, Menu, MenuButton, toast } from '$lib/ui/kit'
  import { untrack } from 'svelte'
  import { Icon, Ban, Ellipsis, Mail } from '$lib/ui/kit/icon'
  interface Props {
    profile: ProfileViewDetailed
  }

  let { profile: userProfile }: Props = $props()

  // Navigating from one profile to another reuses this component, so a lone
  // one-time seed would leave profile A's block state on profile B's menu —
  // the $effect below owns every later re-sync. A seed is still needed because
  // effects don't run during SSR and the first paint needs a value; init reads
  // are never reactive, so untrack() marks them as deliberate one-time seeds
  // and silences state_referenced_locally.
  //
  // The latch is REQUIRED, not an optimisation. This effect's dependency is the
  // `profile` prop's signal, which is replaced on every navigation because the
  // route's data is rebuilt each load — so it re-runs even when `viewer.blocking`
  // is byte-identical. Unguarded, any navigation after a successful block would
  // revert the menu to "Block": the AppView indexes block records off the
  // atproto firehose, so a reload that still reports `blocking: undefined` is
  // the likely case rather than an edge case, and the next click would re-issue
  // blockUser instead of unblocking.
  //
  // The DID is part of the latch, not just the record URI: two different
  // profiles that are both unblocked share `blocking === undefined`, so a URI
  // comparison alone would suppress the re-sync and carry an optimistic block
  // from profile A onto profile B — the very bug this effect exists to fix. A
  // change of subject always re-syncs; the same subject only re-syncs when the
  // server's answer actually changed. Both latches are plain `let`s, not
  // $state, so updating them here cannot re-trigger the effect.
  let lastDid = untrack(() => userProfile.did)
  let lastBlocking = untrack(() => userProfile.viewer?.blocking)
  let isBlocked = $state<boolean>(lastBlocking !== undefined)

  $effect(() => {
    const did = userProfile.did
    const blocking = userProfile.viewer?.blocking
    if (did === lastDid && blocking === lastBlocking) return
    lastDid = did
    lastBlocking = blocking
    isBlocked = blocking !== undefined
  })

  // Two overlapping toggles would both derive their target from the same
  // `isBlocked`, so whichever response landed last would decide the outcome
  // regardless of the order the user clicked in.
  let toggling = false

  async function toggleBlock(): Promise<void> {
    if (toggling) return

    const newBlockedState = !isBlocked
    // Captured before the await: this component is reused rather than
    // remounted, so the request can settle after the user has moved on to a
    // different profile. The response describes `subject`, not whoever is on
    // screen by the time it arrives, and may only be committed to the local
    // state if they are still the same person.
    const subject = userProfile.did

    toggling = true
    try {
      if (newBlockedState) {
        await coves().blockUser({ subject })
      } else {
        await coves().unblockUser({ subject })
      }
      if (userProfile.did === subject) isBlocked = newBlockedState
      toast({
        content: newBlockedState
          ? $t('toast.blockUser')
          : $t('toast.unblockUser'),
        type: 'success',
      })
    } catch (err) {
      // Reported unconditionally: the toast is global rather than scoped to
      // this profile, and an action the user explicitly took must never fail
      // silently just because they navigated while it was in flight.
      log.error('[UserActions] toggleBlock failed', err, {
        subject,
        newBlockedState,
      })
      if (err instanceof XrpcError && err.status === 401) {
        toast({ content: $t('toast.sessionExpired'), type: 'warning' })
      } else {
        // errorMessage() rather than raw err.message: key-shaped backend
        // errors get translated instead of shipping verbatim.
        toast({ content: errorMessage(err), type: 'error' })
      }
    } finally {
      toggling = false
    }
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
      <MenuButton color="danger-subtle" onclick={toggleBlock}>
        {#snippet prefix()}
          <Icon size="16" src={Ban} />
        {/snippet}
        {isBlocked ? $t('account.unblock') : $t('account.block')}
      </MenuButton>
    </Menu>
  </div>
{/if}
