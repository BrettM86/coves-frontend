<script lang="ts">
  interface Props {
    count: number
    index: number
    /** Read in place of the dots, such as "Page 2 of 3". */
    label: string
    class?: string
  }

  let { count, index, label, class: clazz }: Props = $props()
</script>

<!--
  @component
  A gallery's position: one small dot per page in a dark pill, the current
  one solid. Matches the mobile app's MediaPageDots. Nothing for one page.
-->
{#if count > 1}
  <div
    role="img"
    aria-label={label}
    data-page-dots
    class={[
      'pointer-events-none inline-flex items-center gap-1.5 rounded-full bg-[#262626]/90 px-2 py-1.5',
      clazz,
    ]}
  >
    {#each { length: count }, dot (dot)}
      <span
        data-page-dot
        class={[
          'size-[5px] rounded-full',
          dot === index ? 'bg-[#fff8f0]' : 'bg-[#fff8f0]/60',
        ]}
      ></span>
    {/each}
  </div>
{/if}
