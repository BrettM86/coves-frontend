<script lang="ts">
  import { t } from '$lib/app/i18n'
  import { toast } from 'mono-svelte'
  import { modals } from './moderation.svelte'

  // Chunk loads can fail (e.g. a stale deploy); log, surface an error, and
  // close the modal so the UI isn't stuck, then rethrow into {:catch}.
  async function loadModal<T>(
    importer: Promise<T>,
    name: string,
    close: () => void,
  ): Promise<T> {
    try {
      return await importer
    } catch (err) {
      console.error(`[ModerationModals] Failed to load ${name}:`, err)
      toast({ content: $t('error.unknown'), type: 'error' })
      close()
      throw err
    }
  }
</script>

<!--These weird await hacks are for lazy loading, better network performance-->
{#if modals.reporting.open}
  {#await loadModal(import('./ReportModal.svelte'), 'ReportModal', () => (modals.reporting.open = false)) then { default: ReportModal }}
    <ReportModal
      bind:open={modals.reporting.open}
      bind:item={modals.reporting.item}
    />
  {:catch}
    <!-- handled in loadModal -->
  {/await}
{/if}
