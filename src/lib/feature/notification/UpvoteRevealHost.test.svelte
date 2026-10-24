<script lang="ts">
  // Plays the notification list's role for UpvoteRow tests: it holds the
  // reveal state and reveals the row when the row asks, recording the
  // identity it was asked with.
  import UpvoteRow from './UpvoteRow.svelte'
  import type { UpvoteNotificationRow } from './rows'

  let {
    row,
    record,
  }: { row: UpvoteNotificationRow; record: (identity: string) => void } =
    $props()

  let revealed = $state(false)
</script>

<UpvoteRow
  {row}
  {revealed}
  onreveal={(identity) => {
    record(identity)
    revealed = true
  }}
/>
