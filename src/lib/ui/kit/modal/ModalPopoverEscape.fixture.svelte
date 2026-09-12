<script lang="ts">
  import { Modal, Popover } from '$lib/ui/kit'

  let modalOpen = $state(true)
  let popoverOpen = $state(false)
</script>

<Modal bind:open={modalOpen} title="Profile dialog">
  <Popover bind:open={popoverOpen} openOnHover={true}>
    {#snippet target(attachment)}
      <button {@attach attachment}>Open options</button>
    {/snippet}
    <button>Popover action</button>
  </Popover>
</Modal>
