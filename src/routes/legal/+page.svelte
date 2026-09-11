<script lang="ts">
  import Markdown from '$lib/feature/markdown/Markdown.svelte'
  import legalSource from '$lib/assets/legal.md?raw'
</script>

<svelte:head>
  <title>Legal &amp; source — Coves</title>
</svelte:head>

<article class="w-full max-w-prose pb-6" data-sveltekit-reload>
  <Markdown source={legalSource} />
</article>
