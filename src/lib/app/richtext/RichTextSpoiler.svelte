<script lang="ts">
  import { t } from '$lib/app/i18n'
  import type { Snippet } from 'svelte'

  interface Props {
    reason?: string
    children: Snippet
  }

  let { reason = undefined, children }: Props = $props()

  let revealed = $state(false)

  // Kept on one line in the template: whitespace inside the inline span
  // would render as a visible stray space (pre-wrap context).
  const pill = 'rounded-sm bg-slate-200 px-1 dark:bg-zinc-800'
</script>

{#if revealed}
  <!-- Once revealed the wrapper is a plain span, so links inside the
       spoiler are ordinary interactive content again. -->
  <span class={pill} title={reason}>{@render children()}</span>
{:else}
  <!-- `inert` keeps concealed links unclickable and unfocusable, so the
       first click always reveals instead of navigating. -->
  <button
    type="button"
    class="inline cursor-pointer rounded-sm bg-slate-200 px-1 text-left align-baseline transition-colors hover:bg-slate-300 dark:bg-zinc-800 dark:hover:bg-zinc-700"
    title={reason}
    aria-label={reason
      ? `${$t('content.spoiler.show')}: ${reason}`
      : $t('content.spoiler.show')}
    onclick={() => (revealed = true)}
  >
    <span inert class="blur-xs select-none">{@render children()}</span>
  </button>
{/if}
