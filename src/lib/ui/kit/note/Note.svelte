<script lang="ts">
  import { Material } from '$lib/ui/kit'
  import { Icon, Info } from '$lib/ui/kit/icon'
  import type { ClassValue } from 'svelte/elements'

  interface Props {
    content?: string | undefined
    children?: import('svelte').Snippet
    class?: ClassValue
  }

  let { content = undefined, children, class: clazz = '' }: Props = $props()
</script>

<Material
  color="info"
  rounding="2xl"
  class={['flex flex-row items-center px-3 py-2.5', clazz]}
>
  <Icon
    src={Info}
    size="20"
    class="inline-block rounded-lg clear-both float-left mr-2"
  />
  <div class="flex flex-col md:flex-row items-center w-full">
    {#if children}
      {@render children?.()}
    {:else if content}
      <p class="text-left justify-self-start">
        {content}
      </p>
    {/if}
  </div>
</Material>
