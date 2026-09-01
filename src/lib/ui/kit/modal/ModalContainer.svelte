<script lang="ts">
  import { Button, Modal } from '$lib/ui/kit'
  import { Icon } from '$lib/ui/kit/icon'
  import { shownModal } from './modal'

  interface Props {
    /** Label for actions created without explicit content (the default close action). */
    closeLabel?: string
  }

  let { closeLabel = 'Close' }: Props = $props()

  let isOpen = $derived(!!$shownModal)
</script>

{#if $shownModal}
  <Modal
    title={$shownModal.title}
    dismissable={$shownModal.dismissable}
    ondismissed={() => shownModal.set(undefined)}
    open={isOpen}
  >
    {#if $shownModal.snippet}
      {@render $shownModal.snippet?.()}
    {/if}
    {#if $shownModal.body}
      <p>{$shownModal.body}</p>
    {/if}
    {#if $shownModal.actions}
      <div
        class="flex items-center gap-2 {$shownModal.actions.length >= 3
          ? 'flex-col'
          : 'flex-row'}"
      >
        {#each $shownModal.actions as action (action)}
          <Button
            size="lg"
            class="flex-1 w-full"
            onclick={action.action}
            color={action.type}
          >
            {#if action.icon}
              <Icon src={action.icon} size="16" />
            {/if}
            {action.content ?? closeLabel}
          </Button>
        {/each}
      </div>
    {/if}
  </Modal>
{/if}
