<script lang="ts">
  import Markdown from '$lib/app/markdown/Markdown.svelte'
  import { Header } from '$lib/ui/layout'

  import guidelinesSource from '$lib/assets/community-guidelines.md?raw'
</script>

<div class="flex flex-row w-full">
  <div class="flex flex-col flex-1 gap-4">
    <Header pageHeader>Community Guidelines</Header>
    <Markdown source={guidelinesSource} />
  </div>
</div>
