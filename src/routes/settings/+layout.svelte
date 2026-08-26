<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import {
    importSettings,
    resetSettings,
    settings,
  } from '$lib/app/state/settings.svelte'
  import { Header, Tabs } from '$lib/ui/layout'
  import { action, Button, Modal, modal, TextArea, toast } from '$lib/ui/kit'
  import { ArrowDownTray, ArrowPath, ArrowUpTray } from 'svelte-hero-icons/dist'

  let { children } = $props()
  let importing = $state(false)
  let importText = $state('')
</script>

{#if importing}
  <Modal
    bind:open={importing}
    onaction={() => {
      try {
        importSettings(importText)

        toast({ content: $t('toast.settingsImport'), type: 'success' })
        importing = false
      } catch (err) {
        console.error('[settings] Import failed:', err)
        toast({ content: $t('toast.settingsImportFailed'), type: 'error' })
      }
    }}
    title={$t('settings.import')}
    action={$t('settings.import')}
  >
    <TextArea bind:value={importText} style="font-family: monospace;" />
  </Modal>
{/if}

<svelte:head>
  <title>{$t('settings.title')}</title>
</svelte:head>

<Tabs
  routes={[
    {
      href: '/settings/app',
      name: $t('settings.app.title'),
    },
    {
      href: '/settings/embeds',
      name: $t('settings.embeds.title'),
    },
    {
      href: '/settings/moderation',
      name: $t('settings.moderation.title'),
    },
    {
      href: '/settings/other',
      name: $t('settings.other.title'),
    },
  ]}
/>

<Header pageHeader class="text-3xl font-bold flex justify-between">
  {$t('settings.title')}
  {#snippet extended()}
    <div class="flex items-center tracking-normal gap-2">
      <Button
        onclick={() => {
          importText = ''
          importing = true
        }}
        icon={ArrowDownTray}
        size="lg"
      >
        {$t('settings.import')}
      </Button>
      <Button
        onclick={() => {
          const json = JSON.stringify(settings)
          navigator?.clipboard?.writeText?.(json)
          toast({ content: $t('toast.copied') })
        }}
        icon={ArrowUpTray}
        size="lg"
      >
        {$t('settings.export')}
      </Button>
      <Button
        onclick={() => {
          modal({
            title: $t('settings.reset'),
            body: $t('toast.resetSettings'),
            actions: [
              action({
                action: resetSettings,
                close: true,
                type: 'danger',
                content: $t('settings.reset'),
              }),
              action({
                content: $t('common.cancel'),
              }),
            ],
          })
        }}
        icon={ArrowPath}
        size="lg"
      >
        {$t('settings.reset')}
      </Button>
    </div>
  {/snippet}
</Header>

{@render children?.()}
