<script lang="ts">
  import type { Snippet } from 'svelte'
  import { flip } from 'svelte/animate'
  import { expoOut } from 'svelte/easing'
  import Toast from './Toast.svelte'
  import { type Toast as ToastData, toasts } from './toasts'

  interface Props {
    /** Renders each toast's `content`; plain text when omitted. */
    content?: Snippet<[ToastData]>
    class?: string
  }

  let { content, class: className }: Props = $props()
</script>

<div
  class={[
    'fixed right-0 bottom-0 flex flex-col items-end justify-end z-200 p-5 group overflow-hidden h-screen pointer-events-none gap-2',
    className,
  ]}
>
  {#each $toasts as toast (toast.id)}
    <div
      animate:flip={{ duration: 300, easing: expoOut }}
      class="pointer-events-auto transition-all
      duration-300"
    >
      <Toast {toast} {content} />
    </div>
  {/each}
</div>
