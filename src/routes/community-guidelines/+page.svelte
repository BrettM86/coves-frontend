<script lang="ts">
  import Markdown from '$lib/feature/markdown/Markdown.svelte'
  import guidelinesSource from '$lib/assets/community-guidelines.md?raw'
</script>

<svelte:head>
  <title>Community Guidelines — Coves</title>
</svelte:head>

<article class="w-full max-w-prose pb-6">
  <Markdown source={guidelinesSource} />
</article>
