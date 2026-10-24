<script lang="ts">
  import { profile } from '$lib/app/state/auth.svelte'
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

  const routes = $derived([
    { href: '/settings/app', name: $t('settings.app.title') },
    { href: '/settings/embeds', name: $t('settings.embeds.title') },
    ...(profile.isAuthenticated
      ? [
          {
            href: '/settings/notifications',
            name: $t('settings.notifications.title'),
          },
        ]
      : []),
    { href: '/profile/blocks', name: $t('routes.profile.blocks.title') },
    { href: '/settings/other', name: $t('settings.other.title') },
  ])
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

<Tabs {routes} />

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

<style>
  /* Shifts the hue of each setting's icon tile down the list. Kept here,
     not in Setting.svelte, so a page using only ToggleSetting gets it too. */
  :global(.setting:nth-child(17n + 1) .color) {
    filter: hue-rotate(10deg);
  }
  :global(.setting:nth-child(17n + 2) .color) {
    filter: hue-rotate(30deg);
  }
  :global(.setting:nth-child(17n + 3) .color) {
    filter: hue-rotate(50deg);
  }
  :global(.setting:nth-child(17n + 4) .color) {
    filter: hue-rotate(70deg);
  }
  :global(.setting:nth-child(17n + 5) .color) {
    filter: hue-rotate(90deg);
  }
  :global(.setting:nth-child(17n + 6) .color) {
    filter: hue-rotate(110deg);
  }
  :global(.setting:nth-child(17n + 7) .color) {
    filter: hue-rotate(130deg);
  }
  :global(.setting:nth-child(17n + 8) .color) {
    filter: hue-rotate(150deg);
  }
  :global(.setting:nth-child(17n + 9) .color) {
    filter: hue-rotate(170deg);
  }
  :global(.setting:nth-child(17n + 10) .color) {
    filter: hue-rotate(190deg);
  }
  :global(.setting:nth-child(17n + 11) .color) {
    filter: hue-rotate(210deg);
  }
  :global(.setting:nth-child(17n + 12) .color) {
    filter: hue-rotate(230deg);
  }
  :global(.setting:nth-child(17n + 13) .color) {
    filter: hue-rotate(250deg);
  }
  :global(.setting:nth-child(17n + 14) .color) {
    filter: hue-rotate(270deg);
  }
  :global(.setting:nth-child(17n + 15) .color) {
    filter: hue-rotate(290deg);
  }
  :global(.setting:nth-child(17n + 16) .color) {
    filter: hue-rotate(310deg);
  }
  :global(.setting:nth-child(17n + 17) .color) {
    filter: hue-rotate(330deg);
  }
</style>
