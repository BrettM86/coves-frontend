<script lang="ts">
  import { Spinner } from '$lib/ui/kit'
  import type { Snippet } from 'svelte'
  import {
    Icon,
    Check,
    CircleAlert,
    CircleCheck,
    Info,
    TriangleAlert,
  } from '$lib/ui/kit/icon'
  import { expoOut } from 'svelte/easing'
  import { fly, scale } from 'svelte/transition'
  import { removeToast, type Toast, toastColors } from './toasts'

  interface Props {
    toast: Toast
    /** Renders `toast.content`; plain text when omitted. */
    content?: Snippet<[Toast]>
  }

  let { toast, content }: Props = $props()

  const icons = {
    info: Info,
    success: CircleCheck,
    warning: TriangleAlert,
    error: CircleAlert,
  }

  const actionColors = {
    info: 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100',
    warning:
      'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100',
    success:
      'bg-green-100 text-green-800 hover:bg-green-200 hover:text-green-900 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-800 dark:hover:text-green-100',
    error:
      'bg-red-100 text-red-800 hover:bg-red-200 hover:text-red-900 dark:bg-red-900 dark:text-red-200 dark:hover:bg-red-800 dark:hover:text-red-100',
  }
</script>

<div
  role="status"
  class={[
    toastColors[toast.type],
    'flex flex-row items-start gap-2 rounded-xl border px-4 py-3.5 shadow-md',
    'w-[356px] max-w-[calc(100vw-2.5rem)]',
    toast.long && 'sm:w-full sm:max-w-lg',
  ]}
  in:fly={{ y: 8, easing: expoOut }}
  out:scale={{ start: 0.97, easing: expoOut }}
>
  {#if toast.loading}
    <div class="shrink-0 mt-px"><Spinner width={20} /></div>
  {:else}
    <Icon size="20" class="shrink-0 mt-px" src={icons[toast.type]} />
  {/if}
  <div
    class="flex flex-col min-w-0 flex-1 break-words text-[15px] font-medium leading-snug"
  >
    {#if toast.title}
      <p class="font-semibold">{toast.title}</p>
    {/if}
    {#if content}
      {@render content(toast)}
    {:else}
      <p>{toast.content}</p>
    {/if}
  </div>
  {#if toast.action}
    <button
      onclick={() => {
        toast.action?.()
        removeToast(toast.id)
      }}
      class={[
        'shrink-0 -my-1 -mr-1 rounded-md p-1 transition-colors',
        actionColors[toast.type],
      ]}
    >
      <Icon src={Check} size="18" />
    </button>
  {/if}
</div>
