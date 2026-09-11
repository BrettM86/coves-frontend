<script lang="ts">
  import { Button, Modal, toast } from '$lib/ui/kit'
  import { Icon } from '$lib/ui/kit/icon'
  import { dismissedActionErrors, shownModal } from './modal'

  interface Props {
    /** Label for actions created without explicit content (the default close action). */
    closeLabel?: string
    formatError?: (error: unknown) => string
  }

  let {
    closeLabel = 'Close',
    formatError = () => 'The action failed. Please try again.',
  }: Props = $props()

  let isOpen = $derived(!!$shownModal)

  $effect(() => {
    const errors = $dismissedActionErrors
    if (errors.length === 0) return
    dismissedActionErrors.set([])
    for (const error of errors) {
      toast({ content: formatError(error), type: 'error' })
    }
  })
</script>

{#if $shownModal}
  <Modal
    title={$shownModal.title}
    dismissable={$shownModal.dismissable && !$shownModal.pendingAction}
    ondismissed={() => shownModal.set(undefined)}
    open={isOpen}
  >
    {#if $shownModal.snippet}
      {@render $shownModal.snippet?.()}
    {/if}
    {#if $shownModal.body}
      <p>{$shownModal.body}</p>
    {/if}
    {#if $shownModal.error !== undefined}
      <p role="alert">{formatError($shownModal.error)}</p>
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
            disabled={!!$shownModal.pendingAction}
            loading={$shownModal.pendingAction === action}
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
