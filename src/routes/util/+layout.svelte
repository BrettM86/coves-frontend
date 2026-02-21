<script lang="ts">
  import { Tabs } from '$lib/ui/layout'

  interface Props {
    children?: import('svelte').Snippet
  }

  let { children }: Props = $props()
</script>

<div class="flex flex-col gap-2">
  <Tabs
    routes={[
      {
        href: '/util',
        name: 'Home',
      },
      {
        href: '/util/instance',
        name: 'Kelp instance',
      },
      {
        href: '/util/photonify',
        name: 'Localize Links',
      },
      {
        href: '/util/placeholder',
        name: 'Placeholders',
      },
      {
        href: '/util/constants',
        name: 'Constants',
      },
      {
        href: '/functions',
        name: 'Functions',
      },
    ]}
  />
  {@render children?.()}
</div>
