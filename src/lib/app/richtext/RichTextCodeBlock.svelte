<script lang="ts">
  import { t } from '$lib/app/i18n'
  import { Button, Material, toast } from 'mono-svelte'
  import { ClipboardDocument, Icon } from 'svelte-hero-icons/dist'

  interface Props {
    code: string
    language?: string
  }

  let { code, language = undefined }: Props = $props()
</script>

<Material
  padding="none"
  rounding="2xl"
  class="flex flex-col rounded-xl
  divide-y divide-slate-200 dark:divide-zinc-800 overflow-hidden"
>
  <div
    class="w-full bg-slate-25 dark:bg-zinc-925 h-9 flex items-center justify-between p-2"
  >
    <pre class="code-baseline text-xs"> {language ?? ''}</pre>
    <Button
      size="square-sm"
      color="tertiary"
      aria-label={$t('content.copyCode')}
      title={$t('content.copyCode')}
      onclick={async () => {
        try {
          await navigator.clipboard.writeText(code)
          toast({ content: $t('toast.copied') })
        } catch {
          toast({ content: $t('toast.copyFailed'), type: 'error' })
        }
      }}
    >
      <Icon
        src={ClipboardDocument}
        size="16"
        micro
        class="text-slate-600 dark:text-zinc-400"
      />
    </Button>
  </div>
  <pre
    class="code-baseline w-full overflow-x-auto whitespace-pre text-xs bg-white dark:bg-zinc-950 px-4 py-3">{code}</pre>
</Material>
