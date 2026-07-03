<script lang="ts">
  // @ts-nocheck TODO(coves-migration): remove when the remaining legacy
  // modals (RemoveModal, BanModal) are migrated to Coves types.
  // ReportModal is already Coves-native.
  import { t } from '$lib/app/i18n'
  import { toast } from 'mono-svelte'
  import { modals } from './moderation.svelte'

  // Chunk loads can fail (e.g. a stale deploy); log, surface an error, and
  // close the modal so the UI isn't stuck, then rethrow into {:catch}.
  async function loadModal(importer, name, close) {
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
{#if modals.removing.open}
  {#await loadModal(import('./RemoveModal.svelte'), 'RemoveModal', () => (modals.removing.open = false)) then { default: RemoveModal }}
    <RemoveModal
      bind:open={modals.removing.open}
      item={modals.removing.item}
      purge={modals.removing.purge}
    />
  {:catch}
    <!-- handled in loadModal -->
  {/await}
{/if}
{#if modals.banning.open}
  {#await loadModal(import('./BanModal.svelte'), 'BanModal', () => (modals.banning.open = false)) then { default: BanModal }}
    <BanModal
      bind:open={modals.banning.open}
      banned={modals.banning.banned}
      user={modals.banning.user}
      community={modals.banning.community}
    />
  {:catch}
    <!-- handled in loadModal -->
  {/await}
{/if}
