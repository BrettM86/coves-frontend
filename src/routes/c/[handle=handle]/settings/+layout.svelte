<script lang="ts">
  import { t } from '$lib/app/i18n'
  import { communityLink } from '$lib/app/util.svelte'
  import { Tabs } from '$lib/ui/layout'
  import type { PageData } from './$types'

  interface Props {
    data: PageData
    children?: import('svelte').Snippet
  }

  let { data, children }: Props = $props()

  let communityUrl = $derived(communityLink(data.community.value))
</script>

<svelte:head>
  <title>{data.community.value.displayName ?? data.community.value.name}</title>

  <meta
    name="og:title"
    content={data.community.value.displayName ?? data.community.value.name}
  />
  {#if data.community.value.description}
    <meta name="og:description" content={data.community.value.description} />
  {/if}
</svelte:head>

<div class="flex flex-col gap-4 h-full">
  <Tabs
    routes={[
      {
        href: `${communityUrl}/settings`,
        name: $t('routes.community.settings.settings'),
      },
      {
        href: `${communityUrl}/settings/team`,
        name: $t('routes.community.settings.team'),
      },
    ]}
  ></Tabs>
  {@render children?.()}
</div>
