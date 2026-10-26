<script lang="ts">
  let { uri }: { uri: string } = $props()
</script>

<div data-testid="external-link-bar" data-uri={uri}></div>
