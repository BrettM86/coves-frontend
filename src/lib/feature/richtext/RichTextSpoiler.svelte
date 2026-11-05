<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import type { Snippet } from 'svelte'

  interface Props {
    reason?: string
    /** Bound when several pieces of one spoiler reveal together. */
    revealed?: boolean
    /** Block content (a placed image) instead of inline text. */
    block?: boolean
    children: Snippet
  }

  let {
    reason = undefined,
    revealed = $bindable(false),
    block = false,
    children,
  }: Props = $props()

  let label = $derived(
    reason
      ? `${$t('content.spoiler.show')}: ${reason}`
      : $t('content.spoiler.show'),
  )

  // Kept on one line in the template: whitespace inside the inline span
  // would render as a visible stray space (pre-wrap context).
  const pill = 'rounded-sm bg-slate-200 px-1 dark:bg-zinc-800'
</script>

{#if block}
  {#if revealed}
    <div title={reason}>{@render children()}</div>
  {:else}
    <!-- The content cannot sit inside the button (a placed image is a button
         itself), so the button covers it instead. -->
    <div class="relative overflow-hidden rounded-xl">
      <div inert class="blur-2xl select-none">{@render children()}</div>
      <button
        type="button"
        class="absolute inset-0 cursor-pointer"
        title={reason}
        aria-label={label}
        onclick={() => (revealed = true)}
      ></button>
    </div>
  {/if}
{:else if revealed}
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
    aria-label={label}
    onclick={() => (revealed = true)}
  >
    <span inert class="blur-xs select-none">{@render children()}</span>
  </button>
{/if}
