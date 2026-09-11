<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { log } from '$lib/app/util/log'
  import {
    importSettings,
    resetSettings,
    settings,
  } from '$lib/app/state/settings.svelte'
  import { Header, Tabs } from '$lib/ui/layout'
  import { action, Button, Modal, modal, TextArea, toast } from '$lib/ui/kit'
  import { Download, RefreshCw, Upload } from '$lib/ui/kit/icon'
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
        log.error('[settings] Import failed', err)
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
      href: '/profile/blocks',
      name: $t('routes.profile.blocks.title'),
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
        icon={Download}
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
        icon={Upload}
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
        icon={RefreshCw}
        size="lg"
      >
        {$t('settings.reset')}
      </Button>
    </div>
  {/snippet}
</Header>

{@render children?.()}
