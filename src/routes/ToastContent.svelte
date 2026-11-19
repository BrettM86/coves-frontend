<script lang="ts">
  import Markdown from '$lib/feature/markdown/Markdown.svelte'
  import type { Toast } from '$lib/ui/kit/toast/toasts'

  let { toast }: { toast: Toast } = $props()
</script>

<!-- Error toasts carry server-supplied text, so render them as plain text, never Markdown. -->
{#if toast.type === 'error'}
  <p dir="auto" class="leading-snug break-words max-w-[70ch]">
    {toast.content}
  </p>
{:else}
  <Markdown source={toast.content} class="leading-snug [&_p]:leading-snug" />
{/if}
