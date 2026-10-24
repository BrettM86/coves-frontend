<script lang="ts">
  // Plays the notification list's role for ReplyCard tests: it holds the
  // reveal state and reveals the row when the card asks, recording the
  // identity it was asked with.
  import ReplyCard from './ReplyCard.svelte'
  import type { ReplyNotificationRow } from './rows'

  let {
    row,
    record,
  }: { row: ReplyNotificationRow; record: (identity: string) => void } =
    $props()

  let revealed = $state(false)
</script>

<ReplyCard
  {row}
  {revealed}
  onreveal={(identity) => {
    record(identity)
    revealed = true
  }}
/>
