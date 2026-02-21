<script lang="ts">
  import { localizeLink } from '$lib/app/markdown/renderers/plugins'
  import { TextInput } from 'mono-svelte'

  let link = $state('')

  let localized = $derived(localizeLink(link))
</script>

<h1 class="font-bold text-2xl">Localize links</h1>
<p>Convert an external post link to a local Kelp link.</p>

<div class="flex flex-row items-center flex-wrap gap-4">
  <TextInput
    label="Input"
    bind:value={link}
    placeholder="https://lemmy.world/post/1"
  />
  <TextInput label="Output" value={localized} />
</div>
