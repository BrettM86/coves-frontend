<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { errorMessage } from '$lib/app/util/error'
  import { t } from '$lib/app/state/i18n'
  import { Button, Material } from '$lib/ui/kit'

  function getError(message: string): { string: string; code: boolean } {
    try {
      return { string: errorMessage(message), code: false }
    } catch {
      return { string: message, code: true }
    }
  }
</script>

<div
  class="flex flex-col gap-4 my-auto h-full justify-center max-w-xl w-full mx-auto"
>
  <Material rounding="3xl" padding="xl" color="error" class="space-y-2">
    <h1 class="text-4xl font-medium flex items-center flex-row gap-2">
      {page.error?.code === 'BackendUnavailable'
        ? $t('error.backend_unreachable_title')
        : page.status}
    </h1>
    {#if page.error?.code === 'BackendUnavailable'}
      <p class="text-lg">{$t('error.backend_unreachable')}</p>
    {:else if page?.error?.message}
      {@const error = getError(page?.error?.message)}
      {#if error.code}
        <code class="rounded-md dark:bg-zinc-950! px-2 py-1 min-w-48">
          {error.string}
        </code>
      {:else}
        <p class="text-lg">
          {error.string}
        </p>
      {/if}
    {/if}
  </Material>
  <div class="flex flex-wrap items-center gap-2 px-4">
    <Button size="lg" onclick={() => goto(page.url, { invalidateAll: true })}>
      {$t('message.retry')}
    </Button>
    <Button href="/" size="lg">
      {$t('nav.home')}
    </Button>
  </div>
</div>
