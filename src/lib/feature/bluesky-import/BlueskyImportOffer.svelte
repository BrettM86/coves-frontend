<script lang="ts">
  import { page } from '$app/state'
  import { coves } from '$lib/api/client.svelte'
  import type { BlueskyProfileImportField } from '$lib/api/coves/types'
  import { profile } from '$lib/app/state/auth.svelte'
  import BlueskyImportDialog from './BlueskyImportDialog.svelte'
  import { warnImportFailure } from './failure-log'
  import { shouldOfferOnPath } from './offer-route'
  import { claimAutomaticCheck } from './session-claim'

  let open = $state(false)
  let fields = $state<BlueskyProfileImportField[]>()
  /** The account the open offer belongs to. */
  let offeredDid = $state<string>()

  /** Whether `did` is still the signed-in viewer on a page that may offer. */
  function stillApplies(did: string): boolean {
    const viewer = profile.current
    return (
      viewer.type === 'authenticated' &&
      viewer.did === did &&
      shouldOfferOnPath(page.url.pathname)
    )
  }

  $effect(() => {
    const viewer = profile.current
    if (viewer.type !== 'authenticated') return
    if (!shouldOfferOnPath(page.url.pathname)) return
    const did = viewer.did
    if (!claimAutomaticCheck(did)) return
    coves()
      .getBlueskyProfileImport()
      .then(
        (result) => {
          if (result.status !== 'offer' || !stillApplies(did)) return
          fields = result.fields
          offeredDid = did
          open = true
        },
        (error: unknown) => {
          // The offer is optional; a failed check is not retried this
          // session and is not shown to the user.
          warnImportFailure('Bluesky import offer check failed', error)
        },
      )
  })

  // An offer belongs to one account: signing out or switching accounts closes
  // it without recording a dismissal for either account.
  $effect(() => {
    if (!open) return
    const viewer = profile.current
    if (viewer.type !== 'authenticated' || viewer.did !== offeredDid)
      open = false
  })
</script>

{#if fields}
  {#key fields}
    <BlueskyImportDialog bind:open mode="offer" {fields} />
  {/key}
{/if}
