<script lang="ts">
  // @ts-nocheck TODO(coves-migration): Needs Coves topic discovery API
  import type { TopicView } from '$lib/api/types'
  import CommonItem from '$lib/ui/layout/CommonItem.svelte'

  interface Props {
    topic: TopicView
  }

  let { topic }: Props = $props()
</script>

<CommonItem title={topic.title ?? topic.name} href="/topic/{topic.id}" />
