<script lang="ts">
  import { untrack } from 'svelte'
  import { expoOut } from 'svelte/easing'
  import { Tween } from 'svelte/motion'

  interface Props {
    progress?: number
  }

  let { progress = 0 }: Props = $props()

  // Only the starting point of the tween; the effect below animates it to
  // every subsequent value.
  let tween = new Tween(
    untrack(() => progress),
    { easing: expoOut },
  )

  $effect(() => {
    tween.set(progress)
  })
</script>

<div
  class="bg-primary-900 dark:bg-primary-100 h-1 rounded-full"
  style="width: {tween.current >= 0 ? tween.current * 100 : 0}%;"
></div>
